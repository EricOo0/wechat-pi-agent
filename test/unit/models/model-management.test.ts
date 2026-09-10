import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { SqliteControlPlane } from "../../../src/adapters/sqlite/sqlite-control-plane.js";
import { SqliteModelSelectionRepository } from "../../../src/adapters/sqlite/sqlite-model-selection-repository.js";
import { ModelManagement } from "../../../src/modules/models/application/select-model.js";
import { CommandRouter } from "../../../src/modules/messaging/application/command-router.js";
import { ProviderRequestGate } from "../../../src/modules/models/application/provider-request-gate.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "model-management-")); const path = join(dir, "app.db"); const control = new SqliteControlPlane(path); control.migrate();
  const repository = new SqliteModelSelectionRepository(path);
  cleanup.push(async () => { repository.close(); control.close(); await rm(dir, { recursive: true, force: true }); });
  const fallback = { providerId: "codex", modelId: "first", revision: 0 };
  const models = new ModelManagement({ listProviders: () => [{ id: "anthropic", name: "Claude", configured: true, methods: ["api_key"] }],
    listModels: () => Promise.resolve([{ id: "second", name: "Second", api: "anthropic-messages" }]), checkAuthentication: () => Promise.resolve(true), hasModel: () => true }, repository, fallback);
  return { repository, models, fallback };
}
describe("model commands", () => {
  const router = new CommandRouter();
  it("only recognizes explicit help and preserves unknown syntax verbatim", () => {
    for (const input of ["-help", "--help", "/help", "/provider -help", "/model --help", "/auth -help"]) expect(router.route(input).type).toBe("management");
    for (const input of ["解释 /model -help", "/model a b", "/provider a b c", "/auth a reauth extra", "/unknown", "/skill:demo x"]) expect(router.route(input)).toEqual({ type: "message", text: input });
  });
  it("does not introduce a pending provider and keeps /model scoped to current provider", async () => {
    const { models } = await setup();
    await models.execute("owner", { type: "models", provider: "anthropic", page: 1 });
    expect(models.current("owner").providerId).toBe("codex");
    await models.execute("owner", { type: "select_model", provider: "anthropic", modelId: "second" });
    expect(models.current("owner")).toEqual({ providerId: "anthropic", modelId: "second", revision: 1 });
  });
  it("preserves per-owner defaults, performs CAS, and binds retries to the original model", async () => {
    const { models, repository, fallback } = await setup();
    const first = repository.bind("turn-1", "owner", fallback);
    await models.select("owner", "anthropic", "second", 0);
    expect(repository.bind("turn-1", "owner", models.current("owner"))).toEqual(first);
    expect(models.current("other")).toEqual(fallback);
    await expect(models.select("owner", "anthropic", "second", 0)).rejects.toThrow("已变化");
    await expect(models.select("owner", "anthropic", "missing", 1)).rejects.toThrow("未找到");
    repository.db.prepare("INSERT INTO provider_credential_revisions VALUES('codex',1)").run();
    expect(() => repository.bind("turn-1", "owner", fallback)).toThrow("认证账户已变化");
  });
  it("drains all active provider tasks before an account commit and blocks new tasks", async () => {
    const gate = new ProviderRequestGate(); const release = await gate.enter("a"); const order: string[] = [];
    const commit = gate.exclusive("a", () => { order.push("commit"); return Promise.resolve(); });
    const next = gate.enter("a").then((exit) => { order.push("next"); exit(); });
    const independent = await gate.enter("b"); independent();
    expect(order).toEqual([]); release(); await Promise.all([commit, next]); expect(order).toEqual(["commit", "next"]);
  });
  it("cancellation releases a pending drain and quarantine prevents uncertain account use", async () => {
    const gate = new ProviderRequestGate(); const release = await gate.enter("a"); const controller = new AbortController();
    const commit = gate.exclusive("a", () => Promise.resolve(), controller.signal); controller.abort(); await expect(commit).rejects.toThrow(); release();
    const exit = await gate.enter("a"); exit(); gate.quarantine("a"); await expect(gate.enter("a")).rejects.toThrow("recovery");
  });
});

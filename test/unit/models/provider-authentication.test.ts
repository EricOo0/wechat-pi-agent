import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it } from "vitest";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { SqliteControlPlane } from "../../../src/adapters/outbound/sqlite/sqlite-control-plane.js";
import { SqliteModelSelectionRepository } from "../../../src/adapters/outbound/sqlite/sqlite-model-selection-repository.js";
import { PiProviderAuthentication } from "../../../src/adapters/outbound/pi/pi-provider-authentication.js";
import { ProviderRequestGate } from "../../../src/adapters/outbound/pi/provider-request-gate.js";
import { openPiCredentialStore } from "../../../src/adapters/outbound/pi/staged-credential-store.js";
const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const fn of cleanup.splice(0)) await fn(); });
async function setup() {
  const dir = await mkdtemp(join(tmpdir(), "provider-auth-")); const path = join(dir, "app.db"); const control = new SqliteControlPlane(path); control.migrate();
  const repository = new SqliteModelSelectionRepository(path); const credentials = new InMemoryCredentialStore();
  await credentials.modify("anthropic", () => Promise.resolve({ type: "api_key", key: "old-test-key" }));
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(dir, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
  const original = runtime.getProvider("anthropic")!;
  runtime.registerNativeProvider({ ...original, auth: { apiKey: { name: "test key", resolve: ({ credential }) => Promise.resolve(credential?.key ? { auth: { apiKey: credential.key } } : undefined),
    login: async (interaction) => ({ type: "api_key", key: await interaction.prompt({ type: "secret", message: "Enter test key", signal: interaction.signal }) }) } } });
  const gate = new ProviderRequestGate(); const auth = new PiProviderAuthentication(runtime, credentials, repository, gate);
  cleanup.push(async () => { await auth.close(); repository.close(); control.close(); await rm(dir, { recursive: true, force: true }); });
  return { dir, credentials, gate, auth, repository };
}
async function until(predicate: () => boolean) { for (let n = 0; n < 100; n++) { if (predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); } throw new Error("Timed out"); }
describe("provider authentication", () => {
  it("uses the pinned Pi storage bridge without touching another provider", async () => {
    const { dir } = await setup(); const store = await openPiCredentialStore(join(dir, "auth.json"));
    await store.modify("one", () => Promise.resolve({ type: "api_key", key: "first" })); await store.modify("two", () => Promise.resolve({ type: "api_key", key: "second" }));
    expect(await store.read("one")).toEqual({ type: "api_key", key: "first" });
  });
  it("stages credentials until active work drains and never persists secrets in audit", async () => {
    const { auth, gate, credentials, repository } = await setup(); const exit = await gate.enter("anthropic");
    const op = await auth.start("anthropic", "reauth"); auth.begin(op.id, "api_key");
    await until(() => !!auth.get(op.id)?.promptId);
    auth.submit(op.id, auth.get(op.id)!.promptId!, "new-test-secret");
    await until(() => auth.get(op.id)?.status === "WAITING_IDLE");
    expect(await credentials.read("anthropic")).toEqual({ type: "api_key", key: "old-test-key" });
    exit(); await until(() => auth.get(op.id)?.status === "SUCCEEDED");
    expect(await credentials.read("anthropic")).toEqual({ type: "api_key", key: "new-test-secret" });
    expect(repository.credentialRevision("anthropic")).toBe(1);
    expect(JSON.stringify(repository.events())).not.toContain("new-test-secret");
  });
  it("recovers an interrupted committed credential once and fails an uncommitted login", async () => {
    const { auth, credentials, repository } = await setup();
    const candidate = { type: "api_key" as const, key: "committed-test-key" };
    await credentials.modify("anthropic", () => Promise.resolve(candidate));
    const now = new Date().toISOString();
    repository.db.prepare("INSERT INTO provider_auth_operations(id,provider_id,status,created_at,updated_at,candidate_hash) VALUES(?,?,'COMMITTING',?,?,?)")
      .run("committed", "anthropic", now, now, createHash("sha256").update(JSON.stringify(candidate)).digest("hex"));
    repository.db.prepare("INSERT INTO provider_auth_operations(id,provider_id,status,created_at,updated_at) VALUES(?,?,'AUTHENTICATING',?,?)")
      .run("unfinished", "google", now, now);
    await auth.recover(); await auth.recover();
    expect(repository.credentialRevision("anthropic")).toBe(1);
    expect(auth.list().find((op) => op.id === "committed")?.status).toBe("SUCCEEDED");
    expect(auth.list().find((op) => op.id === "unfinished")?.status).toBe("FAILED");
  });
  it("keeps old credentials on cancel and rejects stale input", async () => {
    const { auth, credentials } = await setup(); const op = await auth.start("anthropic", "reauth"); auth.begin(op.id, "api_key");
    await until(() => !!auth.get(op.id)?.promptId); const prompt = auth.get(op.id)!.promptId!; auth.cancel(op.id);
    expect(() => auth.submit(op.id, prompt, "new")).toThrow();
    expect(await credentials.read("anthropic")).toEqual({ type: "api_key", key: "old-test-key" });
    expect(auth.get(op.id)?.status).toBe("CANCELLED");
  });
});

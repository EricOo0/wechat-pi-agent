import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer } from "node:http";
import { Script } from "node:vm";
import { expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { SqliteControlPlane } from "../../src/adapters/outbound/sqlite/sqlite-control-plane.js";
import { SqliteModelSelectionRepository } from "../../src/adapters/outbound/sqlite/sqlite-model-selection-repository.js";
import { ModelManagement } from "../../src/application/use-cases/select-model.js";
import { PiProviderAuthentication } from "../../src/adapters/outbound/pi/pi-provider-authentication.js";
import { ProviderRequestGate } from "../../src/adapters/outbound/pi/provider-request-gate.js";
import { ModelRoutes } from "../../src/adapters/inbound/admin-http/model-routes.js";
it("serves local model management, guards writes and commits a selection", async () => {
  const root = await mkdtemp(join(tmpdir(), "model-admin-")); const path = join(root, "app.db"); const control = new SqliteControlPlane(path); control.migrate();
  const repository = new SqliteModelSelectionRepository(path); const credentials = new InMemoryCredentialStore();
  const runtime = await ModelRuntime.create({ credentials, modelsPath: null, modelsStorePath: join(root, "models.json"), refreshOnCreate: false, allowModelNetwork: false });
  const auth = new PiProviderAuthentication(runtime, credentials, repository, new ProviderRequestGate());
  const models = new ModelManagement({ listProviders: () => [{ id: "test", name: "Test", configured: true, methods: [] }], checkAuthentication: () => Promise.resolve(true), hasModel: () => true, listModels: () => Promise.resolve([{ id: "new", name: "New", api: "test" }]) }, repository, { providerId: "test", modelId: "old", revision: 0 });
  const routes = new ModelRoutes(models, auth, "owner");
  const server = createServer((req, res) => { void routes.handle(req, res).then((handled) => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw new Error("no address"); const base = `http://127.0.0.1:${address.port}`;
  try {
    const html = await fetch(base + "/admin/models").then((r) => r.text());
    const script = /<script>([\s\S]*?)<\/script>/u.exec(html)?.[1]; expect(script).toBeDefined(); expect(() => new Script(script!)).not.toThrow();
    const token = /const csrf="([a-f0-9]+)"/u.exec(html)?.[1]; expect(token).toBeDefined();
    const body = JSON.stringify({ providerId: "test", modelId: "new", expectedRevision: 0 });
    expect((await fetch(base + "/admin/api/selection", { method: "PUT", headers: { "Content-Type": "application/json" }, body })).status).toBe(403);
    expect((await fetch(base + "/admin/api/selection", { method: "PUT", headers: { "Content-Type": "application/json", "X-Local-Control": token!, Origin: "https://evil.example" }, body })).status).toBe(403);
    expect((await fetch(base + "/admin/api/selection", { method: "PUT", headers: { "Content-Type": "application/json", "X-Local-Control": token!, Origin: base }, body })).status).toBe(200);
    expect(models.current("owner")).toEqual({ providerId: "test", modelId: "new", revision: 1 });
    expect((await fetch(base + "/admin/api/auth", { headers: { "X-Local-Control": token! } })).status).toBe(200);
  } finally { await new Promise<void>((resolve) => server.close(() => resolve())); await auth.close(); repository.close(); control.close(); await rm(root, { recursive: true, force: true }); }
});

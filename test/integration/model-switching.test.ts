import { mkdtemp, rm, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, createAssistantMessageEventStream, type AssistantMessage, type Provider, type Context } from "@earendil-works/pi-ai";
import { PiAgentGateway } from "../../src/adapters/outbound/pi/pi-agent-gateway.js";
import { SqliteControlPlane } from "../../src/adapters/outbound/sqlite/sqlite-control-plane.js";
import { SqlitePermissionRepository } from "../../src/adapters/outbound/sqlite/sqlite-permission-repository.js";
import { SqliteModelSelectionRepository } from "../../src/adapters/outbound/sqlite/sqlite-model-selection-repository.js";
import { PermissionService } from "../../src/application/services/permission-service.js";
import { subjectKey, principalId } from "../../src/domain/policy/permissions.js";
import { ModelManagement } from "../../src/application/use-cases/select-model.js";
import { PiModelCatalog } from "../../src/adapters/outbound/pi/pi-model-catalog.js";
import { ProviderRequestGate } from "../../src/adapters/outbound/pi/provider-request-gate.js";
import type { AgentInvocationTrace } from "../../src/application/interfaces/agent.js";

describe("model switching through real Pi AgentSession", () => {
  it("keeps a running tool loop on its model and switches the cached session on the next turn", async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "model-switch-")));
    const control = new SqliteControlPlane(join(root, "app.db")); control.migrate();
    const repository = new SqliteModelSelectionRepository(join(root, "app.db"));
    const permissionRepo = new SqlitePermissionRepository(join(root, "permissions.db"));
    let gateway: PiAgentGateway | undefined;
    try {
      const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: join(root, "models.json"), allowModelNetwork: false, refreshOnCreate: false });
      const permissions = new PermissionService(permissionRepo, { executorId: "test", workspaceId: root, ownerPrincipalId: principalId("bot", "owner"), protectedPaths: [] });
      const message = { id: "in-1", accountId: "bot", peerId: "owner", senderId: "owner", channelMessageId: "one", text: "Hello", receivedAt: new Date() };
      const context = permissions.context(message, "session", "turn-1"); const owner = subjectKey(context.subject);
      const calls: Array<{ provider: string; context: Context }> = []; const switchDuringFirstCall = async () => { await models.select(owner, "test-b", "model", 0); };
      for (const providerId of ["test-a", "test-b"]) {
        const template = runtime.getModels("openai-codex")[0]!;
        const model = { ...template, id: "model", provider: providerId };
        const send: Provider["streamSimple"] = (m, c) => {
          calls.push({ provider: m.provider, context: c });
          const tool = calls.length === 1; const output: AssistantMessage = { role: "assistant", api: m.api, provider: m.provider, model: m.id,
            content: tool ? [{ type: "toolCall", id: "permission-check", name: "permissions_get", arguments: {} }] : [{ type: "text", text: `reply:${m.provider}` }],
            stopReason: tool ? "toolUse" : "stop", timestamp: Date.now(), usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
          const result = createAssistantMessageEventStream();
          void (async () => { if (tool) await switchDuringFirstCall?.(); result.push({ type: "start", partial: output }); result.push({ type: "done", reason: tool ? "toolUse" : "stop", message: output }); result.end(); })();
          return result;
        };
        runtime.registerNativeProvider({ id: providerId, name: providerId, getModels: () => [model], auth: { apiKey: { name: "test", resolve: () => Promise.resolve({ auth: { apiKey: "fixture" } }) } }, stream: send as Provider["stream"], streamSimple: send });
      }
      const models = new ModelManagement(new PiModelCatalog(runtime), repository, { providerId: "test-a", modelId: "model", revision: 0 });
      await writeFile(join(root, "prompt.md"), "You are a test assistant.");
      gateway = await PiAgentGateway.create({ runtime, models, gate: new ProviderRequestGate(), cwd: root, provider: "test-a", modelId: "model", sessionDir: join(root, "sessions"), systemPromptPath: join(root, "prompt.md"), loadLocalSkills: false, toolSandboxRoot: join(root, "workspace"), permissions,
        executor: { execute: () => Promise.reject(new Error("Unexpected execution")), close() {}, revoke() {} }, deniedPaths: [], protectedWritePaths: [], deniedNetworkPorts: [] });
      const session = { id: "session", key: "weixin:bot:owner", accountId: "bot", peerId: "owner", status: "ACTIVE" as const, createdAt: new Date(), updatedAt: new Date() };
      const traces: AgentInvocationTrace[] = [];
      const first = await gateway.runTurn({ session, prompt: "hello", permissionContext: context, onInvocation: (t) => traces.push(t) });
      expect(first.text).toBe("reply:test-a"); expect(calls.map((v) => v.provider)).toEqual(["test-a", "test-a"]);
      const second = await gateway.runTurn({ session, prompt: "continue", permissionContext: { ...context, taskTurnId: "turn-2" }, onInvocation: (t) => traces.push(t) });
      expect(second.text).toBe("reply:test-b"); expect(traces.map((t) => t.provider)).toEqual(["test-a", "test-b"]);
      expect(JSON.stringify(calls.at(-1)?.context)).toContain("reply:test-a");
    } finally { gateway?.dispose(); repository.close(); permissionRepo.close(); control.close(); await rm(root, { recursive: true, force: true }); }
  });
});

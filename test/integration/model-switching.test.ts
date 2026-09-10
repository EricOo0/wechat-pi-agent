import { TaskControlError } from "../../src/modules/tasks/index.js";
import { mkdtemp, rm, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, createAssistantMessageEventStream, type AssistantMessage, type Provider, type Context } from "@earendil-works/pi-ai";
import { PiAgentGateway } from "../../src/adapters/pi/pi-agent-gateway.js";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";
import { SqlitePermissionRepository } from "../../src/adapters/sqlite/sqlite-permission-repository.js";
import { SqliteModelSelectionRepository } from "../../src/adapters/sqlite/sqlite-model-selection-repository.js";
import { PermissionService } from "../../src/modules/permissions/application/permission-service.js";
import { subjectKey, principalId } from "../../src/modules/permissions/domain/permissions.js";
import { ModelManagement } from "../../src/modules/models/application/select-model.js";
import { PiModelCatalog } from "../../src/adapters/models/pi-model-catalog.js";
import { ProviderRequestGate } from "../../src/modules/models/application/provider-request-gate.js";
import type { AgentInvocationTrace } from "../../src/runtime/agent/ports/agent.js";

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
      const calls: Array<{ provider: string; context: Context; maxRetries: number | undefined }> = []; const switchDuringFirstCall = async () => { await models.select(owner, "test-b", "model", 0); };
      for (const providerId of ["test-a", "test-b"]) {
        const template = runtime.getModels("openai-codex")[0]!;
        const model = { ...template, id: "model", provider: providerId };
        const send: Provider["streamSimple"] = (m, c, options) => {
          calls.push({ provider: m.provider, context: c, maxRetries: options?.maxRetries });
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
      let counted = 0;
      const first = await gateway.runTurn({ session, prompt: "hello", beforeModelCall: () => { counted++; }, permissionContext: context, onInvocation: (t) => traces.push(t) });
      expect(counted).toBe(2);
      expect(first.text).toBe("reply:test-a"); expect(calls.map((v) => v.provider)).toEqual(["test-a", "test-a"]);
      const second = await gateway.runTurn({ session, prompt: "continue", task: { task: { id: "task", ownerId: owner, conversationId: session.id, goal: "fixture", revision: 1, status: "RUNNING", progress: "", evidence: [], reactLimit: 30, reactUsed: 2, reviewCount: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, inputs: [] }, permissionContext: { ...context, taskTurnId: "turn-2" }, onInvocation: (t) => traces.push(t) });
      expect(second.text).toBe("reply:test-b"); expect(traces.map((t) => t.provider)).toEqual(["test-a", "test-b"]);
      expect(JSON.stringify(calls.at(-1)?.context)).toContain("reply:test-a");
      expect(calls.at(-1)?.maxRetries).toBe(0);
      expect(calls.at(-1)?.context.systemPrompt).toContain("FINAL response must be one JSON object");
      const callCount = calls.length;
      await expect(gateway.runTurn({ session, prompt: "blocked by Task budget", permissionContext: { ...context, taskTurnId: "turn-3" },
        beforeModelCall: () => { throw new TaskControlError("TASK_BUDGET", "No rounds left"); } })).rejects.toThrow("No rounds left");
      expect(calls.length).toBe(callCount);
    } finally { gateway?.dispose(); repository.close(); permissionRepo.close(); control.close(); await rm(root, { recursive: true, force: true }); }
  });
});

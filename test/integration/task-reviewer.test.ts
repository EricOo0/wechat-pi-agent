import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { expect, it } from "vitest";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { InMemoryCredentialStore, createAssistantMessageEventStream, type Provider, type AssistantMessage } from "@earendil-works/pi-ai";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";
import { SqliteModelSelectionRepository } from "../../src/adapters/sqlite/sqlite-model-selection-repository.js";
import { PiModelCatalog } from "../../src/adapters/models/pi-model-catalog.js";
import { PiTaskReviewer } from "../../src/adapters/pi/pi-task-reviewer.js";
import { ModelManagement, ProviderRequestGate } from "../../src/modules/models/index.js";
import type { Task } from "../../src/modules/tasks/index.js";

it('uses an independent tool-free model call and separate binding for Review at the execution limit', async () => {
  const root = mkdtempSync(join(tmpdir(), 'task-review-'));
  const control = new SqliteControlPlane(join(root, 'app.db')); control.migrate();
  const selections = new SqliteModelSelectionRepository(join(root, 'app.db'));
  try {
    const runtime = await ModelRuntime.create({ credentials: new InMemoryCredentialStore(), modelsPath: null, modelsStorePath: join(root, 'models.json'), allowModelNetwork: false, refreshOnCreate: false });
    const template = runtime.getModels('openai-codex')[0]!; const model = { ...template, id: 'model', provider: 'review-fixture' };
    let calls = 0;
    const send: Provider['streamSimple'] = (m, context, options) => {
      calls++; expect(context.tools).toEqual([]); expect(options?.maxRetries).toBe(0);
      expect(context.systemPrompt).toContain('Independently review');
      const response: AssistantMessage = { role: 'assistant', api: m.api, provider: m.provider, model: m.id,
        content: [{ type: 'text', text: JSON.stringify({ decision: 'approved', reason: 'fixture checked', gaps: [], finalResult: 'final' }) }], stopReason: 'stop', timestamp: Date.now(),
        usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } } };
      const stream = createAssistantMessageEventStream(); stream.push({ type: 'start', partial: response }); stream.push({ type: 'done', reason: 'stop', message: response }); stream.end(); return stream;
    };
    runtime.registerNativeProvider({ id: 'review-fixture', name: 'fixture', getModels: () => [model], auth: { apiKey: { name: 'fixture', resolve: () => Promise.resolve({ auth: { apiKey: 'fixture' } }) } }, stream: send as Provider['stream'], streamSimple: send });
    const models = new ModelManagement(new PiModelCatalog(runtime), selections, { providerId: 'review-fixture', modelId: 'model', revision: 0 });
    const gate = new ProviderRequestGate(); const reviewer = new PiTaskReviewer(runtime, models, gate);
    const task: Task = { id: 'task', ownerId: 'owner', conversationId: 'session', goal: 'fixture', revision: 1, status: 'REVIEWING', progress: 'done', evidence: [], reactLimit: 30, reactUsed: 30, reviewCount: 1, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    expect(await reviewer.review({ id: 'completion', task, inputs: [], outcome: { disposition: 'request_completion', progress: 'done', remaining: '', evidence: [], result: 'final' }, evidence: [], signal: new AbortController().signal, emit: () => {} })).toMatchObject({ decision: 'approved', finalResult: 'final' });
    expect(calls).toBe(1); expect(task.reactUsed).toBe(30); expect(gate.activeCount('review-fixture')).toBe(0);
    expect(selections.findBinding('review:completion', 'owner')?.providerId).toBe('review-fixture');
  } finally { selections.close(); control.close(); rmSync(root, { recursive: true, force: true }); }
});

import type { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { TASK_REVIEW_PROTOCOL, parseTaskReview, type TaskReviewer, type TaskReviewRequest } from "../../modules/tasks/index.js";
import type { ModelManagement, ProviderRequestGate } from "../../modules/models/index.js";
import { traceSnapshot } from "../../modules/observability/index.js";
import { traceModelCalls } from "./model-call-trace.js";
import { redactMemorySecrets } from "./pi-memory-generator.js";

export class PiTaskReviewer implements TaskReviewer {
  public constructor(private readonly runtime: ModelRuntime, private readonly models: ModelManagement, private readonly gate: ProviderRequestGate) {}
  public async review(request: TaskReviewRequest) {
    const id = `review:${request.id}`;
    const selection = this.models.repository.findBinding(id, request.task.ownerId) ?? this.models.current(request.task.ownerId);
    const release = await this.gate.enter(selection.providerId, request.signal);
    try {
      const binding = this.models.repository.bind(id, request.task.ownerId, selection);
      const model = this.runtime.getModel(binding.providerId, binding.modelId);
      if (!model) throw new Error('Review model unavailable');
      const payload = { task: request.task, inputs: request.inputs, completion: request.outcome, evidence: [...request.evidence], evidenceTruncated: false };
      while (JSON.stringify(payload).length > 160_000 && payload.evidence.length) { payload.evidence.shift(); payload.evidenceTruncated = true; }
      if (JSON.stringify(payload).length > 160_000) throw new Error('Task context exceeds review input budget');
      const stream = traceModelCalls((m, c, o) => this.runtime.streamSimple(m, c, { ...o, reasoning: 'low', maxRetries: 0 }),
        event => request.emit({ ...event, data: { ...event.data, taskId: request.task.id, taskPhase: 'review', completionRequestId: request.id, taskRevision: request.task.revision } }));
      const response = await (await stream(model, { systemPrompt: TASK_REVIEW_PROTOCOL, messages: [{ role: 'user', content: redactMemorySecrets(JSON.stringify(traceSnapshot(payload))), timestamp: Date.now() }], tools: [] },
        { signal: AbortSignal.any([request.signal, AbortSignal.timeout(120_000)]) })).result();
      if (response.stopReason === 'error' || response.stopReason === 'aborted') throw new Error('Task review failed');
      return parseTaskReview(response.content.filter(p => p.type === 'text').map(p => p.text).join(''));
    } finally { release(); }
  }
}

import { randomUUID } from "node:crypto";
import type { StreamFn } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, AssistantMessageEventStream } from "@earendil-works/pi-ai";
import type { AgentEvent } from "../../modules/observability/index.js";
import { traceSnapshot } from "../../modules/observability/index.js";

/** Observe every model round after provider conversion and file injection, before network I/O. */
export function traceModelCalls(streamFn: StreamFn, emit: (event: AgentEvent) => void): StreamFn {
  return async (model, context, options) => {
    const modelCallId = randomUUID();
    let attempt = 0;
    const record = (type: string, data: Record<string, unknown>) => emit({ type, at: new Date(), data: { modelCallId, ...data } });
    record("model_start", { provider: model.provider, model: model.id, api: model.api, status: "started", context: traceSnapshot(context) });
    try {
      const stream = await streamFn(model, context, { ...options,
        onPayload: async (payload, currentModel) => {
          const finalPayload = await options?.onPayload?.(payload, currentModel) ?? payload;
          record("model_request", { attempt: ++attempt, request: traceSnapshot(finalPayload) });
          return finalPayload;
        },
        onResponse: async (response, currentModel) => {
          record("model_http_response", { attempt, status: response.status });
          await options?.onResponse?.(response, currentModel);
        },
      });
      return observeResult(stream, record);
    } catch (error) {
      record("model_end", { status: "failed", output: traceSnapshot({ errorMessage: error instanceof Error ? error.message : String(error) }) });
      throw error;
    }
  };
}
function observeResult(stream: AssistantMessageEventStream, record: (type: string, data: Record<string, unknown>) => void): AssistantMessageEventStream {
  const iterator = stream[Symbol.asyncIterator].bind(stream);
  const result = stream.result.bind(stream);
  let ended = false;
  const finish = (output: AssistantMessage, failed: boolean) => {
    if (ended) return;
    ended = true;
    record("model_end", { status: failed ? "failed" : "succeeded", output: traceSnapshot(output), usage: output.usage });
  };
  stream.result = async () => { const output = await result(); finish(output, output.stopReason === "error" || output.stopReason === "aborted"); return output; };
  stream[Symbol.asyncIterator] = async function* () {
    try {
      for await (const event of { [Symbol.asyncIterator]: iterator }) {
        if (event.type === "done" || event.type === "error") {
          const output = event.type === "done" ? event.message : event.error;
          finish(output, event.type === "error");
        }
        yield event;
      }
    } catch (error) {
      ended = true;
      record("model_end", { status: "failed", output: traceSnapshot({ errorMessage: error instanceof Error ? error.message : String(error) }) });
      throw error;
    } finally {
      if (!ended) record("model_end", { status: "incomplete", output: { errorMessage: "Model stream ended without a final result" } });
    }
  };
  return stream;
}

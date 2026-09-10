import type { AgentEvent } from "../../observability/index.js";
export interface ModelFileRequest {
  ownerId: string;
  fileIds: readonly string[];
  signal?: AbortSignal;
  emit: (event: AgentEvent) => void;
}
export interface ModelFileInput {
  apply(payload: unknown, model: { api: string; provider: string; id: string; baseUrl: string }, request: ModelFileRequest): Promise<unknown>;
}

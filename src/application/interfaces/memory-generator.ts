import type { AgentEvent } from "../../domain/execution/step.js";
import type { ExtractedMemory, SessionMemorySource } from "../../domain/memory/user-memory.js";
export interface MemoryGenerator {
  extract(source: SessionMemorySource, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<ExtractedMemory>;
  merge(overview: string, detail: string, detailId: string, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<string>;
}

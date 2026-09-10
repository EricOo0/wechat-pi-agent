import type { AgentEvent } from "../../observability/index.js";
import type { ExtractedMemory, SessionMemorySource } from "../domain/user-memory.js";
export interface MemoryGenerator {
  withTask?<T>(owner: string, id: string, signal: AbortSignal, action: (generator: MemoryGenerator) => Promise<T>): Promise<T>;
  extract(source: SessionMemorySource, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<ExtractedMemory>;
  merge(overview: string, detail: string, detailId: string, emit: (event: AgentEvent) => void, signal: AbortSignal): Promise<string>;
}

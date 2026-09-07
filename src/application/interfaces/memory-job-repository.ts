import type { AgentEvent } from "../../domain/execution/step.js";
import type { MemoryJob, MemoryPhase } from "../../domain/memory/memory-job.js";
import type { SessionMemorySource } from "../../domain/memory/user-memory.js";
export interface MemoryJobRepository {
  claim(workerId: string, now?: Date): MemoryJob | undefined;
  renew(job: MemoryJob): boolean;
  source(job: MemoryJob): SessionMemorySource;
  commit(job: MemoryJob, phase: MemoryPhase, publish: () => void, shouldMerge?: boolean): void;
  fail(job: MemoryJob, error: string): void;
  appendEvent(jobId: string, event: AgentEvent): void;
  list(): MemoryJob[];
  details(jobId: string): { job: MemoryJob; events: unknown[] } | undefined;
  recover(): void;
}

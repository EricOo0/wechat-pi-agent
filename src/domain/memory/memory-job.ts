export type MemoryPhase = "PENDING" | "EXTRACTED" | "COMPLETED" | "SKIPPED";
export interface MemoryJob {
  id: string;
  sessionId: string;
  ownerId: string;
  detailId: string;
  endedAt: string;
  reason: string;
  phase: MemoryPhase;
  shouldMerge: boolean;
  attempts: number;
  workerId?: string;
  error?: string;
}

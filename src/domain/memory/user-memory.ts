export interface MemoryOverview { content: string; revision: string }
export interface MemoryHit { memoryId: string; line: number; text: string }
export interface SessionMemorySource {
  sessionId: string;
  endedAt: string;
  reason: string;
  turns: Array<{ turnId: string; user: string; assistant: string; status: string; responseGenerated: boolean; errorCode?: string; files: unknown[]; tools: unknown[] }>;
  truncated: boolean;
}
export interface ExtractedMemory { content: string; shouldMerge: boolean }

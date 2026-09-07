import type { MemoryHit, MemoryOverview } from "../../domain/memory/user-memory.js";
export interface MemoryStore {
  overview(ownerId: string): MemoryOverview;
  read(ownerId: string, memoryId: string): string;
  write(ownerId: string, memoryId: string, content: string): void;
  search(ownerId: string, query: string, limit: number): { hits: MemoryHit[]; scanned: number; truncated: boolean };
}

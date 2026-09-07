import type { MemoryStore } from "../interfaces/memory-store.js";
export class UserMemoryService {
  public constructor(private readonly store: MemoryStore) {}
  public loadOverview(ownerId: string) { return this.store.overview(ownerId); }
  public search(ownerId: string, query: string, limit = 20) { return this.store.search(ownerId, query, limit); }
  public read(ownerId: string, memoryId: string, startLine = 1, lineCount = 100) {
    const all = this.store.read(ownerId, memoryId).split("\n");
    const start = Math.max(1, Math.floor(startLine)), count = Math.max(1, Math.min(200, Math.floor(lineCount)));
    return { memoryId, startLine: start, totalLines: all.length, lines: all.slice(start - 1, start - 1 + count), hasMore: start - 1 + count < all.length };
  }
}

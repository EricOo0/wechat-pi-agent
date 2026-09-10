import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { MemoryStore } from "../../modules/memory/index.js";
import type { MemoryHit, MemoryOverview } from "../../modules/memory/index.js";
export class MarkdownMemoryStore implements MemoryStore {
  public constructor(private readonly root: string) {}
  private path(owner: string, id: string, create = false): string {
    if (!/^[a-f0-9]{64}$/.test(owner) || !/^(MEMORY\.md|sessions\/\d{4}-\d{2}-\d{2}\/[a-zA-Z0-9_-]{1,100}\.md)$/.test(id)) throw new Error("Invalid user memory path");
    const target = join(resolve(this.root), owner, id);
    if (create) {
      const base=resolve(this.root);
      mkdirSync(base,{recursive:true,mode:0o700});
      if(realpathSync(base)!==base)throw new Error("Memory root is a symlink");
      let current=base;
      for(const part of [owner,...id.split('/').slice(0,-1)]) {
        current=join(current,part);
        if(existsSync(current)){if(realpathSync(current)!==current)throw new Error("Memory directory is a symlink");}
        else mkdirSync(current,{mode:0o700});
      }
    }
    if (existsSync(dirname(target)) && realpathSync(dirname(target)) !== dirname(target)) throw new Error("Memory directory is a symlink");
    if (existsSync(target) && realpathSync(target) !== target) throw new Error("Memory file is a symlink");
    return target;
  }
  public overview(owner: string): MemoryOverview {
    const path = this.path(owner, "MEMORY.md");
    const content = existsSync(path) ? this.read(owner, "MEMORY.md") : "";
    if(content.length>6000)throw new Error("Memory overview exceeds 6000 characters");
    return { content, revision: createHash("sha256").update(content).digest("hex") };
  }
  public read(owner: string, id: string): string {
    const path = this.path(owner, id);
    if (statSync(path).size > 256_000) throw new Error("Memory file exceeds read limit");
    return readFileSync(path, "utf8");
  }
  public write(owner: string, id: string, content: string): void {
    const limit = id === "MEMORY.md" ? 6_000 : 60_000;
    if (!content.trim() || content.length > limit) throw new Error(`Memory content must be non-empty and within ${limit} characters`);
    const path = this.path(owner, id, true), temp = path + "." + randomUUID() + ".tmp";
    try { writeFileSync(temp, content, { mode: 0o600 }); renameSync(temp, path); }
    finally { rmSync(temp, { force: true }); }
  }
  public search(owner: string, query: string, limit = 20): { hits: MemoryHit[]; scanned: number; truncated: boolean } {
    if (!query.trim()) throw new Error("Search query must not be empty");
    const overviewPath = this.path(owner, "MEMORY.md");
    const root = join(dirname(overviewPath), "sessions");
    const ids: string[] = existsSync(overviewPath) ? ["MEMORY.md"] : [];
    if (existsSync(root)) {
      if (realpathSync(root) !== root) throw new Error("Memory directory is a symlink");
      for (const day of readdirSync(root).sort().reverse()) {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
        const dir = join(root, day);
        if (realpathSync(dir) !== dir || !statSync(dir).isDirectory()) continue;
        for (const file of readdirSync(dir).sort()) if (/^[a-zA-Z0-9_-]{1,100}\.md$/.test(file)) ids.push(`sessions/${day}/${file}`);
      }
    }
    const hits: MemoryHit[] = []; let scanned = 0;
    const max = Math.max(1, Math.min(limit, 50));
    for (const id of ids.slice(0, 1000)) {
      const lines = this.read(owner, id).split("\n"); scanned++;
      for (const [i, line] of lines.entries()) if (line.toLowerCase().includes(query.toLowerCase().trim())) {
        hits.push({ memoryId: id, line: i + 1, text: line.slice(0, 1000) });
        if (hits.length >= max) return { hits, scanned, truncated: true };
      }
    }
    return { hits, scanned, truncated: ids.length > scanned };
  }
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, realpath, rename, rm, stat, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import type { FileStorage } from "../../modules/artifacts/index.js";
import { FileInputError, MAX_FILE_BYTES, type UserFile } from "../../modules/artifacts/index.js";
export class LocalFileStorage implements FileStorage {
  public constructor(private readonly root: string) {}
  private async directory(owner: string, id: string, create: boolean): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(owner) || !/^fil_[a-f0-9]{32}$/.test(id)) throw new FileInputError("FILE_NOT_FOUND", "找不到这份文件。");
    const path = join(resolve(this.root), owner, id);
    if (create) await mkdir(path, { recursive: true, mode: 0o700 });
    if (await realpath(path) !== path) throw new FileInputError("FILE_CORRUPTED", "文件存储路径已改变。");
    return path;
  }
  public async save(owner: string, id: string, data: Buffer): Promise<void> {
    if (data.length > MAX_FILE_BYTES) throw new FileInputError("FILE_TOO_LARGE", "PDF 超过 20 MiB，请缩小文件后重新发送。");
    const dir = await this.directory(owner, id, true);
    const temp = join(dir, `.${randomUUID()}.tmp`);
    try { await writeFile(temp, data, { mode: 0o600 }); await rename(temp, join(dir, "original.pdf")); }
    finally { await rm(temp, { force: true }); }
  }
  public async read(file: UserFile): Promise<Buffer> {
    try {
      const path = join(await this.directory(file.ownerId, file.id, false), "original.pdf");
      if (await realpath(path) !== path || (await stat(path)).size > MAX_FILE_BYTES) throw new Error("invalid file");
      const data = await readFile(path);
      if (data.length !== file.bytes || createHash("sha256").update(data).digest("hex") !== file.sha256) throw new Error("digest mismatch");
      return data;
    } catch { throw new FileInputError("FILE_CORRUPTED", "已保存文件丢失或校验失败，请重新发送。"); }
  }
}

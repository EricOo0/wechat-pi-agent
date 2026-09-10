import { createHash } from "node:crypto";
import { mkdir, open, realpath, readdir, lstat, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { ImageReplyError, MAX_IMAGE_BYTES, type ImageArtifact, type ImageStorage } from "../../modules/artifacts/index.js";
export class LocalImageStorage implements ImageStorage {
  private canonicalRoot: string | undefined;
  public constructor(private readonly root: string) {}
  private async path(image: ImageArtifact, create: boolean): Promise<string> {
    if (!/^[a-f0-9]{64}$/.test(image.ownerId) || !/^img_[a-f0-9]{32}$/.test(image.id)) throw new ImageReplyError("IMAGE_NOT_FOUND", "图片标识无效。");
    if (!this.canonicalRoot) {
      if (create) await mkdir(resolve(this.root), {recursive: true, mode: 0o700});
      this.canonicalRoot = await realpath(resolve(this.root));
    }
    const directory = join(this.canonicalRoot, image.ownerId);
    if (create) await mkdir(directory, {recursive: true, mode: 0o700});
    if (await realpath(directory) !== directory) throw new ImageReplyError("IMAGE_CORRUPTED", "图片存储路径已改变。");
    return join(directory, image.id);
  }
  public async save(image: ImageArtifact, data: Buffer): Promise<void> {
    if (data.length > MAX_IMAGE_BYTES) throw new ImageReplyError("IMAGE_TOO_LARGE", "图片超过 10 MiB。");
    const path = await this.path(image, true);
    const file = await open(path, "wx", 0o600);
    try { await file.writeFile(data); await file.sync(); }
    catch (error) { await rm(path, {force: true}); throw error; }
    finally { await file.close(); }
  }
  public async read(image: ImageArtifact): Promise<Buffer> {
    try {
      const file = await open(await this.path(image, false), constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const info = await file.stat();
        if (!info.isFile() || info.size !== image.bytes || info.size > MAX_IMAGE_BYTES) throw new Error("invalid image size");
        const data = Buffer.alloc(image.bytes + 1);
        let offset = 0;
        while (offset < data.length) {
          const result = await file.read(data, offset, data.length - offset, offset);
          if (!result.bytesRead) break;
          offset += result.bytesRead;
        }
        const result = data.subarray(0, offset);
        if (offset !== image.bytes || createHash("sha256").update(result).digest("hex") !== image.sha256) throw new Error("image digest mismatch");
        return result;
      } finally { await file.close(); }
    } catch { throw new ImageReplyError("IMAGE_CORRUPTED", "已保存图片丢失或校验失败，请重新生成。"); }
  }
  public async sweepOrphans(olderThan: number, isKnown: (id: string) => boolean): Promise<number> {
    let root: string;
    try { root = this.canonicalRoot ?? await realpath(resolve(this.root)); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return 0; throw error; }
    this.canonicalRoot = root;
    let removed = 0;
    for (const owner of await readdir(root, {withFileTypes: true})) {
      if (!owner.isDirectory() || !/^[a-f0-9]{64}$/.test(owner.name)) continue;
      const directory = join(root, owner.name);
      if (await realpath(directory) !== directory) continue;
      for (const entry of await readdir(directory, {withFileTypes: true})) {
        if (!entry.isFile() || !/^img_[a-f0-9]{32}$/.test(entry.name) || isKnown(entry.name)) continue;
        const path = join(directory, entry.name);
        const info = await lstat(path);
        if (!info.isFile() || info.mtimeMs >= olderThan) continue;
        await rm(path, {force: true});
        removed++;
      }
    }
    return removed;
  }
  public async remove(image: ImageArtifact): Promise<void> { await rm(await this.path(image, false), {force: true}); }
}

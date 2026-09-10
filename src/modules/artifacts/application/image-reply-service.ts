import { createHash, randomUUID } from "node:crypto";
import { ImageReplyError, MAX_IMAGE_BYTES, MAX_IMAGE_STORAGE_BYTES, type ImageArtifact, type ImageReplyContext } from "../domain/image-artifact.js";
import type { ImageArtifactRepository } from "../ports/image-artifact-repository.js";
import type { AuthorizedImageRead, ImageStorage, ImageValidator } from "../ports/image-storage.js";
export class ImageReplyService {
  public constructor(public readonly repository: ImageArtifactRepository, private readonly storage: ImageStorage, private readonly validator: ImageValidator) {}
  public async prepare(context: ImageReplyContext, path: string, read: AuthorizedImageRead, signal?: AbortSignal): Promise<ImageArtifact> {
    signal?.throwIfAborted();
    const existing = this.repository.getByToolCall(context.ownerId, context.turnId, context.toolCallId);
    if (existing) {
      if (existing.taskId !== context.taskId || existing.revision !== context.revision) throw new ImageReplyError("IMAGE_CONTEXT_CHANGED", "图片所属任务版本已改变，请重新选择。");
      await this.storage.read(existing);
      return existing;
    }
    const data = await read(path, signal);
    signal?.throwIfAborted();
    if (data.length > MAX_IMAGE_BYTES) throw new ImageReplyError("IMAGE_TOO_LARGE", "图片超过 10 MiB，请缩小后重试。");
    const dimensions = await this.validator.validate(data);
    signal?.throwIfAborted();
    const image: ImageArtifact = { id: `img_${randomUUID().replaceAll("-", "")}`, ownerId: context.ownerId, taskId: context.taskId, revision: context.revision, sourceTurnId: context.turnId, toolCallId: context.toolCallId, bytes: data.length, sha256: createHash("sha256").update(data).digest("hex"), ...dimensions, createdAt: new Date().toISOString() };
    await this.storage.save(image, data);
    try { signal?.throwIfAborted(); this.repository.saveWithinQuota(image, MAX_IMAGE_STORAGE_BYTES); }
    catch (error) { await this.storage.remove(image); throw error; }
    return image;
  }
  public selected(ownerId: string, taskId: string, revision: number): ImageArtifact[] { return this.repository.selected(ownerId, taskId, revision); }
  public assertReady(ownerId: string, ids: string[]): ImageArtifact[] {
    return ids.map(id => { const image = this.repository.get(ownerId, id); if (!image) throw new ImageReplyError("IMAGE_NOT_FOUND", "图片不存在或不属于当前用户。"); return image; });
  }
  public async readForDelivery(id: string): Promise<Buffer> {
    const image = this.repository.getById(id);
    if (!image) throw new ImageReplyError("IMAGE_NOT_FOUND", "待发送图片不存在。");
    return this.storage.read(image);
  }
  /** Run before workers start so a file cannot become registered while being swept. */
  public async sweepOrphans(now = Date.now()): Promise<number> {
    return this.storage.sweepOrphans?.(now - 24 * 60 * 60 * 1000, id => this.repository.getById(id) !== undefined) ?? 0;
  }
  /** Caller supplies live task/outbox retention policy; no active image is deleted implicitly. */
  public async cleanup(cutoff: string, isRetained: (id: string) => boolean): Promise<number> {
    let removed = 0;
    for (const image of this.repository.listBefore(cutoff)) {
      if (isRetained(image.id)) continue;
      await this.storage.remove(image);
      this.repository.delete(image.id);
      removed++;
    }
    return removed;
  }
}

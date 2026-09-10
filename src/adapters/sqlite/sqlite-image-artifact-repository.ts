import { DatabaseSync } from "node:sqlite";
import { ImageReplyError, type ImageArtifact, type ImageArtifactRepository } from "../../modules/artifacts/index.js";
export class SqliteImageArtifactRepository implements ImageArtifactRepository {
  private readonly db: DatabaseSync;
  public constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); }
  public close(): void { this.db.close(); }
  public get(owner: string, id: string): ImageArtifact | undefined { return decodeOptional(this.db.prepare("SELECT * FROM image_artifacts WHERE owner_id=? AND id=? AND deleted_at IS NULL").get(owner, id)); }
  public getById(id: string): ImageArtifact | undefined { return decodeOptional(this.db.prepare("SELECT * FROM image_artifacts WHERE id=? AND deleted_at IS NULL").get(id)); }
  public getByToolCall(owner: string, turn: string, call: string): ImageArtifact | undefined { return decodeOptional(this.db.prepare("SELECT * FROM image_artifacts WHERE owner_id=? AND source_turn_id=? AND tool_call_id=? AND deleted_at IS NULL").get(owner, turn, call)); }
  public usedBytes(owner: string): number { return Number(this.db.prepare("SELECT coalesce(sum(bytes),0) AS total FROM image_artifacts WHERE owner_id=? AND deleted_at IS NULL").get(owner)?.total ?? 0); }
  public saveWithinQuota(image: ImageArtifact, maxBytes: number): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (this.usedBytes(image.ownerId) + image.bytes > maxBytes) throw new ImageReplyError("IMAGE_QUOTA_EXCEEDED", "图片存储已达到 500 MiB 配额。");
      this.db.prepare("INSERT INTO image_artifacts(id,owner_id,task_id,revision,source_turn_id,tool_call_id,bytes,sha256,mime_type,width,height,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)").run(image.id,image.ownerId,image.taskId,image.revision,image.sourceTurnId,image.toolCallId,image.bytes,image.sha256,image.mimeType,image.width,image.height,image.createdAt);
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  public select(image: ImageArtifact): void {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (!this.get(image.ownerId, image.id)) throw new ImageReplyError("IMAGE_NOT_FOUND", "图片不可用。");
      const current = this.selected(image.ownerId, image.taskId, image.revision);
      if (!current.some(item => item.id === image.id)) {
        if (current.length >= 3) throw new ImageReplyError("IMAGE_LIMIT", "每次回复最多 3 张图片，请先清空再重新选择。");
        this.db.prepare("INSERT INTO image_reply_selections(owner_id,task_id,revision,artifact_id,ordinal) VALUES(?,?,?,?,?)").run(image.ownerId,image.taskId,image.revision,image.id,current.length);
      }
      this.db.exec("COMMIT");
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  public selected(owner: string, task: string, revision: number): ImageArtifact[] { return this.db.prepare("SELECT a.* FROM image_reply_selections s JOIN image_artifacts a ON a.id=s.artifact_id WHERE s.owner_id=? AND s.task_id=? AND s.revision=? AND a.deleted_at IS NULL ORDER BY s.ordinal").all(owner,task,revision).map(decode); }
  public clear(owner: string, task: string, revision: number): void { this.db.prepare("DELETE FROM image_reply_selections WHERE owner_id=? AND task_id=? AND revision=?").run(owner,task,revision); }
  public listBefore(cutoff: string): ImageArtifact[] { return this.db.prepare("SELECT * FROM image_artifacts WHERE created_at<? AND deleted_at IS NULL").all(cutoff).map(decode); }
  public delete(id: string): void { this.db.prepare("UPDATE image_artifacts SET deleted_at=? WHERE id=?").run(new Date().toISOString(),id); }
}
function decodeOptional(row: Record<string,unknown> | undefined): ImageArtifact | undefined { return row ? decode(row) : undefined; }
function decode(row: Record<string,unknown>): ImageArtifact { return {id:String(row.id),ownerId:String(row.owner_id),taskId:String(row.task_id),revision:Number(row.revision),sourceTurnId:String(row.source_turn_id),toolCallId:String(row.tool_call_id),bytes:Number(row.bytes),sha256:String(row.sha256),mimeType:row.mime_type as ImageArtifact["mimeType"],width:Number(row.width),height:Number(row.height),createdAt:String(row.created_at)}; }

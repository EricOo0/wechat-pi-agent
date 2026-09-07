import { DatabaseSync } from "node:sqlite";
import type { UserFileRepository } from "../../../application/interfaces/user-file-repository.js";
import type { ModelFileRef, UserFile } from "../../../domain/files/user-file.js";
export class SqliteUserFileRepository implements UserFileRepository {
  private readonly db: DatabaseSync;
  public constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec("PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;"); }
  public close(): void { this.db.close(); }
  public save(file: UserFile): void {
    this.db.prepare(`INSERT INTO user_files(id,owner_id,message_id,item_index,name,status,bytes,sha256,mime_type,error_code,created_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET status=excluded.status,bytes=excluded.bytes,sha256=excluded.sha256,mime_type=excluded.mime_type,error_code=excluded.error_code`).run(file.id,file.ownerId,file.messageId,file.itemIndex,file.name,file.status,file.bytes,file.sha256,file.mimeType,file.errorCode??null,file.createdAt);
  }
  public get(owner: string, id: string): UserFile | undefined { const row=this.db.prepare("SELECT * FROM user_files WHERE owner_id=? AND id=?").get(owner,id); return row ? decode(row) : undefined; }
  public list(owner: string, query = "", offset = 0): UserFile[] {
    return this.db.prepare("SELECT * FROM user_files WHERE owner_id=? AND instr(lower(name),lower(?))>0 ORDER BY created_at DESC,id DESC LIMIT 20 OFFSET ?").all(owner,query,Math.max(0,Math.floor(offset))).map(decode);
  }
  public usedBytes(owner: string): number { return Number(this.db.prepare("SELECT coalesce(sum(bytes),0) AS bytes FROM user_files WHERE owner_id=? AND status='ready'").get(owner)?.bytes??0); }
  public getModelRef(fileId: string, scope: string): ModelFileRef | undefined { const row=this.db.prepare("SELECT remote_id FROM model_file_refs WHERE file_id=? AND scope=?").get(fileId,scope); return row ? {fileId,scope,remoteId:String(row.remote_id)} : undefined; }
  public saveModelRef(ref: ModelFileRef): void { this.db.prepare("INSERT INTO model_file_refs(file_id,scope,remote_id) VALUES(?,?,?) ON CONFLICT(file_id,scope) DO UPDATE SET remote_id=excluded.remote_id").run(ref.fileId,ref.scope,ref.remoteId); }
  public deleteModelRef(fileId: string, scope: string): void { this.db.prepare("DELETE FROM model_file_refs WHERE file_id=? AND scope=?").run(fileId,scope); }
}
function decode(row: Record<string, unknown>): UserFile {
  return {id:String(row.id),ownerId:String(row.owner_id),messageId:String(row.message_id),itemIndex:Number(row.item_index),name:String(row.name),status:row.status as UserFile["status"],bytes:Number(row.bytes),sha256:String(row.sha256),mimeType:String(row.mime_type),createdAt:String(row.created_at),...(typeof row.error_code === "string" ? {errorCode:row.error_code}:{})};
}

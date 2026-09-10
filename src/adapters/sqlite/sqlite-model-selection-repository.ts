import { DatabaseSync } from "node:sqlite";
import { ModelManagementError, type ModelSelection, type TurnModelBinding } from "../../modules/models/index.js";
import type { ModelSelectionRepository } from "../../modules/models/index.js";
export class SqliteModelSelectionRepository implements ModelSelectionRepository {
  public readonly db: DatabaseSync;
  public constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec("PRAGMA busy_timeout=5000;"); }
  public close(): void { this.db.close(); }
  public get(owner: string, fallback: ModelSelection): ModelSelection {
    const row = this.db.prepare("SELECT * FROM user_model_settings WHERE owner_id=?").get(owner);
    return row ? { providerId: String(row.provider_id), modelId: String(row.model_id), revision: Number(row.revision) } : { ...fallback };
  }
  public select(owner: string, choice: Omit<ModelSelection, "revision">, expected: number, fallback: ModelSelection): ModelSelection {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const previous = this.get(owner, fallback);
      if (previous.revision !== expected) throw new ModelManagementError("SELECTION_CONFLICT", "模型选择已变化，请刷新后重新选择。");
      if (previous.providerId === choice.providerId && previous.modelId === choice.modelId) { this.db.exec("COMMIT"); return previous; }
      const result = { ...choice, revision: previous.revision + 1 };
      this.db.prepare("INSERT INTO user_model_settings VALUES(?,?,?,?,?) ON CONFLICT(owner_id) DO UPDATE SET provider_id=excluded.provider_id,model_id=excluded.model_id,revision=excluded.revision,updated_at=excluded.updated_at").run(owner, result.providerId, result.modelId, result.revision, new Date().toISOString());
      this.db.exec("COMMIT"); return result;
    } catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }
  public credentialRevision(provider: string): number { return Number(this.db.prepare("SELECT revision FROM provider_credential_revisions WHERE provider_id=?").get(provider)?.revision ?? 0); }
  public findBinding(id: string, owner: string): TurnModelBinding | undefined {
    const row = this.db.prepare("SELECT * FROM turn_model_bindings WHERE id=? AND owner_id=?").get(id, owner);
    return row ? { providerId: String(row.provider_id), modelId: String(row.model_id), revision: Number(row.selection_revision), credentialRevision: Number(row.credential_revision) } : undefined;
  }
  public bind(id: string, owner: string, selection: ModelSelection): TurnModelBinding {
    this.db.prepare("INSERT OR IGNORE INTO turn_model_bindings VALUES(?,?,?,?,?,?)").run(id, owner, selection.providerId, selection.modelId, selection.revision, this.credentialRevision(selection.providerId));
    const row = this.db.prepare("SELECT * FROM turn_model_bindings WHERE id=? AND owner_id=?").get(id, owner);
    if (!row) throw new Error("Model binding owner mismatch");
    if (Number(row.credential_revision) !== this.credentialRevision(String(row.provider_id))) throw new ModelManagementError("ACCOUNT_CHANGED", "原任务的认证账户已变化，请重新发送请求；文件仍已保存。");
    return { providerId: String(row.provider_id), modelId: String(row.model_id), revision: Number(row.selection_revision), credentialRevision: Number(row.credential_revision) };
  }
  public audit(type: string, data: unknown): void { this.db.prepare("INSERT INTO model_management_events(event_type,event_at,event_data) VALUES(?,?,?)").run(type, new Date().toISOString(), JSON.stringify(data)); }
  public events(): unknown[] { return this.db.prepare("SELECT event_type,event_at,event_data FROM model_management_events ORDER BY id DESC LIMIT 100").all().map((r) => ({ type: r.event_type, at: r.event_at, data: JSON.parse(String(r.event_data)) as unknown })); }
}

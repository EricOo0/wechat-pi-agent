import type { AuthOperationStore, AuthOperationSummary } from "../../modules/models/index.js";
import type { SqliteModelSelectionRepository } from "./sqlite-model-selection-repository.js";
export class SqliteAuthOperationStore implements AuthOperationStore {
  public constructor(private readonly repository: SqliteModelSelectionRepository) {}
  public pending() {
    return this.repository.db.prepare("SELECT * FROM provider_auth_operations WHERE status NOT IN ('SUCCEEDED','FAILED','CANCELLED','EXPIRED')").all().map(row => ({
      id: String(row.id), provider: String(row.provider_id), status: String(row.status), ...(row.candidate_hash ? { candidateHash: String(row.candidate_hash) } : {}),
    }));
  }
  public create(id: string, provider: string, now: string): void {
    this.repository.db.prepare("INSERT INTO provider_auth_operations(id,provider_id,status,created_at,updated_at) VALUES(?,?,'WAITING_LOCAL',?,?)").run(id, provider, now, now);
  }
  public list(): AuthOperationSummary[] {
    return this.repository.db.prepare("SELECT id,provider_id,status,error FROM provider_auth_operations ORDER BY created_at DESC LIMIT 30").all().map(row => ({
      id: String(row.id), providerId: String(row.provider_id), status: String(row.status), ...(row.error ? { error: String(row.error) } : {}),
    }));
  }
  public update(id: string, status: string, error?: string): void {
    this.repository.db.prepare("UPDATE provider_auth_operations SET status=?,error=?,updated_at=? WHERE id=?").run(status, error ?? null, new Date().toISOString(), id);
  }
  public beginCommit(id: string, fingerprint: string): void {
    this.repository.db.prepare("UPDATE provider_auth_operations SET status='COMMITTING',candidate_hash=?,updated_at=? WHERE id=?").run(fingerprint, new Date().toISOString(), id);
  }
  public finishCommit(id: string, provider: string): void {
    this.repository.db.exec("BEGIN IMMEDIATE");
    try {
      const row = this.repository.db.prepare("SELECT status FROM provider_auth_operations WHERE id=?").get(id);
      if (row?.status !== "SUCCEEDED") {
        this.repository.db.prepare("INSERT INTO provider_credential_revisions VALUES(?,1) ON CONFLICT(provider_id) DO UPDATE SET revision=revision+1").run(provider);
        this.repository.db.prepare("UPDATE provider_auth_operations SET status='SUCCEEDED',candidate_hash=NULL,error=NULL,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      }
      this.repository.db.exec("COMMIT");
    } catch (error) { this.repository.db.exec("ROLLBACK"); throw error; }
    this.audit("provider_auth_operation", { id, providerId: provider, status: "SUCCEEDED" });
  }
  public audit(type: string, data: unknown): void { this.repository.audit(type, data); }
}

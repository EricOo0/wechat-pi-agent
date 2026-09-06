import { DatabaseSync } from "node:sqlite";
import { chmodSync, existsSync } from "node:fs";
import { basicPolicy, permissionPolicySchema, subjectKey, type PermissionSnapshot, type PermissionSubject } from "../../../domain/policy/permissions.js";
import type { PermissionRepository, PermissionRequest } from "../../../application/interfaces/permission-repository.js";

export class SqlitePermissionRepository implements PermissionRepository {
  private readonly db: DatabaseSync;

  public constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS permission_policies (
        subject_key TEXT PRIMARY KEY, subject_json TEXT NOT NULL,
        revision INTEGER NOT NULL, policy_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS permission_requests (
        id TEXT PRIMARY KEY, subject_key TEXT NOT NULL, request_json TEXT NOT NULL
      ) STRICT;
      CREATE INDEX IF NOT EXISTS permission_requests_subject ON permission_requests(subject_key);
      CREATE TABLE IF NOT EXISTS permission_receipts (
        message_key TEXT PRIMARY KEY, response TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS permission_events (
        id INTEGER PRIMARY KEY, subject_key TEXT NOT NULL, message_id TEXT NOT NULL,
        action TEXT NOT NULL, data_json TEXT NOT NULL, created_at TEXT NOT NULL
      ) STRICT;
    `);
    if (path !== ":memory:") {
      for (const file of [path, `${path}-wal`, `${path}-shm`]) if (existsSync(file)) chmodSync(file, 0o600);
    }
  }

  public transaction<T>(work: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try { const result = work(); this.db.exec("COMMIT"); return result; }
    catch (error) { this.db.exec("ROLLBACK"); throw error; }
  }

  public get(subject: PermissionSubject): PermissionSnapshot {
    const row = this.db.prepare("SELECT revision, policy_json FROM permission_policies WHERE subject_key = ?").get(subjectKey(subject));
    return row === undefined
      ? { ...subject, revision: 0, policy: basicPolicy() }
      : { ...subject, revision: Number(row.revision), policy: permissionPolicySchema.parse(JSON.parse(String(row.policy_json))) };
  }

  public save(snapshot: PermissionSnapshot): void {
    this.db.prepare(`INSERT INTO permission_policies VALUES (?, ?, ?, ?)
      ON CONFLICT(subject_key) DO UPDATE SET revision=excluded.revision, policy_json=excluded.policy_json`)
      .run(subjectKey(snapshot), JSON.stringify({ principalId: snapshot.principalId, executorId: snapshot.executorId, workspaceId: snapshot.workspaceId }), snapshot.revision, JSON.stringify(snapshot.policy));
  }

  public putRequest(request: PermissionRequest): void {
    this.db.prepare(`INSERT INTO permission_requests VALUES (?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET request_json=excluded.request_json`)
      .run(request.id, subjectKey(request.subject), JSON.stringify(request));
  }

  public findRequest(id: string): PermissionRequest | undefined {
    const row = this.db.prepare("SELECT request_json FROM permission_requests WHERE id=?").get(id);
    return row === undefined ? undefined : JSON.parse(String(row.request_json)) as PermissionRequest;
  }

  public listRequests(subject: PermissionSubject): PermissionRequest[] {
    return this.db.prepare("SELECT request_json FROM permission_requests WHERE subject_key=?").all(subjectKey(subject))
      .map((row) => JSON.parse(String(row.request_json)) as PermissionRequest);
  }

  public receipt(messageKey: string): string | undefined {
    const row = this.db.prepare("SELECT response FROM permission_receipts WHERE message_key=?").get(messageKey);
    return row === undefined ? undefined : String(row.response);
  }

  public saveReceipt(messageKey: string, response: string): void {
    this.db.prepare("INSERT INTO permission_receipts VALUES (?, ?)").run(messageKey, response);
  }

  public recordEvent(subject: PermissionSubject, message: string, action: string, data: unknown): void {
    this.db.prepare("INSERT INTO permission_events(subject_key,message_id,action,data_json,created_at) VALUES (?,?,?,?,?)")
      .run(subjectKey(subject), message, action, JSON.stringify(data), new Date().toISOString());
  }

  public close(): void { this.db.close(); }
}

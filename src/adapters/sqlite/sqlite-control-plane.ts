import { SqliteTaskStore } from "./sqlite-task-store.js";
import { isTaskInput, type TaskStore } from "../../modules/tasks/index.js";
import { CommandRouter } from "../../modules/messaging/index.js";
import type { EndSessionInput } from "../../modules/conversation/index.js";
import type { ConversationContextEvent } from "../../modules/conversation/index.js";
import type { InboundFileReference } from "../../modules/artifacts/index.js";
import { DatabaseSync } from "node:sqlite";
import type { PathLike } from "node:fs";

import type { AgentInvocationTrace } from "../../runtime/agent/ports/agent.js";
import type {
  CompleteTurnInput,
  ControlPlane,
  FailTurnInput,
} from "./control-plane.js";
import { sessionKey, type ConversationSession } from "../../modules/conversation/index.js";
import type { ClaimedOutbox, OutboxRecord } from "../../modules/messaging/index.js";
import type { AgentEvent } from "../../modules/observability/index.js";
import type { ClaimedTurn, Turn } from "../../modules/turns/index.js";
import type { InboundBatch, InboundImage, InboundMessage } from "../../modules/messaging/index.js";
import { newId, stableId } from "../../shared/ids.js";
import { SQLITE_MIGRATIONS } from "./migrations.js";

type SqliteRow = Record<string, string | number | bigint | Uint8Array | null | undefined>;

function text(row: SqliteRow, column: string): string {
  const value = row[column];
  if (typeof value !== "string") throw new Error(`Expected text column ${column}`);
  return value;
}

function nullableText(row: SqliteRow, column: string): string | undefined {
  const value = row[column];
  if (value === null || value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Expected nullable text column ${column}`);
  return value;
}

function integer(row: SqliteRow, column: string): number {
  const value = row[column];
  if (typeof value === "number") return value;
  if (typeof value === "bigint") return Number(value);
  throw new Error(`Expected integer column ${column}`);
}

function date(value: string): Date {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.valueOf())) throw new Error(`Invalid stored date: ${value}`);
  return parsed;
}

function json(value: string | undefined): unknown {
  return value === undefined ? undefined : JSON.parse(value) as unknown;
}

function serialize(value: unknown): string | null {
  return value === undefined ? null : JSON.stringify(value);
}

function nowIso(): string {
  return new Date().toISOString();
}

export class SqliteControlPlane implements ControlPlane {
  private readonly db: DatabaseSync;
  private readonly traceRetention: number;
  private tasks?: SqliteTaskStore;
  private taskOwner?: (message: InboundMessage, sessionId: string) => string;

  public enableTasks(owner: (message: InboundMessage, sessionId: string) => string): TaskStore {
    this.taskOwner = owner;
    this.tasks = new SqliteTaskStore(this.db);
    return this.tasks;
  }

  public constructor(path: PathLike, options: { traceRetention?: number } = {}) {
    this.traceRetention = options.traceRetention ?? 100;
    this.db = new DatabaseSync(path);
    this.db.exec("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000;");
  }

  public migrate(): void {
    // SQLite table rebuild: disable FK actions before BEGIN, then verify before commit.
    this.db.exec("PRAGMA foreign_keys = OFF");
    try { this.transaction(() => {
      this.db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL) STRICT;");
      const applied = this.db.prepare("SELECT 1 FROM schema_migrations WHERE version = ?");
      const record = this.db.prepare("INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)");
      for (const migration of SQLITE_MIGRATIONS) {
        if (applied.get(migration.version) === undefined) {
          this.db.exec(migration.sql);
          record.run(migration.version, nowIso());
        }
      }
      if (this.db.prepare("PRAGMA foreign_key_check").all().length) throw new Error("Migration left invalid foreign keys");
    }); } finally { this.db.exec("PRAGMA foreign_keys = ON"); }
  }

  public healthCheck(): { ready: boolean; reason?: string } {
    if (!this.db.isOpen) return { ready: false, reason: "database is closed" };
    try {
      this.db.prepare("SELECT 1").get();
      const migration = this.db.prepare("SELECT MAX(version) AS version FROM schema_migrations").get() as SqliteRow | undefined;
      const latest = SQLITE_MIGRATIONS.at(-1)?.version ?? 0;
      if (migration === undefined || integer(migration, "version") !== latest) {
        return { ready: false, reason: "database migrations are not current" };
      }
      return { ready: true };
    } catch (error) {
      return { ready: false, reason: error instanceof Error ? error.message : String(error) };
    }
  }

  public getCursor(accountId: string): string {
    const row = this.db.prepare("SELECT value FROM cursor WHERE account_id = ?").get(accountId) as SqliteRow | undefined;
    return row === undefined ? "" : text(row, "value");
  }

  public getMessageSession(accountId: string, channelMessageId: string): string | undefined {
    const row = this.db.prepare(`SELECT t.session_id FROM inbox i JOIN turns t ON t.inbox_id=i.id
      WHERE i.account_id=? AND i.channel_message_id=?`).get(accountId, channelMessageId);
    return row === undefined ? undefined : String(row.session_id);
  }

  public getPersistedMessage(accountId: string, channelMessageId: string): InboundMessage | undefined {
    const row = this.db.prepare("SELECT * FROM inbox WHERE account_id=? AND channel_message_id=?").get(accountId, channelMessageId);
    return row === undefined ? undefined : this.toMessage(row);
  }

  public ingestBatch(batch: InboundBatch): { inserted: number; rejected: number } {
    return this.transaction(() => {
      const currentCursor = this.getCursor(batch.accountId);
      if (currentCursor !== batch.previousCursor) {
        if (currentCursor === batch.nextCursor) return { inserted: 0, rejected: batch.messages.length };
        throw new Error(`Cursor mismatch for ${batch.accountId}: expected ${currentCursor}, received ${batch.previousCursor}`);
      }

      const timestamp = nowIso();
      let inserted = 0;
      const insertInbox = this.db.prepare(`
        INSERT OR IGNORE INTO inbox
          (id, account_id, channel_message_id, peer_id, sender_id, sequence, context_token, text, received_at, raw_json, images_json, files_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (const message of batch.messages) {
        if (message.accountId !== batch.accountId) {
          throw new Error(`Message ${message.id} belongs to a different account`);
        }
        const result = insertInbox.run(
          message.id,
          message.accountId,
          message.channelMessageId,
          message.peerId,
          message.senderId,
          message.sequence ?? null,
          message.contextToken ?? null,
          message.text,
          message.receivedAt.toISOString(),
          serialize(message.raw),
          serialize(message.images),
          serialize(message.files),
          timestamp,
        );
        if (Number(result.changes) === 0) continue;
        inserted += 1;
        const sessionId = this.ensureActiveSession(message.accountId, message.peerId, timestamp);
        const turnId = stableId("trn", `${message.accountId}_${message.channelMessageId}`);
        this.db.prepare(`
          INSERT INTO turns
            (id, session_id, inbox_id, trace_id, run_id, status, queued_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)
        `).run(
          turnId,
          sessionId,
          message.id,
          stableId("evt", message.id),
          stableId("run", message.id),
          timestamp,
          timestamp,
          timestamp,
        );
        if (this.tasks && this.taskOwner && isTaskInput(message.text, Boolean(message.images?.length || message.files?.length))) {
          const pendingNew = this.db.prepare("SELECT i.text FROM turns t JOIN inbox i ON i.id=t.inbox_id WHERE t.session_id=? AND t.status IN ('QUEUED','RUNNING') AND t.source='user_message'").all(sessionId)
            .some(row => new CommandRouter().route(String(row.text)).type === 'new');
          if (!pendingNew) this.tasks.attach(sessionId, this.taskOwner(message, sessionId), turnId, message.text);
        }
      }
      this.db.prepare(`
        INSERT INTO cursor (account_id, value, updated_at) VALUES (?, ?, ?)
        ON CONFLICT(account_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
      `).run(batch.accountId, batch.nextCursor, timestamp);
      return { inserted, rejected: batch.messages.length - inserted };
    });
  }

  public claimNextTurn(ownerId: string, leaseMs: number): ClaimedTurn | undefined {
    if (leaseMs <= 0) throw new Error("leaseMs must be positive");
    return this.transaction(() => {
      const row = this.db.prepare(`
        SELECT candidate.id FROM turns candidate WHERE candidate.status = 'QUEUED'
          AND NOT EXISTS (SELECT 1 FROM turns running WHERE running.session_id = candidate.session_id AND running.status = 'RUNNING')
          ORDER BY candidate.queued_at, candidate.id LIMIT 1
      `).get() as SqliteRow | undefined;
      if (row === undefined) return undefined;
      const turnId = text(row, "id");
      const timestamp = nowIso();
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      const claimed = this.db.prepare(`
        UPDATE turns SET status = 'RUNNING', started_at = ?, lease_owner = ?, lease_expires_at = ?,
          error_code = NULL, error_message = NULL, updated_at = ?
        WHERE id = ? AND status = 'QUEUED'
      `).run(timestamp, ownerId, leaseUntil, timestamp, turnId);
      if (Number(claimed.changes) !== 1) return undefined;
      const claimedTurn = this.loadClaimedTurn(turnId);
      if (this.tasks && this.taskOwner && !claimedTurn.turn.taskId && isTaskInput(claimedTurn.message.text, Boolean(claimedTurn.message.files?.length || claimedTurn.message.images?.length))) {
        this.tasks.attach(claimedTurn.session.id, this.taskOwner(claimedTurn.message, claimedTurn.session.id), turnId, claimedTurn.message.text);
        return this.loadClaimedTurn(turnId);
      }
      return claimedTurn;
    });
  }

  public appendAgentEvent(turnId: string, event: AgentEvent): void {
    this.transaction(() => {
      const exists = this.db.prepare("SELECT 1 FROM turns WHERE id = ?").get(turnId);
      if (exists === undefined) throw new Error(`Turn not found: ${turnId}`);
      const ordinalRow = this.db.prepare("SELECT COALESCE(MAX(ordinal), -1) + 1 AS ordinal FROM steps WHERE turn_id = ?").get(turnId) as SqliteRow;
      const ordinal = integer(ordinalRow, "ordinal");
      const failed = (event.data?.status === "failed") || event.type.toLowerCase().includes("error") || event.type.toLowerCase().includes("fail");
      this.db.prepare(`
        INSERT INTO steps
          (id, turn_id, ordinal, kind, name, status, started_at, ended_at, error_json, event_type, event_at, event_data_json, created_at)
        VALUES (?, ?, ?, 'agent_run', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        newId("stp"), turnId, ordinal, event.type, failed ? "FAILED" : "SUCCEEDED",
        event.at.toISOString(), event.at.toISOString(), failed ? serialize(event.data) : null,
        event.type, event.at.toISOString(), serialize(event.data), nowIso(),
      );
    });
  }

  public recordAgentInvocation(turnId: string, trace: AgentInvocationTrace): void {
    this.transaction(() => {
      const exists = this.db.prepare("SELECT 1 FROM turns WHERE id = ?").get(turnId);
      if (exists === undefined) throw new Error(`Turn not found: ${turnId}`);
      this.db.prepare(`
        INSERT INTO agent_traces
          (turn_id, provider, model_id, system_prompt, skills_json, tools_json, captured_at, permission_revision, permission_mode)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(turn_id) DO UPDATE SET
          provider = excluded.provider,
          model_id = excluded.model_id,
          system_prompt = excluded.system_prompt,
          skills_json = excluded.skills_json,
          tools_json = excluded.tools_json,
          captured_at = excluded.captured_at,
          permission_revision = excluded.permission_revision,
          permission_mode = excluded.permission_mode
      `).run(
        turnId,
        trace.provider,
        trace.modelId,
        trace.systemPrompt,
        serialize(trace.skills),
        serialize(trace.tools),
        nowIso(),
        trace.permissionRevision ?? null,
        trace.permissionMode ?? null,
      );
      this.db.prepare(`
        DELETE FROM agent_traces WHERE turn_id IN (
          SELECT turn_id FROM agent_traces ORDER BY captured_at DESC, rowid DESC LIMIT -1 OFFSET ?
        )
      `).run(this.traceRetention);
    });
  }

  public completeTurn(input: CompleteTurnInput): void {
    this.transaction(() => {
      const row = this.db.prepare(`
        SELECT t.status, t.run_id, t.session_id, i.account_id, i.peer_id, i.context_token
        FROM turns t JOIN inbox i ON i.id = t.inbox_id WHERE t.id = ?
      `).get(input.turnId) as SqliteRow | undefined;
      if (row === undefined) throw new Error(`Turn not found: ${input.turnId}`);
      if (text(row, "status") !== "RUNNING") {
        if (input.taskSettlement) return;
        throw new Error(`Turn is not running: ${input.turnId}`);
      }
      if (input.taskSettlement && this.tasks && !this.tasks.settle({ ...input.taskSettlement, turnId: input.turnId })) input = { ...input, chunks: [] };
      const timestamp = nowIso();
      this.db.prepare(`
        UPDATE turns SET status = ?, final_response = ?, completed_at = ?, lease_owner = NULL,
          lease_expires_at = NULL, updated_at = ? WHERE id = ?
      `).run(input.chunks.length === 0 ? "SUCCEEDED" : "REPLY_PENDING", input.finalResponse, timestamp, timestamp, input.turnId);

      if (input.piSessionId !== undefined || input.piSessionFile !== undefined) {
        this.updateSessionPiLocator(text(row, "session_id"), input.piSessionId, input.piSessionFile);
      }
      const insert = this.db.prepare(`
        INSERT INTO outbox
          (id, turn_id, account_id, peer_id, context_token, chunk_index, text, client_id, run_id,
           status, attempt_count, next_attempt_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)
      `);
      input.chunks.forEach((chunk, index) => {
        const id = stableId("out", `${input.turnId}_${index}`);
        insert.run(
          id, input.turnId, text(row, "account_id"), text(row, "peer_id"), nullableText(row, "context_token") ?? null,
          index, chunk, id, text(row, "run_id"), timestamp, timestamp, timestamp,
        );
      });
      if (input.continuation) this.enqueuePermissionContinuation(input.turnId, input.continuation, timestamp);
    });
  }

  /** Runs inside completeTurn's transaction: reply and unique continuation commit together. */
  private enqueuePermissionContinuation(approvalTurnId: string, continuation: NonNullable<CompleteTurnInput["continuation"]>, timestamp: string): void {
    const exists = this.db.prepare("SELECT 1 FROM permission_continuations WHERE permission_request_id=?").get(continuation.permissionRequestId);
    if (exists) return;
    const approval = this.loadClaimedTurn(approvalTurnId);
    const source = this.loadClaimedTurn(continuation.sourceTurnId);
    if (source.session.id !== approval.session.id || source.session.status !== "ACTIVE"
      || source.message.senderId !== approval.message.senderId || source.message.accountId !== approval.message.accountId
      || source.message.peerId !== approval.message.peerId) throw new Error("Permission continuation source does not match the confirmed user/session");
    if (this.tasks && source.turn.taskId) {
      const continued = this.tasks.wakePermission(source.turn.taskId, `用户已确认权限 ${continuation.permissionRequestId}。检查当前权限和已有结果，继续任务，不重复已完成操作。`);
      if (continued) this.db.prepare("INSERT INTO permission_continuations VALUES (?,?,?,?,?)").run(continuation.permissionRequestId, source.turn.id, approvalTurnId, continued, timestamp);
      return;
    }
    const inboxId = newId("msg");
    const turnId = newId("trn");
    const prompt = `用户已确认本任务的权限申请（${continuation.permissionRequestId}）。请检查当前权限和已有会话／工具结果，从被权限阻塞的位置继续；不要从头重复已经完成的操作。若任务已完成，只说明结果。\n\n原始任务：\n${source.message.text}`;
    this.db.prepare(`INSERT INTO inbox (id,account_id,channel_message_id,peer_id,sender_id,context_token,text,received_at,images_json,created_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)`).run(inboxId, approval.message.accountId, `permission-resume:${continuation.permissionRequestId}`,
      approval.message.peerId, approval.message.senderId, approval.message.contextToken ?? null, prompt, timestamp, serialize(source.message.images), timestamp);
    this.db.prepare(`INSERT INTO turns (id,session_id,inbox_id,trace_id,run_id,status,queued_at,created_at,updated_at)
      VALUES (?,?,?,?,?,'QUEUED',?,?,?)`).run(turnId, source.session.id, inboxId, newId("evt"), newId("run"), timestamp, timestamp, timestamp);
    this.db.prepare("INSERT INTO permission_continuations VALUES (?,?,?,?,?)")
      .run(continuation.permissionRequestId, source.turn.id, approvalTurnId, turnId, timestamp);
  }

  public failTurn(input: FailTurnInput): void {
    this.transaction(() => {
    const timestamp = nowIso();
    const result = this.db.prepare(`
      UPDATE turns SET status = 'FAILED', error_code = ?, error_message = ?, completed_at = ?,
        lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ? AND status = 'RUNNING'
    `).run(input.errorCode, input.errorMessage, timestamp, timestamp, input.turnId);
    if (Number(result.changes) !== 1) throw new Error(`Running turn not found: ${input.turnId}`);
    this.tasks?.turnFailed(input.turnId, input.errorCode);
    });
  }

  public updateSessionPiLocator(sessionId: string, piSessionId?: string, piSessionFile?: string): void {
    const result = this.db.prepare(`
      UPDATE sessions SET pi_session_id = COALESCE(?, pi_session_id),
        pi_session_file = COALESCE(?, pi_session_file), updated_at = ? WHERE id = ?
    `).run(piSessionId ?? null, piSessionFile ?? null, nowIso(), sessionId);
    if (Number(result.changes) !== 1) throw new Error(`Session not found: ${sessionId}`);
  }

  public claimNextOutbox(ownerId: string, leaseMs: number): ClaimedOutbox | undefined {
    if (leaseMs <= 0) throw new Error("leaseMs must be positive");
    return this.transaction(() => {
      const timestamp = nowIso();
      const row = this.db.prepare(`
        SELECT id FROM outbox
        WHERE status IN ('PENDING', 'RETRY_WAIT') AND next_attempt_at <= ?
        ORDER BY next_attempt_at, created_at, chunk_index LIMIT 1
      `).get(timestamp) as SqliteRow | undefined;
      if (row === undefined) return undefined;
      const outboxId = text(row, "id");
      const leaseUntil = new Date(Date.now() + leaseMs).toISOString();
      const updated = this.db.prepare(`
        UPDATE outbox SET status = 'SENDING', attempt_count = attempt_count + 1,
          lease_owner = ?, lease_expires_at = ?, updated_at = ?
        WHERE id = ? AND status IN ('PENDING', 'RETRY_WAIT') AND next_attempt_at <= ?
      `).run(ownerId, leaseUntil, timestamp, outboxId, timestamp);
      if (Number(updated.changes) !== 1) return undefined;
      const claimed = this.db.prepare("SELECT * FROM outbox WHERE id = ?").get(outboxId) as SqliteRow;
      const attemptNo = integer(claimed, "attempt_count");
      this.db.prepare(`
        INSERT INTO outbox_attempts (outbox_id, attempt_no, owner_id, started_at, status)
        VALUES (?, ?, ?, ?, 'STARTED')
      `).run(outboxId, attemptNo, ownerId, timestamp);
      return { message: this.toOutbox(claimed), attemptNo };
    });
  }

  public markOutboxSent(outboxId: string, remoteRequestId?: string): void {
    this.transaction(() => {
      const timestamp = nowIso();
      const row = this.db.prepare("SELECT turn_id, attempt_count FROM outbox WHERE id = ? AND status = 'SENDING'").get(outboxId) as SqliteRow | undefined;
      if (row === undefined) throw new Error(`Sending outbox record not found: ${outboxId}`);
      const attemptNo = integer(row, "attempt_count");
      this.db.prepare(`
        UPDATE outbox SET status = 'SENT', remote_request_id = ?, sent_at = ?,
          lease_owner = NULL, lease_expires_at = NULL, updated_at = ? WHERE id = ?
      `).run(remoteRequestId ?? null, timestamp, timestamp, outboxId);
      this.db.prepare(`
        UPDATE outbox_attempts SET status = 'SENT', completed_at = ?, remote_request_id = ?
        WHERE outbox_id = ? AND attempt_no = ?
      `).run(timestamp, remoteRequestId ?? null, outboxId, attemptNo);
      const turnId = text(row, "turn_id");
      const pending = this.db.prepare("SELECT 1 FROM outbox WHERE turn_id = ? AND status <> 'SENT' LIMIT 1").get(turnId);
      if (pending === undefined) {
        this.db.prepare("UPDATE turns SET status = 'SUCCEEDED', updated_at = ? WHERE id = ? AND status = 'REPLY_PENDING'").run(timestamp, turnId);
      }
    });
  }

  public markOutboxFailed(outboxId: string, error: Error, retryAt: Date, maxAttempts: number): void {
    if (maxAttempts <= 0) throw new Error("maxAttempts must be positive");
    this.transaction(() => {
      const row = this.db.prepare("SELECT turn_id, attempt_count FROM outbox WHERE id = ? AND status = 'SENDING'").get(outboxId) as SqliteRow | undefined;
      if (row === undefined) throw new Error(`Sending outbox record not found: ${outboxId}`);
      const attemptNo = integer(row, "attempt_count");
      const dead = attemptNo >= maxAttempts;
      const timestamp = nowIso();
      this.db.prepare(`
        UPDATE outbox SET status = ?, next_attempt_at = ?, last_error = ?, lease_owner = NULL,
          lease_expires_at = NULL, updated_at = ? WHERE id = ?
      `).run(dead ? "DEAD_LETTER" : "RETRY_WAIT", retryAt.toISOString(), error.message, timestamp, outboxId);
      this.db.prepare(`
        UPDATE outbox_attempts SET status = 'FAILED', completed_at = ?, error_name = ?, error_message = ?, retry_at = ?
        WHERE outbox_id = ? AND attempt_no = ?
      `).run(timestamp, error.name, error.message, retryAt.toISOString(), outboxId, attemptNo);
      if (dead) {
        this.db.prepare(`
          UPDATE turns SET status = 'DEAD_LETTER', error_code = 'OUTBOX_MAX_ATTEMPTS',
            error_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'REPLY_PENDING'
        `).run(error.message, timestamp, timestamp, text(row, "turn_id"));
      }
    });
  }

  public recoverInterrupted(now: Date): { turns: number; outbox: number } {
    return this.transaction(() => {
      const timestamp = now.toISOString();
      this.db.prepare("UPDATE turns SET status='CANCELLED',error_code='SESSION_INTERRUPTED',completed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE status IN ('QUEUED','RUNNING') AND session_id IN (SELECT id FROM sessions WHERE status<>'ACTIVE')").run(timestamp);
      const turns = this.db.prepare(`
        UPDATE turns SET status = 'QUEUED', started_at = NULL, lease_owner = NULL, lease_expires_at = NULL,
          queued_at = ?, updated_at = ? WHERE status = 'RUNNING' AND lease_expires_at <= ?
      `).run(timestamp, timestamp, timestamp);
      this.db.prepare(`
        UPDATE steps SET status = 'INTERRUPTED', ended_at = ?
        WHERE status = 'RUNNING' AND turn_id IN (SELECT id FROM turns WHERE status = 'QUEUED' AND updated_at = ?)
      `).run(timestamp, timestamp);
      const outbox = this.db.prepare(`
        UPDATE outbox SET status = 'RETRY_WAIT', lease_owner = NULL,
          lease_expires_at = NULL, updated_at = ? WHERE status = 'SENDING' AND lease_expires_at <= ?
      `).run(timestamp, timestamp);
      this.db.prepare(`
        UPDATE outbox_attempts SET status = 'INTERRUPTED', completed_at = ?
        WHERE status = 'STARTED' AND outbox_id IN
          (SELECT id FROM outbox WHERE status = 'RETRY_WAIT' AND updated_at = ?)
      `).run(timestamp, timestamp);
      return { turns: Number(turns.changes), outbox: Number(outbox.changes) };
    });
  }

  public listActiveSessions(): ConversationSession[] {
    return (this.db.prepare("SELECT * FROM sessions WHERE status='ACTIVE'").all() as SqliteRow[]).map(row => this.toSession(row));
  }
  public sessionMessage(sessionId: string): InboundMessage | undefined {
    const row = this.db.prepare("SELECT i.* FROM inbox i JOIN turns t ON t.inbox_id=i.id WHERE t.session_id=? ORDER BY t.rowid DESC LIMIT 1").get(sessionId) as SqliteRow | undefined;
    return row ? this.toMessage(row) : undefined;
  }
  public pendingSessionCleanup(): string[] {
    return this.db.prepare("SELECT id FROM sessions WHERE status='ARCHIVED' AND cleanup_done=0").all().map(row => String(row.id));
  }
  public markSessionCleaned(id: string): void { this.db.prepare("UPDATE sessions SET cleanup_done=1 WHERE id=? AND status='ARCHIVED'").run(id); }
  public endSession(input: EndSessionInput): boolean {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM sessions WHERE id=? AND status='ACTIVE'").get(input.sessionId) as SqliteRow | undefined;
      if (!row) return false;
      const busy = this.db.prepare("SELECT id FROM turns WHERE session_id=? AND status IN ('QUEUED','RUNNING') AND id<>?").all(input.sessionId, input.currentTurnId ?? "");
      if (input.reason === "idle_timeout") {
        if (this.tasks?.preventsIdle(input.sessionId)) return false;
        if (busy.length) return false;
        const activity = this.db.prepare(`SELECT max(at) AS at FROM (
          SELECT i.created_at AS at FROM inbox i JOIN turns t ON t.inbox_id=i.id WHERE t.session_id=?
          UNION ALL SELECT completed_at AS at FROM turns WHERE session_id=? AND completed_at IS NOT NULL
        )`).get(input.sessionId,input.sessionId);
        const last = String(activity?.at ?? row.created_at);
        if (Date.parse(last) > input.now.getTime() - (input.idleMs ?? 3_600_000)) return false;
      }
      if (input.reason === "manual" && this.db.prepare("SELECT 1 FROM turns WHERE session_id=? AND status='RUNNING' AND id<>?").get(input.sessionId,input.currentTurnId??"")) return false;
      const ended = input.now.toISOString();
      this.tasks?.closeConversation(input.sessionId);
      if (this.tasks) this.db.prepare("UPDATE turns SET status='CANCELLED',completed_at=? WHERE session_id=? AND status='QUEUED' AND source<>'user_message'").run(ended, input.sessionId);
      this.db.prepare("UPDATE sessions SET status='ARCHIVED',archived_at=?,end_reason=?,updated_at=?,cleanup_done=0 WHERE id=?").run(ended,input.reason,ended,input.sessionId);
      if (input.reason === "manual") {
        // Messages already queued after /new belong to the new conversation, not the sealed one.
        this.db.prepare("UPDATE turns SET status='CANCELLED',error_code='SESSION_ENDED',completed_at=? WHERE session_id=? AND status='QUEUED' AND id IN (SELECT continuation_turn_id FROM permission_continuations)").run(ended,input.sessionId);
        const queued = this.db.prepare("SELECT 1 FROM turns WHERE session_id=? AND status='QUEUED'").get(input.sessionId);
        if (queued) {
          const next = this.ensureActiveSession(text(row,"account_id"),text(row,"peer_id"),ended);
          this.db.prepare("UPDATE turns SET session_id=?,task_id=NULL,task_revision=NULL WHERE session_id=? AND status='QUEUED'").run(next,input.sessionId);
        }
      } else if (input.reason === "shutdown" || input.reason === "recovery") {
        this.db.prepare("UPDATE turns SET status='CANCELLED',error_code='SESSION_INTERRUPTED',error_message='Session ended before this task completed',completed_at=?,lease_owner=NULL,lease_expires_at=NULL WHERE session_id=? AND status IN ('QUEUED','RUNNING')").run(ended,input.sessionId);
      }
      const day = new Intl.DateTimeFormat("en-CA",{year:"numeric",month:"2-digit",day:"2-digit"}).format(input.now);
      this.db.prepare(`INSERT OR IGNORE INTO memory_jobs(id,session_id,owner_id,detail_id,ended_at,reason,next_attempt_at)
        VALUES(?,?,?,?,?,?,?)`).run(`mem_${input.sessionId}`,input.sessionId,input.ownerId,`sessions/${day}/${input.sessionId}.md`,ended,input.reason,ended);
      return true;
    });
  }

  public archiveActiveSession(accountId: string, peerId: string): ConversationSession | undefined {
    return this.transaction(() => {
      const row = this.db.prepare("SELECT * FROM sessions WHERE account_id = ? AND peer_id = ? AND status = 'ACTIVE'").get(accountId, peerId) as SqliteRow | undefined;
      if (row === undefined) return undefined;
      const timestamp = nowIso();
      this.db.prepare("UPDATE sessions SET status = 'ARCHIVED', archived_at = ?, updated_at = ? WHERE id = ?").run(timestamp, timestamp, text(row, "id"));
      return this.toSession({ ...row, status: "ARCHIVED", archived_at: timestamp, updated_at: timestamp });
    });
  }

  public getSessionContextEvents(beforeTurnId: string, ownerId: string): ConversationContextEvent[] {
    // Replay completed file-only application replies, independent of trace retention.
    // The current Turn is the upper bound: never attach a later upload to an earlier request.
    const rows = this.db.prepare(`
      SELECT t.id, t.queued_at, t.final_response, i.channel_message_id
      FROM turns t JOIN inbox i ON i.id=t.inbox_id JOIN turns current ON current.id=?
      WHERE t.session_id=current.session_id AND t.rowid<current.rowid
        AND t.source='user_message' AND t.final_response IS NOT NULL AND trim(i.text)=''
        AND i.files_json IS NOT NULL AND coalesce(json_array_length(i.images_json),0)=0
      ORDER BY t.rowid DESC LIMIT 20
    `).all(beforeTurnId) as SqliteRow[];
    return rows.reverse().flatMap(row => {
      const files = this.db.prepare(`SELECT id,name,status,bytes,mime_type,error_code FROM user_files
        WHERE owner_id=? AND message_id=? ORDER BY item_index`).all(ownerId, text(row, "channel_message_id"));
      if (!files.length) return [];
      const at = text(row, "queued_at");
      return [{ id: `file_receipt:${text(row, "id")}`, kind: "file_receipt" as const, at,
        content: JSON.stringify({ at, userAction: "uploaded_files", files: files.map(file => ({
          fileId: file.id, name: file.name, status: file.status, bytes: file.bytes,
          mimeType: file.mime_type, ...(file.error_code ? { errorCode: file.error_code } : {}),
        })), applicationReply: text(row, "final_response") }) }];
    });
  }

  public getTurnDetails(turnId: string): unknown {
    const row = this.db.prepare(`
      SELECT t.*, s.session_key, s.account_id AS session_account_id, s.peer_id AS session_peer_id,
        s.pi_session_id, s.pi_session_file, s.status AS session_status,
        s.created_at AS session_created_at, s.updated_at AS session_updated_at,
        i.account_id AS inbox_account_id, i.channel_message_id, i.peer_id AS inbox_peer_id,
        i.sender_id, i.sequence, i.context_token, i.text AS inbox_text, i.received_at, i.raw_json, i.images_json, i.files_json
      FROM turns t JOIN sessions s ON s.id = t.session_id JOIN inbox i ON i.id = t.inbox_id
      WHERE t.id = ?
    `).get(turnId) as SqliteRow | undefined;
    if (row === undefined) return undefined;
    const steps = this.db.prepare("SELECT * FROM steps WHERE turn_id = ? ORDER BY ordinal").all(turnId) as SqliteRow[];
    const outbox = this.db.prepare("SELECT * FROM outbox WHERE turn_id = ? ORDER BY chunk_index").all(turnId) as SqliteRow[];
    return {
      turn: this.toTurn(row),
      session: this.toSession({
        id: row.session_id, session_key: row.session_key, account_id: row.session_account_id,
        peer_id: row.session_peer_id, pi_session_id: row.pi_session_id, pi_session_file: row.pi_session_file,
        status: row.session_status, created_at: row.session_created_at, updated_at: row.session_updated_at,
      }),
      message: this.toMessage({
        id: row.inbox_id, account_id: row.inbox_account_id, channel_message_id: row.channel_message_id,
        peer_id: row.inbox_peer_id, sender_id: row.sender_id, sequence: row.sequence,
        context_token: row.context_token, text: row.input_text ?? row.inbox_text, received_at: row.received_at, raw_json: row.raw_json,
        images_json: row.images_json, files_json: row.source === "user_message" ? row.files_json : null,
      }, true),
      steps: steps.map((step) => ({
        ...step,
        started_at: nullableText(step, "started_at") === undefined ? undefined : date(text(step, "started_at")),
        ended_at: nullableText(step, "ended_at") === undefined ? undefined : date(text(step, "ended_at")),
        error: json(nullableText(step, "error_json")),
        eventData: json(nullableText(step, "event_data_json")),
      })),
      outbox: outbox.map((item) => this.toOutbox(item)),
    };
  }

  public getAgentTrace(turnId: string): unknown {
    const row = this.db.prepare(`
      SELECT a.*, t.id AS turn_id, coalesce(a.provider,'') AS provider, coalesce(a.model_id,'') AS model_id, coalesce(a.system_prompt,'') AS system_prompt, coalesce(a.skills_json,'[]') AS skills_json, coalesce(a.tools_json,'[]') AS tools_json, coalesce(a.captured_at,t.queued_at) AS captured_at, t.session_id, t.source, t.task_id, t.task_revision, t.queued_at, t.status, t.started_at, t.completed_at, t.final_response, t.error_code, t.error_message,
        coalesce(t.input_text,i.text) AS user_prompt
      FROM turns t
      LEFT JOIN agent_traces a ON t.id = a.turn_id
      JOIN inbox i ON i.id = t.inbox_id
      WHERE t.id = ?
    `).get(turnId) as SqliteRow | undefined;
    if (row === undefined) return undefined;
    return this.toAgentTrace(row);
  }

  public getRecentAgentTraces(limit: number): readonly unknown[] {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("limit must be a positive integer");
    const rows = this.db.prepare(`
      SELECT t.id AS turn_id, coalesce(a.provider,'') AS provider, coalesce(a.model_id,'') AS model_id, coalesce(a.skills_json,'[]') AS skills_json, coalesce(a.tools_json,'[]') AS tools_json, coalesce(a.captured_at,t.queued_at) AS captured_at, a.permission_revision, a.permission_mode,
        t.session_id, t.source, t.task_id, t.task_revision, t.queued_at, t.status, t.started_at, t.completed_at, t.final_response, t.error_code, t.error_message,
        coalesce(t.input_text,i.text) AS user_prompt
      FROM turns t
      LEFT JOIN agent_traces a ON t.id = a.turn_id
      JOIN inbox i ON i.id = t.inbox_id
      ORDER BY coalesce(a.captured_at,t.queued_at) DESC, t.rowid DESC
      LIMIT ?
    `).all(limit) as SqliteRow[];
    return rows.map((row) => ({
      turnId: text(row, "turn_id"),
      sessionId: text(row, "session_id"),
      queuedAt: date(text(row, "queued_at")),
      source: text(row, "source") as NonNullable<Turn["source"]>,
      ...(row.task_id ? { taskId: text(row, "task_id"), taskRevision: integer(row, "task_revision") } : {}),
      provider: text(row, "provider"),
      modelId: text(row, "model_id"),
      status: text(row, "status"),
      userPrompt: text(row, "user_prompt"),
      finalResponse: nullableText(row, "final_response"),
      errorCode: nullableText(row, "error_code"),
      errorMessage: nullableText(row, "error_message"),
      skills: json(text(row, "skills_json")),
      tools: json(text(row, "tools_json")),
      permissionRevision: row.permission_revision == null ? undefined : Number(row.permission_revision),
      permissionMode: nullableText(row, "permission_mode"),
      capturedAt: date(text(row, "captured_at")),
      startedAt: nullableText(row, "started_at") === undefined ? undefined : date(text(row, "started_at")),
      completedAt: nullableText(row, "completed_at") === undefined ? undefined : date(text(row, "completed_at")),
    }));
  }

  public getRecentErrors(limit: number): readonly unknown[] {
    if (!Number.isInteger(limit) || limit < 0) throw new Error("limit must be a non-negative integer");
    const rows = this.db.prepare(`
      SELECT id, 'turn' AS source, error_code AS code, error_message AS message, completed_at AS occurred_at
      FROM turns WHERE error_message IS NOT NULL
      UNION ALL
      SELECT id, 'outbox' AS source, status AS code, last_error AS message, updated_at AS occurred_at
      FROM outbox WHERE last_error IS NOT NULL
      ORDER BY occurred_at DESC LIMIT ?
    `).all(limit) as SqliteRow[];
    return rows.map((row) => ({
      id: text(row, "id"), source: text(row, "source"), code: nullableText(row, "code"),
      message: text(row, "message"), occurredAt: date(text(row, "occurred_at")),
    }));
  }

  public close(): void {
    if (this.db.isOpen) this.db.close();
  }

  private toAgentTrace(row: SqliteRow): unknown {
    return {
      turnId: text(row, "turn_id"),
      sessionId: text(row, "session_id"),
      queuedAt: date(text(row, "queued_at")),
      source: text(row, "source") as NonNullable<Turn["source"]>,
      ...(row.task_id ? { taskId: text(row, "task_id"), taskRevision: integer(row, "task_revision") } : {}),
      provider: text(row, "provider"),
      modelId: text(row, "model_id"),
      systemPrompt: text(row, "system_prompt"),
      permissionRevision: row.permission_revision == null ? undefined : Number(row.permission_revision),
      permissionMode: nullableText(row, "permission_mode"),
      skills: json(text(row, "skills_json")),
      tools: json(text(row, "tools_json")),
      userPrompt: text(row, "user_prompt"),
      status: text(row, "status"),
      finalResponse: nullableText(row, "final_response"),
      errorCode: nullableText(row, "error_code"),
      errorMessage: nullableText(row, "error_message"),
      capturedAt: date(text(row, "captured_at")),
      startedAt: nullableText(row, "started_at") === undefined ? undefined : date(text(row, "started_at")),
      completedAt: nullableText(row, "completed_at") === undefined ? undefined : date(text(row, "completed_at")),
    };
  }

  private ensureActiveSession(accountId: string, peerId: string, timestamp: string): string {
    const existing = this.db.prepare(`
      SELECT id FROM sessions WHERE account_id = ? AND peer_id = ? AND status = 'ACTIVE'
    `).get(accountId, peerId) as SqliteRow | undefined;
    if (existing !== undefined) return text(existing, "id");
    const id = newId("ses");
    this.db.prepare(`
      INSERT INTO sessions (id, session_key, account_id, peer_id, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'ACTIVE', ?, ?)
    `).run(id, sessionKey(accountId, peerId), accountId, peerId, timestamp, timestamp);
    return id;
  }

  private loadClaimedTurn(turnId: string): ClaimedTurn {
    const row = this.db.prepare(`
      SELECT t.*, s.session_key, s.account_id AS session_account_id, s.peer_id AS session_peer_id,
        s.pi_session_id, s.pi_session_file, s.status AS session_status,
        s.created_at AS session_created_at, s.updated_at AS session_updated_at,
        i.account_id AS inbox_account_id, i.channel_message_id, i.peer_id AS inbox_peer_id,
        i.sender_id, i.sequence, i.context_token, i.text AS inbox_text, i.received_at, i.raw_json, i.images_json, i.files_json
      FROM turns t JOIN sessions s ON s.id = t.session_id JOIN inbox i ON i.id = t.inbox_id WHERE t.id = ?
    `).get(turnId) as SqliteRow | undefined;
    if (row === undefined) throw new Error(`Turn not found after claim: ${turnId}`);
    return {
      turn: this.toTurn(row),
      session: this.toSession({
        id: row.session_id, session_key: row.session_key, account_id: row.session_account_id,
        peer_id: row.session_peer_id, pi_session_id: row.pi_session_id, pi_session_file: row.pi_session_file,
        status: row.session_status, created_at: row.session_created_at, updated_at: row.session_updated_at,
      }),
      message: this.toMessage({
        id: row.inbox_id, account_id: row.inbox_account_id, channel_message_id: row.channel_message_id,
        peer_id: row.inbox_peer_id, sender_id: row.sender_id, sequence: row.sequence,
        context_token: row.context_token, text: row.input_text ?? row.inbox_text, received_at: row.received_at, raw_json: row.raw_json,
        images_json: row.images_json, files_json: row.source === "user_message" ? row.files_json : null,
      }),
      ...this.continuationForTurn(turnId),
    };
  }

  private continuationForTurn(turnId: string): Pick<ClaimedTurn, "continuation"> {
    const row = this.db.prepare("SELECT permission_request_id,source_turn_id FROM permission_continuations WHERE continuation_turn_id=?").get(turnId);
    return row === undefined ? {} : { continuation: { permissionRequestId: String(row.permission_request_id), sourceTurnId: String(row.source_turn_id) } };
  }

  private toSession(row: SqliteRow): ConversationSession {
    const piSessionId = nullableText(row, "pi_session_id");
    const piSessionFile = nullableText(row, "pi_session_file");
    return {
      id: text(row, "id"), key: text(row, "session_key"), accountId: text(row, "account_id"),
      peerId: text(row, "peer_id"), status: text(row, "status") as ConversationSession["status"],
      createdAt: date(text(row, "created_at")), updatedAt: date(text(row, "updated_at")),
      ...(row.archived_at ? { endedAt: date(text(row,"archived_at")) } : {}),
      ...(row.end_reason ? { endReason: text(row,"end_reason") as NonNullable<ConversationSession["endReason"]> } : {}),
      ...(piSessionId === undefined ? {} : { piSessionId }),
      ...(piSessionFile === undefined ? {} : { piSessionFile }),
    };
  }

  private toTurn(row: SqliteRow): Turn {
    const optional = (column: string): string | undefined => nullableText(row, column);
    return {
      id: text(row, "id"), sessionId: text(row, "session_id"), inboxId: text(row, "inbox_id"),
      traceId: text(row, "trace_id"), runId: text(row, "run_id"), status: text(row, "status") as Turn["status"],
      queuedAt: date(text(row, "queued_at")),
      source: text(row, "source") as NonNullable<Turn["source"]>,
      ...(row.task_id ? { taskId: text(row, "task_id"), taskRevision: integer(row, "task_revision") } : {}),
      ...(optional("started_at") === undefined ? {} : { startedAt: date(text(row, "started_at")) }),
      ...(optional("completed_at") === undefined ? {} : { completedAt: date(text(row, "completed_at")) }),
      ...(optional("final_response") === undefined ? {} : { finalResponse: text(row, "final_response") }),
      ...(optional("error_code") === undefined ? {} : { errorCode: text(row, "error_code") }),
      ...(optional("error_message") === undefined ? {} : { errorMessage: text(row, "error_message") }),
    };
  }

  private toMessage(row: SqliteRow, redactFiles = false): InboundMessage {
    const sequenceValue = row.sequence;
    const contextToken = nullableText(row, "context_token");
    const rawValue = json(nullableText(row, "raw_json"));
    const filesValue = json(nullableText(row, "files_json"));
    const files = Array.isArray(filesValue) ? filesValue as InboundFileReference[] : undefined;
    const imagesValue = json(nullableText(row, "images_json"));
    const images = Array.isArray(imagesValue) ? imagesValue as InboundImage[] : undefined;
    return {
      id: text(row, "id"), accountId: text(row, "account_id"), channelMessageId: text(row, "channel_message_id"),
      peerId: text(row, "peer_id"), senderId: text(row, "sender_id"), text: text(row, "text"),
      receivedAt: date(text(row, "received_at")),
      ...(sequenceValue === null || sequenceValue === undefined ? {} : { sequence: integer(row, "sequence") }),
      ...(contextToken === undefined ? {} : { contextToken }),
      ...(images === undefined ? {} : { images }),
      ...(files === undefined ? {} : { files: redactFiles ? files.map(({ itemIndex, name, declaredBytes }) => ({ itemIndex, name, ...(declaredBytes === undefined ? {} : { declaredBytes }) })) : files }),
      ...(rawValue === undefined ? {} : { raw: rawValue }),
    };
  }

  private toOutbox(row: SqliteRow): OutboxRecord {
    const contextToken = nullableText(row, "context_token");
    return {
      id: text(row, "id"), turnId: text(row, "turn_id"), accountId: text(row, "account_id"),
      peerId: text(row, "peer_id"), chunkIndex: integer(row, "chunk_index"), text: text(row, "text"),
      clientId: text(row, "client_id"), runId: text(row, "run_id"), status: text(row, "status") as OutboxRecord["status"],
      attemptCount: integer(row, "attempt_count"), nextAttemptAt: date(text(row, "next_attempt_at")),
      createdAt: date(text(row, "created_at")), ...(contextToken === undefined ? {} : { contextToken }),
    };
  }

  private transaction<T>(operation: () => T): T {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = operation();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
}

export default SqliteControlPlane;

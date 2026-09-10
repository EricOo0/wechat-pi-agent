import type { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";
import { INITIAL_REACT_LIMIT, TaskControlError, assertTaskTransition, taskTerminal, type Task, type TaskEvent, type TaskInput, type TaskSettlement, type TaskStore, type TaskStatus, type TaskReview } from "../../modules/tasks/index.js";

type Row = Record<string, unknown>;
export class SqliteTaskStore implements TaskStore {
  public constructor(private readonly db: DatabaseSync) {}
  private atomic<T>(fn: () => T): T {
    const name = 'task_' + randomUUID().replaceAll('-', '');
    this.db.exec(`SAVEPOINT ${name}`);
    try { const result = fn(); this.db.exec(`RELEASE ${name}`); return result; }
    catch (error) { this.db.exec(`ROLLBACK TO ${name}; RELEASE ${name}`); throw error; }
  }
  private convert(row: Row): Task {
    return { id: String(row.id), ownerId: String(row.owner_id), conversationId: String(row.conversation_id), goal: String(row.goal),
      revision: Number(row.revision), status: row.status as TaskStatus, progress: String(row.progress), evidence: JSON.parse(String(row.evidence_json)) as string[],
      reactLimit: Number(row.react_limit), reactUsed: Number(row.react_used), reviewCount: Number(row.review_count),
      ...(typeof row.wait_question === "string" ? { waitQuestion: String(row.wait_question) } : {}), ...(typeof row.stop_reason === "string" ? { stopReason: String(row.stop_reason) } : {}),
      createdAt: String(row.created_at), updatedAt: String(row.updated_at) };
  }
  public get(id: string, owner: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id=? AND owner_id=?').get(id, owner);
    return row ? this.convert(row) : undefined;
  }
  public latest(conversationId: string, owner: string): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE conversation_id=? AND owner_id=? ORDER BY CASE WHEN status IN ('COMPLETED','FAILED','CANCELLED') THEN 1 ELSE 0 END, rowid DESC LIMIT 1").get(conversationId, owner);
    return row ? this.convert(row) : undefined;
  }
  public list(owner: string): Task[] { return this.db.prepare('SELECT * FROM tasks WHERE owner_id=? ORDER BY rowid DESC').all(owner).map(row => this.convert(row)); }
  private event(id: string, type: string, data: unknown): void { this.db.prepare('INSERT INTO task_events(task_id,type,data_json,created_at) VALUES(?,?,?,?)').run(id, type, JSON.stringify(data), new Date().toISOString()); }
  public inputs(id: string, owner: string): TaskInput[] {
    if (!this.get(id, owner)) return [];
    return this.db.prepare('SELECT * FROM task_inputs WHERE task_id=? ORDER BY rowid').all(id).map(row => ({ turnId: String(row.turn_id), text: String(row.text), at: String(row.created_at), ...(row.reply_to ? { replyTo: String(row.reply_to) } : {}) }));
  }
  public events(id: string, owner: string): TaskEvent[] {
    if (!this.get(id, owner)) return [];
    return this.db.prepare('SELECT * FROM task_events WHERE task_id=? ORDER BY id DESC').all(id).map(row => ({ type: String(row.type), at: String(row.created_at), data: JSON.parse(String(row.data_json)) as unknown }));
  }
  public runs(id: string, owner: string) {
    if (!this.get(id, owner)) return [];
    return this.db.prepare('SELECT t.id,t.source,t.status,t.task_revision,t.queued_at FROM turns t WHERE t.task_id=? OR EXISTS (SELECT 1 FROM task_control_receipts c WHERE c.task_id=? AND c.message_id=t.inbox_id) ORDER BY t.rowid DESC').all(id, id)
      .map(row => ({ turnId: String(row.id), source: String(row.source), status: String(row.status), revision: Number(row.task_revision), queuedAt: String(row.queued_at) }));
  }
  public evidence(id: string, owner: string): unknown[] {
    if (!this.get(id, owner)) return [];
    return this.db.prepare('SELECT s.turn_id,s.event_type,s.event_data_json FROM steps s JOIN turns t ON t.id=s.turn_id WHERE t.task_id=? ORDER BY s.rowid DESC LIMIT 80').all(id).reverse().map(row => ({ turnId: row.turn_id, type: row.event_type, data: JSON.parse(String(row.event_data_json ?? 'null')) as unknown }));
  }
  /** Called under the Inbox/cursor transaction, before the Turn becomes visible. */
  public attach(conversation: string, owner: string, turnId: string, text: string): void {
    this.atomic(() => {
      const bound = this.db.prepare('SELECT task_id FROM turns WHERE id=?').get(turnId);
      if (bound?.task_id) return;
      let task = this.latest(conversation, owner);
      const replyTo = task?.status === "WAITING" ? task.waitQuestion : undefined;
      const now = new Date().toISOString();
      if (!task || taskTerminal(task.status)) {
        const id = 'tsk_' + randomUUID();
        this.db.prepare("INSERT INTO tasks(id,owner_id,conversation_id,goal,status,react_limit,created_at,updated_at) VALUES(?,?,?,?,'QUEUED',?,?,?)").run(id, owner, conversation, text || '处理用户发送的附件；目标不明确时询问用户', INITIAL_REACT_LIMIT, now, now);
        task = this.get(id, owner)!;
      } else {
        if (task.status === 'CANCELLING') return;
        const next = task.status === 'WAITING' ? 'QUEUED' : task.status;
        this.db.prepare('UPDATE tasks SET revision=revision+1,status=?,wait_question=NULL,updated_at=? WHERE id=?').run(next, now, task.id);
        task = this.get(task.id, owner)!;
      }
      this.db.prepare('UPDATE turns SET task_id=?,task_revision=? WHERE id=?').run(task.id, task.revision, turnId);
      this.db.prepare('INSERT OR IGNORE INTO task_inputs VALUES(?,?,?,?,?)').run(task.id, turnId, text, now, replyTo ?? null);
      this.event(task.id, 'input', { turnId, revision: task.revision });
    });
  }
  public begin(id: string, owner: string, revision: number, turnId?: string): Task | undefined {
    return this.atomic(() => {
      const task = this.get(id, owner);
      if (!task || task.revision !== revision || task.status !== 'QUEUED') return undefined;
      if (task.reactUsed >= task.reactLimit) { this.db.prepare("UPDATE tasks SET status='PAUSED',stop_reason='budget_exhausted',updated_at=? WHERE id=?").run(new Date().toISOString(), id); return undefined; }
      this.db.prepare("UPDATE tasks SET status='RUNNING',updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      this.event(id, 'run_started', { revision, turnId }); return this.get(id, owner);
    });
  }
  public reserveRound(id: string, owner: string, revision: number): void {
    this.atomic(() => {
      const changed = this.db.prepare("UPDATE tasks SET react_used=react_used+1,updated_at=? WHERE id=? AND owner_id=? AND revision=? AND status='RUNNING' AND react_used<react_limit").run(new Date().toISOString(), id, owner, revision);
      if (!changed.changes) {
        const task = this.get(id, owner);
        throw new TaskControlError(task && task.reactUsed >= task.reactLimit ? 'TASK_BUDGET' : 'TASK_STALE', '任务已暂停、更新或达到执行轮数上限');
      }
    });
  }
  public recordReview(id: string, owner: string, requestId: string, result: TaskReview): void {
    this.atomic(() => {
      if (!this.get(id, owner)) throw new Error('Task owner mismatch');
      const changed = this.db.prepare('UPDATE task_reviews SET result_json=? WHERE id=? AND task_id=? AND result_json IS NULL').run(JSON.stringify(result), requestId, id);
      if (changed.changes) this.event(id, 'review_result', { requestId, ...result });
    });
  }
  public beginReview(id: string, owner: string, revision: number, requestId: string): boolean {
    return this.atomic(() => {
      const task = this.get(id, owner);
      if (!task || task.revision !== revision || task.status !== 'RUNNING') return false;
      const result = this.db.prepare('INSERT OR IGNORE INTO task_reviews(id,task_id,revision,created_at) VALUES(?,?,?,?)').run(requestId, id, revision, new Date().toISOString());
      if (!result.changes) return false;
      this.db.prepare("UPDATE tasks SET status='REVIEWING',review_count=review_count+1,updated_at=? WHERE id=?").run(new Date().toISOString(), id);
      this.event(id, 'review_started', { revision, requestId }); return true;
    });
  }
  public settle(update: TaskSettlement): boolean {
    return this.atomic(() => {
      const current = this.get(update.taskId, update.ownerId);
      if (!current || taskTerminal(current.status)) return false;
      if (current.revision !== update.revision && current.status !== 'CANCELLING' && current.status !== 'PAUSING') {
        if (current.status === 'RUNNING' || current.status === 'REVIEWING') this.db.prepare("UPDATE tasks SET status='QUEUED',updated_at=? WHERE id=?").run(new Date().toISOString(), current.id);
        this.event(current.id, 'stale_result', { turnId: update.turnId, revision: update.revision, currentRevision: current.revision }); return false;
      }
      const status = current.status === 'CANCELLING' ? 'CANCELLED' : current.status === 'PAUSING' ? 'PAUSED' : update.status;
      if (!['RUNNING', 'REVIEWING', 'PAUSING', 'CANCELLING'].includes(current.status)) return false;
      assertTaskTransition(current.status, status);
      this.db.prepare('UPDATE tasks SET status=?,progress=?,evidence_json=?,wait_question=?,stop_reason=?,updated_at=? WHERE id=?')
        .run(status, update.progress, JSON.stringify(update.evidence), update.question ?? null, update.reason ?? null, new Date().toISOString(), current.id);
      this.event(current.id, 'settled', { ...update, fromStatus: current.status, status });
      if (status === 'QUEUED') this.enqueue(current.id, update.nextPrompt ?? '继续处理当前任务，结合最新用户输入和已有进展。', 'task_continue');
      return status === update.status;
    });
  }
  /** Internal requests reference a real Inbox; no synthetic channel message is inserted. */
  public enqueue(id: string, prompt: string, source: 'task_continue' | 'permission_continue'): string | undefined {
    const task = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(id);
    if (!task || task.status !== 'QUEUED') return undefined;
    const origin = this.db.prepare("SELECT inbox_id FROM turns WHERE session_id=? AND source='user_message' ORDER BY rowid DESC LIMIT 1").get(String(task.conversation_id));
    if (!origin) throw new Error('Task has no authenticated source input');
    this.db.prepare('UPDATE tasks SET request_seq=request_seq+1 WHERE id=?').run(id);
    const sequence = Number(this.db.prepare('SELECT request_seq FROM tasks WHERE id=?').get(id)?.request_seq);
    const turnId = `${id}_r${Number(task.revision)}_${sequence}`;
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO turns(id,session_id,inbox_id,trace_id,run_id,status,queued_at,created_at,updated_at,task_id,task_revision,source,input_text) VALUES(?,?,?,?,?,'QUEUED',?,?,?,?,?,?,?)")
      .run(turnId, String(task.conversation_id), String(origin.inbox_id), 'evt_' + turnId, 'run_' + turnId, now, now, now, id, Number(task.revision), source, prompt);
    return turnId;
  }
  public wakePermission(id: string, prompt: string): string | undefined {
    const task = this.db.prepare('SELECT status FROM tasks WHERE id=?').get(id);
    if (!task || !['WAITING', 'PAUSED'].includes(String(task.status))) return undefined;
    this.db.prepare("UPDATE tasks SET status='QUEUED',wait_question=NULL WHERE id=?").run(id);
    return this.enqueue(id, prompt, 'permission_continue');
  }
  public controlReceipt(messageId: string): string | undefined {
    const row = this.db.prepare('SELECT r.reply,r.action,t.id,t.status FROM task_control_receipts r LEFT JOIN tasks t ON t.id=r.task_id WHERE r.message_id=?').get(messageId);
    if (!row) return undefined;
    if ((row.action === 'pause' || row.action === 'cancel') && (row.status === 'PAUSED' || row.status === 'CANCELLED')) return `任务 ${String(row.id)}：${row.status === 'PAUSED' ? '已暂停' : '已取消'}。`;
    return String(row.reply);
  }
  public control(conversationId: string, owner: string, messageId: string, action: 'pause' | 'cancel' | 'resume' | 'budget', amount?: number): string {
    return this.atomic(() => {
      const receipt = this.controlReceipt(messageId); if (receipt !== undefined) return receipt;
      const task = this.latest(conversationId, owner);
      let reply = '没有可操作的未关闭任务。';
      if (task && !taskTerminal(task.status)) {
        if (action === 'resume' || action === 'budget') {
          if (action === 'budget') {
            if (!Number.isSafeInteger(amount) || !amount || amount < 1 || !Number.isSafeInteger(task.reactLimit + amount)) throw new Error('请明确指定有效追加轮数');
            this.db.prepare('UPDATE tasks SET react_limit=react_limit+? WHERE id=?').run(amount, task.id);
          }
          if (task.status === 'PAUSED') {
            this.db.prepare("UPDATE tasks SET status='QUEUED',stop_reason=NULL WHERE id=?").run(task.id);
            this.enqueue(task.id, '用户明确要求继续任务；遵守最新目标、权限与剩余预算。', 'task_continue');
          }
          reply = action === 'budget' ? `已为任务 ${task.id} 增加 ${amount} 轮预算。` : `已处理任务 ${task.id} 的继续请求。`;
        } else {
          const active = ['RUNNING', 'REVIEWING', 'PAUSING', 'CANCELLING'].includes(task.status);
          const status = action === 'cancel' ? (active ? 'CANCELLING' : 'CANCELLED') : (active ? 'PAUSING' : 'PAUSED');
          if (task.status !== 'CANCELLING') this.db.prepare('UPDATE tasks SET status=?,stop_reason=?,updated_at=? WHERE id=?').run(status, 'user_' + action, new Date().toISOString(), task.id);
          this.db.prepare("UPDATE turns SET status='CANCELLED',completed_at=? WHERE task_id=? AND status='QUEUED'").run(new Date().toISOString(), task.id);
          reply = `任务 ${task.id}：${status === 'CANCELLED' ? '已取消' : status === 'PAUSED' ? '已暂停' : '正在停止执行'}。`;
        }
        this.event(task.id, 'control', { action, amount, messageId, revision: task.revision, fromStatus: task.status, toStatus: this.get(task.id, owner)?.status, reactLimitBefore: task.reactLimit, reactLimitAfter: this.get(task.id, owner)?.reactLimit });
      }
      this.db.prepare('INSERT INTO task_control_receipts VALUES(?,?,?,?)').run(messageId, reply, task?.id ?? null, action); return reply;
    });
  }
  public turnFailed(turnId: string, reason: string): void {
    const row = this.db.prepare('SELECT task_id,task_revision FROM turns WHERE id=?').get(turnId);
    if (!row?.task_id) return;
    const task = this.db.prepare('SELECT * FROM tasks WHERE id=?').get(String(row.task_id));
    if (!task || taskTerminal(task.status as TaskStatus)) return;
    const status = task.status === 'CANCELLING' ? 'CANCELLED'
      : Number(task.revision) !== Number(row.task_revision) && task.status !== 'PAUSING' ? 'QUEUED' : 'PAUSED';
    this.db.prepare('UPDATE tasks SET status=?,stop_reason=?,updated_at=? WHERE id=?').run(status, reason, new Date().toISOString(), String(task.id));
    this.event(String(task.id), 'turn_failed', { turnId, reason, status });
  }
  public closeConversation(conversation: string): void {
    this.db.prepare("UPDATE tasks SET status='CANCELLED',stop_reason='conversation_closed',updated_at=? WHERE conversation_id=? AND status NOT IN ('COMPLETED','FAILED','CANCELLED')").run(new Date().toISOString(), conversation);
  }
  public preventsIdle(conversation: string): boolean {
    return Boolean(this.db.prepare("SELECT 1 FROM tasks WHERE conversation_id=? AND status NOT IN ('COMPLETED','FAILED','CANCELLED')").get(conversation));
  }
}

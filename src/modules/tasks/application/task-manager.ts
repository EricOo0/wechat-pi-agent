import type { Agent, AgentRunRequest, AgentRunResult } from "../../../runtime/agent/index.js";
import type { ClaimedTurn } from "../../turns/index.js";
import type { InboundMessage } from "../../messaging/index.js";
import { CommandRouter } from "../../messaging/index.js";
import { subjectKey, type PermissionService } from "../../permissions/index.js";
import { parseTaskOutcome } from "../domain/protocol.js";
import { TaskControlError, remainingReact, type Task, type TaskSettlement, type TaskOutcome } from "../domain/task.js";
import type { TaskStore } from "../ports/task-store.js";
import type { TaskReviewer } from "../ports/task-reviewer.js";
import { parseTaskCommand } from "./input-policy.js";

function reasonText(reason: string): string {
  return ({ TASK_BUDGET: '执行轮数已用完', TASK_PROTOCOL: '模型返回的任务结果无法识别', TASK_STALE: '任务输入或状态已变化',
    interrupted: '执行已中断', execution_or_review_failed: '执行或结果核对未成功', budget_exhausted: '执行轮数已用完',
    conversation_closed: '会话已关闭', user_pause: '用户请求暂停', user_cancel: '用户请求取消' } as Record<string, string>)[reason] ?? reason;
}
export interface TaskReplyImages {
  selected(owner: string, taskId: string, revision: number): Promise<readonly { id: string; mimeType: string; width: number; height: number; bytes: number; createdAt: string }[]>;
}
export interface ManagedTaskResult extends AgentRunResult { settlement?: TaskSettlement; publish: boolean }
export class TaskManager {
  private readonly active = new Map<string, { owner: string; revision: number; controller: AbortController }>();
  public constructor(private readonly store: TaskStore, private readonly reviewer: TaskReviewer, private readonly permissions: PermissionService, private readonly images?: TaskReplyImages) {}
  public list(owner: string): Task[] { return this.store.list(owner); }
  public details(id: string, owner: string) { const task = this.store.get(id, owner); return task ? { task, inputs: this.store.inputs(id, owner), events: this.store.events(id, owner), runs: this.store.runs(id, owner) } : undefined; }
  public abortOwner(owner: string): void { for (const active of this.active.values()) if (active.owner === owner) active.controller.abort(new Error('Permissions changed')); }
  public handleMessage(message: InboundMessage, conversation: string): string | undefined {
    const owner = subjectKey(this.permissions.context(message, conversation).subject);
    const attached = Boolean(message.files?.length || message.images?.length);
    const command = attached ? undefined : parseTaskCommand(message.text);
    if (command?.action === 'status' || command?.action === 'list') {
      const tasks = command.action === 'list' ? this.store.list(owner).filter(t => t.conversationId === conversation) : [this.store.latest(conversation, owner)].filter((t): t is Task => Boolean(t));
      return tasks.length ? tasks.map(t => `${t.id}\n${t.status} · ReAct ${t.reactUsed}/${t.reactLimit} · 核对 ${t.reviewCount} 次\n初始目标：${t.goal}\n${t.progress}${t.waitQuestion ? '\n等待：' + t.waitQuestion : ''}${t.stopReason ? '\n原因：' + reasonText(t.stopReason) : ''}`).join('\n\n') : '当前会话还没有任务。';
    }
    let reply: string | undefined;
    if (command) reply = this.store.control(conversation, owner, message.id, command.action, command.action === 'budget' ? command.amount : undefined);
    else if (!attached && /^\/task(?:\s|$)/i.test(message.text.trim())) reply = '任务命令：/task status、list、pause、cancel、resume；追加预算：/task budget 正整数。';
    else if (new CommandRouter().route(message.text).type === 'new') this.store.control(conversation, owner, message.id + ':new', 'cancel');
    const task = this.store.latest(conversation, owner);
    const active = task ? this.active.get(task.id) : undefined;
    if (task && active && (task.revision !== active.revision || ['PAUSING', 'CANCELLING', 'CANCELLED'].includes(task.status))) active.controller.abort(new Error('Task control or input changed'));
    return reply;
  }
  public shouldExecuteUploadedFile(claimed: ClaimedTurn, owner: string): boolean {
    return Boolean(claimed.turn.taskId && this.store.inputs(claimed.turn.taskId, owner).some(input => input.text.trim().length > 0));
  }
  public upload(claimed: ClaimedTurn, owner: string, receipt: string): ManagedTaskResult {
    const id = claimed.turn.taskId!;
    const task = this.store.begin(id, owner, claimed.turn.taskRevision!, claimed.turn.id);
    if (!task) return { text: receipt, publish: true };
    return { text: receipt, publish: true, settlement: this.settlement(task, 'WAITING', task.progress, task.evidence, { question: '请说明希望如何处理附件；保存失败的文件请重新发送。', reason: 'user_input_required' }) };
  }
  public async execute(claimed: ClaimedTurn, request: AgentRunRequest, engine: Agent): Promise<ManagedTaskResult> {
    if (!request.permissionContext || !claimed.turn.taskId || !claimed.turn.taskRevision) throw new Error('Task requires authenticated execution context');
    const owner = subjectKey(request.permissionContext.subject);
    const task = this.store.begin(claimed.turn.taskId, owner, claimed.turn.taskRevision, claimed.turn.id);
    if (!task) {
      const current = this.store.get(claimed.turn.taskId, owner);
      return { text: current?.status === 'PAUSED' ? `任务已暂停，输入已保存。ReAct ${current.reactUsed}/${current.reactLimit}；可用 /task resume 或 /task budget 轮数。` : '', publish: current?.status === 'PAUSED' && claimed.turn.source === 'user_message' };
    }
    const controller = new AbortController();
    const signal = request.signal ? AbortSignal.any([request.signal, controller.signal]) : controller.signal;
    this.active.set(task.id, { owner, revision: task.revision, controller });
    let execution: AgentRunResult | undefined;
    try {
      const inputs = this.store.inputs(task.id, owner);
      request.onEvent?.({ type: "task_run_context", at: new Date(), data: { taskId: task.id, revision: task.revision, task, inputs } });
      execution = await engine.runTurn({ ...request, signal, task: { task, inputs }, beforeModelCall: () => this.store.reserveRound(task.id, owner, task.revision) });
      execution = { ...execution, replyImages: [] };
      signal.throwIfAborted();
      const attachments = await this.images?.selected(owner, task.id, task.revision) ?? [];
      const outcome = parseTaskOutcome(execution.text, attachments.length > 0);
      request.onEvent?.({ type: "task_outcome", at: new Date(), data: { taskId: task.id, revision: task.revision, outcome } });
      const current = this.store.get(task.id, owner)!;
      if (current.revision !== task.revision || current.status !== 'RUNNING') throw new TaskControlError('TASK_STALE', 'Task changed');
      if (outcome.disposition === 'waiting') return { ...execution, text: outcome.question!, publish: true, settlement: this.fromOutcome(task, outcome, 'WAITING', { question: outcome.question!, reason: 'user_or_permission_required' }) };
      if (outcome.disposition === 'continue') return this.continueOrPause(current, outcome, execution, outcome.remaining);
      const requestId = `${task.id}:${task.revision}:${claimed.turn.id}`;
      if (!this.store.beginReview(task.id, owner, task.revision, requestId)) throw new TaskControlError('TASK_STALE', 'Completion application already handled');
      const checked = await this.reviewer.review({ id: requestId, task: current, inputs, outcome, evidence: this.store.evidence(task.id, owner), attachments, signal, emit: event => request.onEvent?.(event) });
      this.store.recordReview(task.id, owner, requestId, checked);
      signal.throwIfAborted();
      if (checked.decision === 'approved') return { ...execution, replyImages: attachments.map(image => image.id), text: checked.finalResult?.trim() || outcome.result || "", publish: true, settlement: this.fromOutcome(task, outcome, 'COMPLETED', { reason: checked.reason }) };
      if (checked.decision === 'waiting') return { ...execution, text: checked.question!, publish: true, settlement: this.fromOutcome(task, outcome, 'WAITING', { question: checked.question!, reason: checked.reason }) };
      return this.continueOrPause(this.store.get(task.id, owner)!, outcome, execution, `${checked.reason}\n${checked.gaps.join('\n')}\n${checked.nextAction ?? ''}`);
    } catch (error) {
      const current = this.store.get(task.id, owner);
      const status = current?.status === 'CANCELLING' || current?.status === 'CANCELLED' ? 'CANCELLED' : 'PAUSED';
      const reason = error instanceof TaskControlError ? error.code : signal.aborted ? 'interrupted' : 'execution_or_review_failed';
      const stale = current?.revision !== task.revision;
      return { ...(execution ?? {}), text: stale ? '' : status === 'CANCELLED' ? '任务已取消。' : `任务已暂停：${reasonText(reason)}。已有进展已保留，可查询 /task status。`, publish: !stale,
        settlement: this.settlement(task, status, current?.progress ?? task.progress, current?.evidence ?? task.evidence, { reason }) };
    } finally { this.active.delete(task.id); }
  }
  private continueOrPause(task: Task, outcome: TaskOutcome, result: AgentRunResult, next: string): ManagedTaskResult {
    const available = remainingReact(task) > 0;
    return { ...result, text: available ? outcome.progress : `任务已暂停：已用完 ${task.reactLimit} 轮 ReAct。\n${outcome.progress}\n待完成：${next}\n追加预算：/task budget 轮数`, publish: !available,
      settlement: this.fromOutcome(task, outcome, available ? 'QUEUED' : 'PAUSED', { reason: available ? 'continue' : 'budget_exhausted', ...(available ? { nextPrompt: '继续当前任务，解决以下缺口：\n' + next } : {}) }) };
  }
  private fromOutcome(task: Task, outcome: TaskOutcome, status: TaskSettlement['status'], extra: Partial<TaskSettlement>): TaskSettlement {
    return this.settlement(task, status, outcome.progress, outcome.evidence, extra);
  }
  private settlement(task: Task, status: TaskSettlement['status'], progress: string, evidence: string[], extra: Partial<TaskSettlement> = {}): TaskSettlement {
    return { taskId: task.id, ownerId: task.ownerId, revision: task.revision, status, progress, evidence, ...extra };
  }
}

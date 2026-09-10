import { buildTraceSpans, type TraceEvent, type TraceSpan, type TraceQuery } from '../../observability/index.js';
import type { TaskManager } from './task-manager.js';

export interface TaskTraceNode {
  id: string; kind: string; at: string; title: string; status?: string;
  turnId?: string; revision?: number; superseded?: boolean; data: unknown;
  spans?: TraceSpan[];
  lifecycle?: unknown[];
}
interface TurnDetails { turn?: { startedAt?: string | Date; completedAt?: string | Date; finalResponse?: string }; steps?: TraceEvent[]; outbox?: Array<{ id: string; status: string; createdAt: string | Date }> }
function usage(spans: TraceSpan[], expected: number) {
  let tokens = 0; let known = 0; let durationMs = 0; let timed = 0;
  for (const span of spans) {
    const value = span.usage as { totalTokens?: number } | undefined;
    if (typeof value?.totalTokens === 'number' && Number.isFinite(value.totalTokens)) { tokens += value.totalTokens; known++; }
    if (span.start !== null && span.end !== null) { durationMs += Math.max(0, span.end - span.start); timed++; }
  }
  return { calls: spans.length, expectedCalls: expected, tokens, durationMs, complete: known === expected && spans.length === expected, durationComplete: timed === expected && spans.length === expected };
}
/** Read-only projection; task ownership is checked before any underlying Turn lookup. */
export function taskTrace(tasks: TaskManager, query: TraceQuery, id: string, owner: string) {
  const details = tasks.details(id, owner);
  if (!details) return undefined;
  const nodes: TaskTraceNode[] = [];
  const execution: TraceSpan[] = []; const reviews: TraceSpan[] = [];
  const deliveries: unknown[] = [];
  const revisions = new Map(details.runs.map(run => [run.turnId, run.revision]));
  for (const input of details.inputs) nodes.push({ id: 'input:' + input.turnId, kind: 'input', at: input.at, title: input.text || '附件输入', revision: revisions.get(input.turnId) ?? 1, turnId: input.turnId, data: input });
  for (const run of [...details.runs].reverse()) {
    const raw = query.getTurnDetails(run.turnId) as TurnDetails | undefined;
    const steps = raw?.steps ?? [];
    const spans = buildTraceSpans(steps, run.status);
    const reviewSpans = spans.filter(span => span.events.some(event => event.eventData?.taskPhase === 'review'));
    const runSpans = spans.filter(span => !reviewSpans.includes(span));
    execution.push(...runSpans.filter(span => span.kind === 'model')); reviews.push(...reviewSpans);
    const context = steps.find(step => step.event_type === 'task_run_context')?.eventData;
    const outcome = steps.find(step => step.event_type === 'task_outcome')?.eventData;
    const isRun = Boolean(context || steps.some(step => step.event_type === 'agent_start') || runSpans.some(span => span.kind === 'model'));
    nodes.push({ id: 'turn:' + run.turnId, kind: isRun ? 'run' : 'request', at: new Date(raw?.turn?.startedAt ?? run.queuedAt).toISOString(), title: isRun ? 'Agent Run' : '排队 / 应用处理', status: run.status, turnId: run.turnId, revision: run.revision,
      superseded: run.revision !== details.task.revision,
      data: { source: run.source, context: context ?? null, outcome: outcome ?? null, result: raw?.turn?.finalResponse, publication: raw?.outbox?.length ? '已生成投递记录' : '未向用户发送', traceAvailable: Boolean(steps.length) }, spans: runSpans });
    for (const span of reviewSpans) nodes.push({ id: span.id, kind: 'review', at: span.start === null ? run.queuedAt : new Date(span.start).toISOString(), title: '独立 Review', status: span.status, turnId: run.turnId, revision: run.revision, superseded: run.revision !== details.task.revision, data: span, spans: [span] });
    for (const message of raw?.outbox ?? []) {
      deliveries.push(message);
      nodes.push({ id: 'delivery:' + message.id, kind: 'delivery', at: new Date(message.createdAt).toISOString(), title: '回复投递', status: message.status, turnId: run.turnId, data: message });
    }
  }
  for (const [index, event] of [...details.events].reverse().entries()) {
    if (event.type === 'input') continue;
    const data = event.data as Record<string, unknown>;
    const related = typeof data.requestId === 'string' ? details.runs.find(run => data.requestId === `${id}:${run.revision}:${run.turnId}`) : undefined;
    if (event.type === 'run_started') {
      const candidates = nodes.filter(node => (node.kind === 'run' || node.kind === 'request') && (typeof data.turnId === 'string' ? node.turnId === data.turnId : node.revision === data.revision));
      if (candidates.length === 1) { (candidates[0]!.lifecycle ??= []).push(event); continue; }
    }
    if ((event.type === 'review_started' || event.type === 'review_result') && related) {
      let node = nodes.find(node => node.kind === 'review' && node.turnId === related.turnId);
      if (!node) {
        node = { id: 'review:' + String(data.requestId), kind: 'review', at: event.at, title: '独立 Review', turnId: related.turnId, revision: related.revision, data: { completionRequestId: data.requestId }, spans: [] };
        nodes.push(node);
      }
      (node.lifecycle ??= []).push(event);
      continue;
    }
    nodes.push({ id: 'event:' + index, kind: event.type, at: event.at, title: event.type, ...(typeof data.revision === 'number' ? { revision: data.revision } : {}), ...(typeof data.turnId === 'string' ? { turnId: data.turnId } : related ? { turnId: related.turnId, revision: related.revision } : {}), data });
  }
  nodes.sort((a, b) => a.at.localeCompare(b.at));
  const executionUsage = usage(execution, details.task.reactUsed); const reviewUsage = usage(reviews, details.task.reviewCount);
  return { ...details, nodes, deliveries, usage: { execution: executionUsage, review: reviewUsage, totalTokens: executionUsage.tokens + reviewUsage.tokens, complete: executionUsage.complete && reviewUsage.complete } };
}

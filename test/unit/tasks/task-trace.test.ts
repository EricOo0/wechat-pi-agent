import { expect, it, vi } from 'vitest';
import { taskTrace, type TaskManager } from '../../../src/modules/tasks/index.js';
import type { TraceQuery } from '../../../src/modules/observability/index.js';

it('separates execution and Review usage and retains review correlation and historical gaps', () => {
  const at = new Date().toISOString();
  const manager = { details: () => ({ task: { id: 't', revision: 2, reactUsed: 1, reviewCount: 1 }, inputs: [], events: [{ type: 'review_result', at, data: { requestId: 't:1:r', decision: 'approved' } }], runs: [{ turnId: 'r', revision: 1, status: 'SUCCEEDED', queuedAt: at, source: 'user_message' }] }) } as unknown as TaskManager;
  const event = (id: string, phase: string, tokens: number) => [
    { event_type: 'model_start', event_at: at, eventData: { modelCallId: id, taskPhase: phase, model: 'fixture' } },
    { event_type: 'model_end', event_at: at, eventData: { modelCallId: id, taskPhase: phase, status: 'succeeded', usage: { totalTokens: tokens } } },
  ];
  const query = { getTurnDetails: () => ({ steps: [...event('exec', 'execution', 10), ...event('review', 'review', 20)].map((step, ordinal) => ({ ...step, ordinal })), outbox: [] }) } as unknown as TraceQuery;
  const result = taskTrace(manager, query, 't', 'owner')!;
  expect(result.usage).toMatchObject({ execution: { tokens: 10, complete: true }, review: { tokens: 20, complete: true }, totalTokens: 30, complete: true });
  expect(result.nodes.find(node => node.kind === 'review')).toMatchObject({ turnId: 'r', revision: 1, superseded: true });
  expect(result.nodes.filter(node => node.kind === 'review')).toHaveLength(1);
  expect(result.nodes.find(node => node.kind === 'review')?.lifecycle).toHaveLength(1);
  expect(result.nodes.some(node => node.kind === 'review_result')).toBe(false);
  const missing = { getTurnDetails: vi.fn(() => ({ steps: [] })) } as unknown as TraceQuery;
  const historical = taskTrace(manager, missing, 't', 'owner')!;
  expect(historical.usage.complete).toBe(false);
  expect(historical.nodes.find(node => node.kind === 'request')?.data).toMatchObject({ traceAvailable: false, context: null });
});

import { SqliteMemoryJobRepository } from "../../src/adapters/sqlite/sqlite-memory-job-repository.js";
import { SaveInboundFiles } from "../../src/modules/artifacts/index.js";
import { SqliteUserFileRepository } from "../../src/adapters/sqlite/sqlite-user-file-repository.js";
import { LocalFileStorage } from "../../src/adapters/filesystem/local-file-storage.js";
import { TaskRoutes } from "../../src/entrypoints/admin-http/task-routes.js";
import { AdminServer } from "../../src/entrypoints/admin-http/server.js";
import { RuntimeHealth } from "../../src/modules/observability/index.js";
import { PrometheusTelemetry } from "../../src/adapters/telemetry/metrics.js";
import pino from "pino";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";
import { SqlitePermissionRepository } from "../../src/adapters/sqlite/sqlite-permission-repository.js";
import { TaskManager, taskTrace, type TaskStore, type TaskReviewRequest, type TaskReview, type TaskOutcome } from "../../src/modules/tasks/index.js";
import { PermissionService, principalId, subjectKey } from "../../src/modules/permissions/index.js";
import { IngestMessage, ExactSenderPolicy, ReplyChunker, type InboundMessage } from "../../src/modules/messaging/index.js";
import { RunNextTurn } from "../../src/modules/turns/index.js";
import { EndSession } from "../../src/modules/conversation/index.js";
import { DryRunChannel } from "../../src/adapters/dry-run/dry-run-channel.js";
import type { AgentRunRequest } from "../../src/runtime/agent/index.js";

describe('Task execution integration', () => {
  let dir: string, control: SqliteControlPlane, permissionRepo: SqlitePermissionRepository, permissions: PermissionService;
  let store: TaskStore, manager: TaskManager, ingest: IngestMessage, runner: RunNextTurn, owner: string, sequence: number;
  const review = vi.fn<(request: TaskReviewRequest) => Promise<TaskReview>>();
  const run = vi.fn<(request: AgentRunRequest) => Promise<{ text: string }>>();
  const outcome = (disposition: TaskOutcome['disposition'], extra: Partial<TaskOutcome> = {}) => JSON.stringify({ disposition, progress: 'one step done', remaining: 'more work', evidence: ['fixture'], ...(disposition === 'waiting' ? { question: 'Which option?' } : {}), ...(disposition === 'request_completion' ? { result: 'final answer' } : {}), ...extra });
  const message = (text: string): InboundMessage => ({ id: 'msg' + ++sequence, channelMessageId: 'message' + sequence, accountId: 'bot', peerId: 'owner', senderId: 'owner', text, receivedAt: new Date() });
  const send = (text: string) => { const msg = message(text); ingest.execute({ accountId: 'bot', previousCursor: control.getCursor('bot'), nextCursor: String(sequence), messages: [msg] }); return msg; };
  const task = () => store.list(owner)[0]!;
  const execute = async () => { const result = await runner.execute(); if (result.status !== 'completed') throw new Error(`Expected completed, received ${result.status}`); return result; };
  beforeEach(() => {
    dir = realpathSync(mkdtempSync(join(tmpdir(), 'tasks-'))); sequence = 0;
    control = new SqliteControlPlane(join(dir, 'app.db')); control.migrate();
    permissionRepo = new SqlitePermissionRepository(join(dir, 'permissions.db'));
    permissions = new PermissionService(permissionRepo, { executorId: 'test', workspaceId: dir, ownerPrincipalId: principalId('bot', 'owner'), protectedPaths: [] });
    owner = subjectKey(permissions.context(message('identity'), 'unused').subject);
    store = control.enableTasks((msg, session) => subjectKey(permissions.context(msg, session).subject));
    review.mockReset(); review.mockResolvedValue({ decision: 'approved', reason: 'evidence sufficient', gaps: [], finalResult: 'reviewed final answer' });
    run.mockReset(); run.mockImplementation(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('request_completion') }); });
    manager = new TaskManager(store, { review }, permissions);
    ingest = new IngestMessage(control, new ExactSenderPolicy('owner'), undefined, permissions, manager);
    runner = new RunNextTurn(control, { runTurn: run, recordContext: () => Promise.resolve(), checkReady: () => Promise.resolve({ ready: true }) }, new DryRunChannel(), new ReplyChunker(), { ownerId: 'worker' }, undefined, undefined, permissions, undefined, new EndSession(control, permissions), undefined, manager);
  });
  afterEach(() => { control.close(); permissionRepo.close(); rmSync(dir, { recursive: true, force: true }); });

  it('aggregates task intent, execution outcomes, review, control and delivery without inventing usage', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('waiting') }); });
    send('original goal'); await execute();
    send('/task pause'); await execute();
    send('/task budget 2'); await execute(); await execute();
    const trace = taskTrace(manager, control, task().id, owner)!;
    expect(trace.task.status).toBe('COMPLETED');
    expect(trace.nodes.filter(node => node.kind === 'run')).toHaveLength(2);
    expect(trace.nodes.some(node => node.kind === 'control')).toBe(true);
    expect(trace.nodes.some(node => node.kind === 'review' && node.lifecycle?.length)).toBe(true);
    expect(trace.nodes.some(node => node.kind === 'delivery' && node.status === 'PENDING')).toBe(true);
    expect(trace.usage.execution.complete).toBe(false);
    expect(trace.nodes.find(node => node.kind === 'run')?.data).toMatchObject({ outcome: { outcome: { disposition: 'waiting' } } });
    const outbox = control.claimNextOutbox('delivery', 1000)!;
    control.markOutboxSent(outbox.message.id);
    expect(taskTrace(manager, control, task().id, owner)?.nodes.some(node => node.kind === 'delivery' && node.status === 'SENT')).toBe(true);
    const lookup = vi.spyOn(control, 'getTurnDetails'); lookup.mockClear();
    expect(taskTrace(manager, control, task().id, 'another-owner')).toBeUndefined();
    expect(lookup).not.toHaveBeenCalled();
  });

  it('ordinary chat creates a Task and requires Review before completion', async () => {
    send('hello'); const done = await execute();
    expect(done).toMatchObject({ finalResponse: 'reviewed final answer' });
    expect(task()).toMatchObject({ status: 'COMPLETED', reactUsed: 1, reviewCount: 1 });
    expect(review).toHaveBeenCalledTimes(1);
    expect(store.events(task().id, owner).some(event => event.type === "review_result")).toBe(true);
    send('another question'); await execute(); expect(store.list(owner)).toHaveLength(2);
  });

  it('file-only input becomes a waiting Task without execution or Review calls', async () => {
    const files = new SqliteUserFileRepository(join(dir, 'app.db'));
    try {
      const save = new SaveInboundFiles(files, new LocalFileStorage(join(dir, 'files')), { download: () => Promise.resolve(Buffer.from('%PDF-1.4 fixture')) });
      const record = vi.fn<() => Promise<void>>().mockResolvedValue();
      runner = new RunNextTurn(control, { runTurn: run, recordContext: record, checkReady: () => Promise.resolve({ ready: true }) }, new DryRunChannel(), new ReplyChunker(), { ownerId: 'worker' }, undefined, undefined, permissions, save, new EndSession(control, permissions), undefined, manager);
      const msg = { ...message(''), files: [{ itemIndex: 0, name: 'fixture.pdf' }] };
      ingest.execute({ accountId: 'bot', previousCursor: control.getCursor('bot'), nextCursor: String(sequence), messages: [msg] });
      const result = await execute();
      expect(result.finalResponse).toContain('已保存');
      expect(task()).toMatchObject({ status: 'WAITING', reactUsed: 0, reviewCount: 0 });
      expect(run).not.toHaveBeenCalled(); expect(review).not.toHaveBeenCalled(); expect(record).toHaveBeenCalledOnce();
      const id = task().id; send('analyze that PDF'); await execute();
      expect(task()).toMatchObject({ id, status: 'COMPLETED', reactUsed: 1 });
      expect(files.list(owner)).toHaveLength(1);
    } finally { files.close(); }
  });

  it('a file answer resumes an existing Task without asking for its goal again', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('waiting', { question: 'Please send the PDF' }) }); });
    send('analyze the PDF'); await execute(); const id = task().id;
    const files = new SqliteUserFileRepository(join(dir, 'app.db'));
    try {
      const save = new SaveInboundFiles(files, new LocalFileStorage(join(dir, 'files')), { download: () => Promise.resolve(Buffer.from('%PDF-1.4 fixture')) });
      runner = new RunNextTurn(control, { runTurn: run, recordContext: () => Promise.resolve(), checkReady: () => Promise.resolve({ ready: true }) }, new DryRunChannel(), new ReplyChunker(), { ownerId: 'worker' }, undefined, undefined, permissions, save, new EndSession(control, permissions), undefined, manager);
      const msg = { ...message(''), files: [{ itemIndex: 0, name: 'answer.pdf' }] };
      ingest.execute({ accountId: 'bot', previousCursor: control.getCursor('bot'), nextCursor: String(sequence), messages: [msg] });
      await execute();
      expect(task()).toMatchObject({ id, status: 'COMPLETED', reactUsed: 2, reviewCount: 1 });
      expect(store.inputs(id, owner).at(-1)?.replyTo).toBe('Please send the PDF');
    } finally { files.close(); }
  });

  it('continues internally without fake Inbox messages and only reviews completion applications', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('continue') }); });
    send('work'); await execute();
    expect(task()).toMatchObject({ status: 'QUEUED', reactUsed: 1, reviewCount: 0 });
    const next = await execute(); expect(next).toHaveProperty('turnId');
    expect(task()).toMatchObject({ status: 'COMPLETED', reactUsed: 2, reviewCount: 1 });
    const db = new DatabaseSync(join(dir, 'app.db')); try { expect(db.prepare('SELECT count(*) AS n FROM inbox').get()?.n).toBe(1); expect(db.prepare("SELECT count(*) AS n FROM turns WHERE source='task_continue'").get()?.n).toBe(1); } finally { db.close(); }
  });

  it('allows final Review at round 30 and pauses a rejection without round 31', async () => {
    run.mockImplementationOnce(request => { for (let i = 0; i < 30; i++) request.beforeModelCall?.(); return Promise.resolve({ text: outcome('request_completion') }); });
    review.mockResolvedValueOnce({ decision: 'revise', reason: 'missing section', gaps: ['section 3'] });
    send('three PDFs'); await execute();
    expect(task()).toMatchObject({ status: 'PAUSED', reactUsed: 30, reviewCount: 1, stopReason: 'budget_exhausted' });
    expect(await runner.execute()).toEqual({ status: 'idle' });
    send('/task budget 2'); await execute(); await execute();
    expect(task()).toMatchObject({ status: 'COMPLETED', reactLimit: 32, reactUsed: 31, reviewCount: 2 });
    expect(store.list(owner)).toHaveLength(1);
  });

  it('blocks the 31st execution attempt before the model is invoked', async () => {
    let calls = 0;
    run.mockImplementationOnce(request => { for (let i = 0; i < 31; i++) { request.beforeModelCall?.(); calls++; } return Promise.resolve({ text: outcome('request_completion') }); });
    send('long task'); await execute();
    expect(calls).toBe(30); expect(task()).toMatchObject({ status: 'PAUSED', reactUsed: 30, reviewCount: 0 }); expect(review).not.toHaveBeenCalled();
  });

  it('waits for user input without busy loops or resetting the budget', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('waiting') }); });
    send('choose'); await execute(); const id = task().id;
    expect(task()).toMatchObject({ status: 'WAITING', reactUsed: 1 }); expect(review).not.toHaveBeenCalled();
    expect(await runner.execute()).toEqual({ status: 'idle' });
    send('option B'); await execute(); expect(task()).toMatchObject({ id, status: 'COMPLETED', revision: 2, reactUsed: 2 });
    expect(store.inputs(id, owner).at(-1)?.replyTo).toBe('Which option?');
  });

  it('a new input cancels stale Review and prevents completion of the new intent', async () => {
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    review.mockImplementationOnce(async request => { entered(); await new Promise<void>(resolve => request.signal.addEventListener('abort', () => resolve(), { once: true })); return { decision: 'approved', reason: 'old', gaps: [], finalResult: 'OLD RESULT' }; });
    send('old intent'); const first = runner.execute(); await ready; send('change the intent');
    const old = await first; expect(old).toMatchObject({ chunks: [] });
    expect(task()).toMatchObject({ status: 'QUEUED', revision: 2 });
    await execute(); expect(task()).toMatchObject({ status: 'COMPLETED', reactUsed: 2 });
  });

  it('pause is immediate and keeps incoming text for explicit resume', async () => {
    let entered!: () => void; const ready = new Promise<void>(resolve => { entered = resolve; });
    run.mockImplementationOnce(async request => { request.beforeModelCall?.(); entered(); await new Promise<void>(resolve => request.signal?.addEventListener('abort', () => resolve(), { once: true })); throw new Error('cancelled'); });
    send('work'); const running = runner.execute(); await ready; send('/task pause');
    expect(task().status).toBe('PAUSING'); await running; expect(task().status).toBe('PAUSED');
    expect((await execute()).finalResponse).toContain('已暂停');
    send('additional detail'); await execute(); expect(task().status).toBe('PAUSED');
    send('/task resume'); await execute(); await execute();
    expect(task()).toMatchObject({ status: 'COMPLETED', reactUsed: 2 });
    expect(store.inputs(task().id, owner).map(i => i.text)).toContain('additional detail');
  });

  it('permission approval creates one internal continuation for the same Task', async () => {
    let permissionId = '';
    run.mockImplementationOnce(request => {
      request.beforeModelCall?.(); const question = permissions.request(request.permissionContext!, { kind: 'shell' });
      permissionId = question.match(/确认授权 ([a-f0-9-]+)/u)![1]!;
      return Promise.resolve({ text: outcome('waiting', { question }) });
    });
    send('needs shell'); await execute(); const id = task().id;
    send('确认授权 ' + permissionId); await execute(); await execute();
    expect(task()).toMatchObject({ id, status: 'COMPLETED', reactUsed: 2 });
    const db = new DatabaseSync(join(dir, 'app.db')); try { expect(db.prepare('SELECT count(*) AS n FROM inbox').get()?.n).toBe(2); expect(db.prepare('SELECT count(*) AS n FROM permission_continuations').get()?.n).toBe(1); } finally { db.close(); }
  });

  it('new conversation closes unfinished tasks and waiting tasks prevent idle archive', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('waiting') }); });
    send('wait'); await execute(); const previous = task();
    expect(control.endSession({ sessionId: previous.conversationId, ownerId: owner, reason: 'idle_timeout', now: new Date(Date.now() + 7_200_000), idleMs: 1 })).toBe(false);
    send('/new'); await execute(); expect(store.get(previous.id, owner)?.status).toBe('CANCELLED');
    send('new task'); await execute(); expect(task().conversationId).not.toBe(previous.conversationId);
  });

  it('duplicate control delivery does not add budget twice', async () => {
    run.mockImplementationOnce(request => { for (let i = 0; i < 30; i++) request.beforeModelCall?.(); return Promise.resolve({ text: outcome('continue') }); });
    send('work'); await execute();
    const msg = send('/task budget 3');
    manager.handleMessage(msg, task().conversationId);
    manager.handleMessage(msg, task().conversationId);
    expect(task().reactLimit).toBe(33);
    const db = new DatabaseSync(join(dir, 'app.db'));
    try { expect(db.prepare("SELECT count(*) AS n FROM turns WHERE source='task_continue' AND status='QUEUED'").get()?.n).toBe(1); } finally { db.close(); }
  });

  it('new and following input in one batch are separated into different conversations', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('waiting') }); });
    send('old task'); await execute(); const old = task();
    const reset = message('/new'), next = message('new goal');
    ingest.execute({ accountId: 'bot', previousCursor: control.getCursor('bot'), nextCursor: String(sequence), messages: [reset, next] });
    await execute(); await execute();
    expect(store.get(old.id, owner)?.status).toBe('CANCELLED');
    expect(task()).toMatchObject({ goal: 'new goal', status: 'COMPLETED' });
    expect(task().conversationId).not.toBe(old.conversationId);
  });

  it('startup recovery keeps task history but cancels unfinished work', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('waiting') }); });
    send('waiting task'); await execute(); const old = task();
    control.close(); control = new SqliteControlPlane(join(dir, 'app.db')); control.migrate();
    store = control.enableTasks((msg, session) => subjectKey(permissions.context(msg, session).subject));
    new EndSession(control, permissions).all('recovery');
    expect(store.get(old.id, owner)).toMatchObject({ status: 'CANCELLED', stopReason: 'conversation_closed', reactUsed: 1 });
    expect(store.inputs(old.id, owner)).toHaveLength(1);
    expect(control.claimNextTurn('restarted-worker', 30_000)).toBeUndefined();
  });

  it('malformed output pauses without Review and data is isolated by owner', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: 'I am done' }); });
    send('work'); await execute(); expect(task()).toMatchObject({ status: 'PAUSED', stopReason: 'TASK_PROTOCOL' });
    expect(review).not.toHaveBeenCalled(); expect(store.get(task().id, 'other')).toBeUndefined(); expect(store.inputs(task().id, 'other')).toEqual([]);
  });

  it('serves task progress and escaped HTML through the local Admin', async () => {
    send('<script>alert(1)</script>'); await execute();
    const admin = new AdminServer({ host: '127.0.0.1', port: 0, control, channel: new DryRunChannel(),
      agent: { runTurn: run, recordContext: () => Promise.resolve(), checkReady: () => Promise.resolve({ ready: true }) },
      health: new RuntimeHealth(), telemetry: new PrometheusTelemetry(), logger: pino({ level: 'silent' }), taskRoutes: new TaskRoutes(manager, owner, control) });
    await admin.start();
    try {
      const response = await fetch(`http://127.0.0.1:${admin.getPort()}/admin/tasks`);
      const html = await response.text(); expect(response.status).toBe(200);
      expect(html).toContain('&lt;script&gt;'); expect(html).not.toContain('<script>alert');
      const details = await fetch(`http://127.0.0.1:${admin.getPort()}/debug/tasks/${task().id}`);
      expect(await details.json()).toMatchObject({ task: { status: 'COMPLETED', reactUsed: 1 } });
      const trace = await fetch(`http://127.0.0.1:${admin.getPort()}/debug/tasks/${task().id}/trace`);
      expect(await trace.json()).toMatchObject({ task: { status: 'COMPLETED' }, usage: { complete: false } });
      expect((await fetch(`http://127.0.0.1:${admin.getPort()}/admin/traces`)).status).toBe(200);
    } finally { await admin.close(); }
  });

  it('memory distinguishes internal continuation from a repeated user message', async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: outcome('continue') }); });
    send('real user goal'); await execute(); await execute();
    new EndSession(control, permissions).all('shutdown');
    const jobs = new SqliteMemoryJobRepository(join(dir, 'app.db'));
    try {
      const job = jobs.claim('memory-worker')!;
      const source = jobs.source(job);
      expect(source.turns.filter(turn => turn.user === 'real user goal')).toHaveLength(1);
      expect(source.turns.find(turn => turn.inputSource === 'task_continue')).toMatchObject({ user: '', assistant: 'reviewed final answer' });
    } finally { jobs.close(); }
  });

  it('rolls back Task settlement and scheduling if Outbox insertion fails', async () => {
    send('work');
    const db = new DatabaseSync(join(dir, 'app.db'));
    try {
      db.exec("CREATE TRIGGER reject_outbox BEFORE INSERT ON outbox BEGIN SELECT RAISE(ABORT,'injected failure'); END;");
      const result = await runner.execute(); expect(result.status).toBe('failed');
      expect(task().status).toBe('PAUSED'); expect(db.prepare('SELECT count(*) AS n FROM outbox').get()?.n).toBe(0);
    } finally { db.close(); }
  });
});

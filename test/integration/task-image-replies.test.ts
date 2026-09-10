import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";
import { SqlitePermissionRepository } from "../../src/adapters/sqlite/sqlite-permission-repository.js";
import { PermissionService, principalId, subjectKey } from "../../src/modules/permissions/index.js";
import { IngestMessage, ExactSenderPolicy, ReplyChunker, type InboundMessage } from "../../src/modules/messaging/index.js";
import { TaskManager, type TaskStore, type TaskReviewRequest, type TaskReview } from "../../src/modules/tasks/index.js";
import { RunNextTurn } from "../../src/modules/turns/index.js";
import { DryRunChannel } from "../../src/adapters/dry-run/dry-run-channel.js";
import type { AgentRunRequest, AgentRunResult } from "../../src/runtime/agent/index.js";

describe("Task image publication", () => {
  let root: string, control: SqliteControlPlane, db: DatabaseSync, permissionsDb: SqlitePermissionRepository;
  let permissions: PermissionService, store: TaskStore, manager: TaskManager, ingest: IngestMessage, runner: RunNextTurn, owner: string;
  let serial = 0;
  const review = vi.fn<(r: TaskReviewRequest) => Promise<TaskReview>>();
  const run = vi.fn<(r: AgentRunRequest) => Promise<AgentRunResult>>();
  function message(text: string): InboundMessage { return { id: `input-${++serial}`, accountId: "bot", channelMessageId: `remote-${serial}`, peerId: "owner", senderId: "owner", text, receivedAt: new Date() }; }
  function send(text: string) { const m = message(text); ingest.execute({ accountId: "bot", previousCursor: control.getCursor("bot"), nextCursor: `${serial}`, messages: [m] }); }
  function result(disposition = "request_completion") { return JSON.stringify({ disposition, progress: "image prepared", remaining: "", evidence: [], result: "图片已准备好，将随回复发送。", question: "需要确认" }); }
  function select(request: AgentRunRequest) {
    const task = request.task!.task;
    const id = `image-${serial}`;
    db.prepare("INSERT INTO image_artifacts(id,owner_id,task_id,revision,source_turn_id,tool_call_id,bytes,sha256,mime_type,width,height,created_at) VALUES(?,?,?,?,?,?,3,'hash','image/png',1,1,?)").run(id, owner, task.id, task.revision, request.permissionContext!.taskTurnId!, `call-${serial}`, new Date().toISOString());
    control.selectReplyImage(owner, task.id, task.revision, id);
  }
  beforeEach(() => {
    root = realpathSync(mkdtempSync(join(tmpdir(), "task-images-"))); serial = 0;
    control = new SqliteControlPlane(join(root, "app.db")); control.migrate(); db = new DatabaseSync(join(root, "app.db"));
    permissionsDb = new SqlitePermissionRepository(join(root, "permissions.db"));
    permissions = new PermissionService(permissionsDb, { executorId: "test", workspaceId: root, ownerPrincipalId: principalId("bot", "owner"), protectedPaths: [] });
    owner = subjectKey(permissions.context(message("identity"), "unused").subject);
    store = control.enableTasks((msg, session) => subjectKey(permissions.context(msg, session).subject));
    review.mockReset(); review.mockResolvedValue({ decision: "approved", reason: "ready", gaps: [] });
    run.mockReset(); run.mockImplementation(request => { request.beforeModelCall?.(); select(request); return Promise.resolve({ text: result(), replyImages: ["forged-model-id"] }); });
    manager = new TaskManager(store, { review }, permissions, { selected: (who, task, rev) => Promise.resolve(control.selectedReplyImages(who, task, rev).map(id => ({ id, mimeType: "image/png", width: 1, height: 1, bytes: 3, createdAt: new Date().toISOString() }))) });
    ingest = new IngestMessage(control, new ExactSenderPolicy("owner"), undefined, permissions, manager);
    runner = new RunNextTurn(control, { runTurn: run, recordContext: () => Promise.resolve(), checkReady: () => Promise.resolve({ ready: true }) }, new DryRunChannel(), new ReplyChunker(), { ownerId: "worker" }, undefined, undefined, permissions, undefined, undefined, undefined, manager);
  });
  afterEach(() => { vi.restoreAllMocks(); db.close(); control.close(); permissionsDb.close(); rmSync(root, { recursive: true, force: true }); });
  const imageCount = () => Number(db.prepare("SELECT count(*) AS n FROM outbox WHERE artifact_id IS NOT NULL").get()!.n);
  it("publishes only trusted selected images after review and presents metadata to reviewer", async () => {
    send("截图发来"); expect((await runner.execute()).status).toBe("completed");
    expect(imageCount()).toBe(1);
    expect(review.mock.calls[0]![0].attachments).toMatchObject([{ id: "image-2", mimeType: "image/png" }]);
    expect(db.prepare("SELECT artifact_id FROM outbox WHERE artifact_id IS NOT NULL").get()!.artifact_id).toBe("image-2");
  });
  it.each(["waiting", "continue"])("does not publish images for execution %s", async disposition => {
    run.mockImplementation(request => { request.beforeModelCall?.(); select(request); return Promise.resolve({ text: result(disposition), replyImages: ["forged"] }); });
    send("截图"); await runner.execute(); expect(imageCount()).toBe(0); expect(review).not.toHaveBeenCalled();
  });
  it.each(["waiting", "revise"] as const)("does not publish images for review %s", async decision => {
    review.mockResolvedValue({ decision, reason: "more evidence", gaps: ["missing"], question: "confirm" });
    send("截图"); await runner.execute(); expect(imageCount()).toBe(0);
  });
  it("retains candidates across internal runs and publishes after approval", async () => {
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); select(request); return Promise.resolve({ text: result("continue") }); });
    run.mockImplementationOnce(request => { request.beforeModelCall?.(); return Promise.resolve({ text: result() }); });
    send("截图"); await runner.execute(); expect(imageCount()).toBe(0); await runner.execute(); expect(imageCount()).toBe(1);
  });
  it("cancel during review suppresses attachments and final result", async () => {
    review.mockImplementation(() => { send("/task cancel"); return Promise.resolve({ decision: "approved", reason: "late", gaps: [] }); });
    send("截图"); await runner.execute(); expect(imageCount()).toBe(0);
  });
  it("new input during review prevents publishing old revision attachments", async () => {
    review.mockImplementation(() => { send("不要发截图，改成文字说明"); return Promise.resolve({ decision: "approved", reason: "late", gaps: [] }); });
    send("截图"); await runner.execute(); expect(imageCount()).toBe(0);
    const task = store.list(owner)[0]!; expect(control.selectedReplyImages(owner, task.id, task.revision)).toEqual([]);
  });
  it("publishes a pure image reply without a placeholder text row", async () => {
    run.mockImplementation(request => { request.beforeModelCall?.(); select(request); return Promise.resolve({ text: JSON.stringify({ disposition: "request_completion", progress: "图片已生成", remaining: "", evidence: [], result: "" }) }); });
    send("只发图片"); await runner.execute();
    expect(imageCount()).toBe(1);
    expect(db.prepare("SELECT count(*) AS n FROM outbox WHERE artifact_id IS NULL").get()!.n).toBe(0);
  });
  it("does not accept an empty completion without trusted attachments", async () => {
    run.mockImplementation(request => { request.beforeModelCall?.(); return Promise.resolve({ text: JSON.stringify({ disposition: "request_completion", progress: "", remaining: "", evidence: [], result: "" }), replyImages: ["forged"] }); });
    send("只发图片"); await runner.execute();
    expect(imageCount()).toBe(0); expect(review).not.toHaveBeenCalled();
    expect(store.list(owner)[0]!.status).toBe("PAUSED");
  });
  it("rejects a missing snapshot at settlement even after approval", async () => {
    review.mockImplementation(() => {
      db.exec("UPDATE image_artifacts SET deleted_at='2026-01-01T00:00:00.000Z'");
      return Promise.resolve({ decision: "approved", reason: "late", gaps: [] });
    });
    send("截图"); await runner.execute(); expect(imageCount()).toBe(0);
    expect(store.list(owner)[0]!.status).not.toBe("COMPLETED");
  });
  it("outbox failure rolls back image publication and Task completion", async () => {
    db.exec("CREATE TRIGGER reject_image BEFORE INSERT ON outbox WHEN NEW.artifact_id IS NOT NULL BEGIN SELECT RAISE(ABORT,'injected image failure'); END;");
    send("截图"); await runner.execute(); expect(imageCount()).toBe(0);
    expect(store.list(owner)[0]!.status).not.toBe("COMPLETED");
    expect(db.prepare("SELECT count(*) AS n FROM outbox").get()!.n).toBe(0);
  });
});

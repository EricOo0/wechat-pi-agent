import { mkdtempSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SqliteControlPlane } from "../../src/adapters/outbound/sqlite/sqlite-control-plane.js";
import { SqlitePermissionRepository } from "../../src/adapters/outbound/sqlite/sqlite-permission-repository.js";
import { PermissionService } from "../../src/application/services/permission-service.js";
import { IngestMessage } from "../../src/application/use-cases/ingest-message.js";
import { RunNextTurn } from "../../src/application/use-cases/run-next-turn.js";
import { ReplyChunker } from "../../src/application/services/reply-chunker.js";
import { ExactSenderPolicy } from "../../src/domain/policy/sender-policy.js";
import { principalId } from "../../src/domain/policy/permissions.js";
import { DryRunChannel } from "../../src/adapters/outbound/ilink/dry-run-channel.js";
import type { InboundMessage } from "../../src/domain/messaging/inbound-message.js";
import type { AgentRunRequest } from "../../src/application/interfaces/agent.js";

describe("permission task continuation", () => {
  let dir: string;
  let control: SqliteControlPlane;
  let repo: SqlitePermissionRepository;
  let permissions: PermissionService;
  let ingest: IngestMessage;
  let runner: RunNextTurn;
  let now: number;
  let seq: number;
  let requested: string;
  const runTurn = vi.fn<(request: AgentRunRequest) => Promise<{ text: string }>>();
  const msg = (text: string, senderId = "owner"): InboundMessage => ({ id: `m${++seq}`, accountId: "account", channelMessageId: `r${seq}`, senderId, peerId: "peer", text, receivedAt: new Date() });
  const send = (message: InboundMessage) => ingest.execute({ accountId: "account", previousCursor: control.getCursor("account"), nextCursor: String(seq), messages: [message] });
  const wire = () => {
    permissions = new PermissionService(repo, { executorId: "host", workspaceId: "work", ownerPrincipalId: principalId("account", "owner"), protectedPaths: [], now: () => now });
    ingest = new IngestMessage(control, new ExactSenderPolicy("owner"), undefined, permissions);
    runner = new RunNextTurn(control, { recordContext: () => Promise.resolve(), runTurn, checkReady: () => Promise.resolve({ ready: true }) }, new DryRunChannel(), new ReplyChunker(), { ownerId: "worker" }, undefined, undefined, permissions);
  };
  const blockTask = async (images?: InboundMessage["images"]) => {
    const task = { ...msg("write the requested report"), ...(images ? { images } : {}) };
    send(task);
    runTurn.mockImplementationOnce((request) => {
      if (!request.permissionContext?.taskTurnId) throw new Error("Missing bound task");
      request.onSessionReady?.("pi-id", `${dir}/pi-session.jsonl`);
      const text = permissions.request(request.permissionContext, { kind: "shell" });
      requested = text.match(/确认授权 ([a-f0-9-]+)/u)?.[1] ?? "";
      return Promise.resolve({ text });
    });
    const result = await runner.execute();
    if (result.status !== "completed") throw new Error("Source failed");
    expect(repo.findRequest(requested)?.blockedTurnId).toBe(result.turnId);
    return { task, turnId: result.turnId, sessionId: runTurn.mock.calls[0]?.[0].session.id };
  };
  const approve = async () => {
    const approval = msg(`确认授权 ${requested}`); send(approval);
    expect((await runner.execute()).status).toBe("completed");
    return approval;
  };
  beforeEach(() => {
    dir = mkdtempSync("/tmp/pi-resume-"); now = Date.now(); seq = 0; requested = "";
    control = new SqliteControlPlane(`${dir}/app.db`); control.migrate();
    repo = new SqlitePermissionRepository(`${dir}/permissions.db`); wire();
    runTurn.mockReset(); runTurn.mockResolvedValue({ text: "resumed successfully" });
  });
  afterEach(() => { control.close(); repo.close(); rmSync(dir, { recursive: true, force: true }); });

  it("automatically resumes exactly once without another user task message", async () => {
    const source = await blockTask();
    const approval = await approve();
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect((await runner.execute()).status).toBe("completed");
    expect(runTurn).toHaveBeenCalledTimes(2);
    expect(runTurn.mock.calls[1]?.[0].prompt).toContain(source.task.text);
    expect(runTurn.mock.calls[1]?.[0].session.id).toBe(source.sessionId);
    send(approval);
    expect((await runner.execute()).status).toBe("idle");
    send(msg(`确认授权 ${requested}`)); await runner.execute();
    expect((await runner.execute()).status).toBe("idle");
    expect(runTurn).toHaveBeenCalledTimes(2);
  });
  it("does not schedule denied sender, expired, wrong-session, or unknown confirmations", async () => {
    await blockTask();
    send(msg(`确认授权 ${requested}`, "stranger"));
    expect((await runner.execute()).status).toBe("idle");
    const wrong = msg(`确认授权 ${requested}`);
    expect(permissions.handleMessage(wrong, "other-session")).toContain("另一个会话");
    expect(permissions.continuationFor(wrong, "other-session")).toBeUndefined();
    now += 600001;
    send(msg(`确认授权 ${requested}`)); await runner.execute();
    send(msg("确认授权 00000000-0000-0000-0000-000000000000")); await runner.execute();
    expect((await runner.execute()).status).toBe("idle");
    expect(runTurn).toHaveBeenCalledTimes(1);
  });
  it("cancels a queued continuation when permission is revoked before it runs", async () => {
    await blockTask(); await approve();
    send(msg("/permissions reset")); // reset applies on ingress before the queued continuation
    const result = await runner.execute();
    expect(result.status).toBe("completed");
    expect(runTurn).toHaveBeenCalledTimes(1);
    await runner.execute(); expect((await runner.execute()).status).toBe("idle");
  });
  it("persists continuation source session, images and early Pi locator across restart", async () => {
    const images = [{ path: `${dir}/image.png`, mimeType: "image/png" as const, bytes: 10 }];
    const source = await blockTask(images); await approve();
    control.close(); repo.close();
    control = new SqliteControlPlane(`${dir}/app.db`); control.migrate();
    repo = new SqlitePermissionRepository(`${dir}/permissions.db`); wire();
    await runner.execute();
    const resumed = runTurn.mock.calls[1]?.[0];
    expect(resumed?.session.id).toBe(source.sessionId);
    expect(resumed?.session.piSessionFile).toBe(`${dir}/pi-session.jsonl`);
    expect(resumed?.images).toEqual(images);
  });
  it("does not resume a source archived by new-session command", async () => {
    await blockTask(); send(msg("/new")); await runner.execute();
    send(msg(`确认授权 ${requested}`)); await runner.execute();
    expect((await runner.execute()).status).toBe("idle");
    expect(runTurn).toHaveBeenCalledTimes(1);
  });
  it("new-session ingress cancels an already queued continuation without removing permanent permissions", async () => {
    await blockTask(); await approve();
    const fresh = msg("/new"); send(fresh);
    expect(repo.findRequest(requested)).toMatchObject({ status: "approved", continuationCancelled: true });
    await runner.execute(); await runner.execute();
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect((await runner.execute()).status).toBe("idle");
  });
  it("plain permission settings commands do not attach to the previous task", async () => {
    send(msg("a normal task")); await runner.execute();
    const proposal = msg("/permissions request shell"); send(proposal); await runner.execute();
    const sessionId = control.getMessageSession("account", proposal.channelMessageId);
    if (!sessionId) throw new Error("Missing session");
    const request = repo.listRequests(permissions.context(proposal, sessionId).subject)[0];
    expect(request?.blockedTurnId).toBeUndefined();
    send(msg(`确认授权 ${request?.id}`)); await runner.execute();
    expect((await runner.execute()).status).toBe("idle");
    expect(runTurn).toHaveBeenCalledTimes(1);
  });
  it("rolls back approval reply and continuation atomically for a cross-user source", () => {
    const sourceMessage = msg("source", "other");
    control.ingestBatch({ accountId: "account", previousCursor: "", nextCursor: "source", messages: [sourceMessage] });
    const source = control.claimNextTurn("test", 60000);
    if (!source) throw new Error("Missing source");
    control.completeTurn({ turnId: source.turn.id, finalResponse: "source", chunks: [] });
    send(msg("确认授权 00000000-0000-0000-0000-000000000000"));
    const approval = control.claimNextTurn("test", 60000);
    if (!approval) throw new Error("Missing approval");
    expect(() => control.completeTurn({ turnId: approval.turn.id, finalResponse: "approved", chunks: ["approved"], continuation: { permissionRequestId: "invalid-request", sourceTurnId: source.turn.id } })).toThrow("does not match");
    expect(control.getTurnDetails(approval.turn.id)).toMatchObject({ turn: { status: "RUNNING" } });
    expect(control.claimNextOutbox("test", 60000)).toBeUndefined();
    control.completeTurn({ turnId: approval.turn.id, finalResponse: "rejected", chunks: ["rejected"] });
    expect(control.claimNextOutbox("test", 60000)).toBeDefined();
  });
});

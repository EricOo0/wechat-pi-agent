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

describe("authenticated permission flow", () => {
  let dir: string;
  let control: SqliteControlPlane;
  let repo: SqlitePermissionRepository;
  let permissions: PermissionService;
  let ingest: IngestMessage;
  let runner: RunNextTurn;
  let seq: number;
  const changed = vi.fn();
  const runTurn = vi.fn((request: AgentRunRequest) => Promise.resolve({ text: `agent reply: ${request.prompt}` }));
  const message = (text: string, senderId = "owner"): InboundMessage => ({ id: `m${++seq}`, accountId: "account", channelMessageId: `remote-${seq}`, senderId, peerId: "peer", text, receivedAt: new Date() });
  const send = (msg: InboundMessage) => ingest.execute({ accountId: "account", previousCursor: control.getCursor("account"), nextCursor: String(seq), messages: [msg] });
  const context = (msg: InboundMessage) => {
    const session = control.getMessageSession(msg.accountId, msg.channelMessageId);
    if (!session) throw new Error("Missing stored session");
    return permissions.context(msg, session);
  };
  const requestId = (msg: InboundMessage) => {
    const id = repo.listRequests(context(msg).subject).at(-1)?.id;
    if (!id) throw new Error("Missing request");
    return id;
  };
  const wire = () => {
    permissions = new PermissionService(repo, { executorId: "host", workspaceId: "work", ownerPrincipalId: principalId("account", "owner"), protectedPaths: [], onChange: changed });
    ingest = new IngestMessage(control, new ExactSenderPolicy("owner"), undefined, permissions);
    runner = new RunNextTurn(control, { recordContext: () => Promise.resolve(), runTurn, checkReady: () => Promise.resolve({ ready: true }) }, new DryRunChannel(), new ReplyChunker(), { ownerId: "test" }, undefined, undefined, permissions);
  };
  beforeEach(() => {
    dir = mkdtempSync("/tmp/pi-permission-flow-"); seq = 0; changed.mockClear(); runTurn.mockClear();
    control = new SqliteControlPlane(`${dir}/app.db`); control.migrate();
    repo = new SqlitePermissionRepository(`${dir}/permissions.db`); wire();
  });
  afterEach(() => { control.close(); repo.close(); rmSync(dir, { recursive: true, force: true }); });

  it("applies authenticated confirmation at ingress before the pending normal turn runs", async () => {
    const normal = message("hello"); send(normal);
    const proposal = message("开启全部权限"); send(proposal);
    expect(permissions.snapshot(context(normal)).policy.mode).toBe("restricted");
    const approval = message(`确认授权 ${requestId(proposal)}`); send(approval);
    expect(changed).toHaveBeenCalledTimes(1);
    expect(runTurn).not.toHaveBeenCalled();
    expect(permissions.snapshot(context(normal)).policy.mode).toBe("full-access");
    expect(send(approval).inserted).toBe(0);
    expect(changed).toHaveBeenCalledTimes(1);
    await runner.execute();
    expect(runTurn.mock.calls[0]?.[0].permissionContext).toMatchObject(context(normal));
    expect(runTurn.mock.calls[0]?.[0].permissionContext?.taskTurnId).toMatch(/^trn_/u);
    await runner.execute(); await runner.execute();
    expect(runTurn).toHaveBeenCalledTimes(1);
    expect(changed).toHaveBeenCalledTimes(1);
  });
  it("does not persist or apply denied sender controls", () => {
    const denied = message("开启全部权限", "stranger");
    expect(send(denied)).toEqual({ inserted: 0, rejected: 1 });
    expect(control.getMessageSession(denied.accountId, denied.channelMessageId)).toBeUndefined();
    expect(changed).not.toHaveBeenCalled();
    const owner = message("hello"); send(owner);
    expect(repo.listRequests(context(owner).subject)).toEqual([]);
  });
  it("persists full access then reset prevents replayed approval from reopening it", () => {
    const proposal = message("开启全部权限"); send(proposal);
    const approval = message(`确认授权 ${requestId(proposal)}`); send(approval);
    repo.close(); repo = new SqlitePermissionRepository(`${dir}/permissions.db`); wire();
    expect(permissions.snapshot(context(proposal)).policy.mode).toBe("full-access");
    send(message("/permissions reset"));
    expect(permissions.snapshot(context(proposal)).policy.mode).toBe("restricted");
    send(approval);
    expect(permissions.snapshot(context(proposal)).policy.mode).toBe("restricted");
    expect(changed).toHaveBeenCalledTimes(2);
  });
  it("uses persisted text when duplicate delivery changes its payload", () => {
    const proposal = message("开启全部权限"); send(proposal);
    send(message(`确认授权 ${requestId(proposal)}`));
    const original = message("hello"); send(original);
    send({ ...original, text: "/permissions reset" });
    expect(permissions.snapshot(context(proposal)).policy.mode).toBe("full-access");
  });
  it("new session revokes temporary grants while preserving permanent ones", async () => {
    const normal = message("hello"); send(normal); await runner.execute();
    const ctx = context(normal);
    const shell = permissions.request(ctx, { kind: "shell" }, "session").match(/确认授权 ([a-f0-9-]+)/u)?.[1];
    send(message(`确认授权 ${shell}`)); await runner.execute();
    const networkProposal = message("/permissions request network example.com"); send(networkProposal); await runner.execute();
    send(message(`确认授权 ${requestId(networkProposal)}`)); await runner.execute();
    expect(permissions.snapshot(ctx).policy.shell).toBe(true);
    send(message("/new")); await runner.execute();
    expect(permissions.snapshot(ctx).policy.shell).toBe(false);
    const next = message("next"); send(next); await runner.execute();
    expect(context(next).sessionId).not.toBe(ctx.sessionId);
    expect(permissions.snapshot(context(next)).policy.allowedDomains).toEqual(["example.com"]);
  });
});

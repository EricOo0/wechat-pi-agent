import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, realpathSync, rmSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { PermissionService } from "../../../src/modules/permissions/application/permission-service.js";
import { SqlitePermissionRepository } from "../../../src/adapters/sqlite/sqlite-permission-repository.js";
import { principalId } from "../../../src/modules/permissions/domain/permissions.js";
import type { InboundMessage } from "../../../src/modules/messaging/domain/inbound-message.js";
import type { PermissionLifetime } from "../../../src/modules/permissions/ports/permission-repository.js";

describe("permission authority and persistence", () => {
  let directory: string;
  let repository: SqlitePermissionRepository;
  let service: PermissionService;
  let now: number;
  let sequence: number;
  const message = (text: string, senderId = "owner", peerId = "peer"): InboundMessage => ({ id: String(++sequence), channelMessageId: String(sequence), accountId: "account", senderId, peerId, text, receivedAt: new Date(now) });
  const boot = () => {
    repository = new SqlitePermissionRepository(`${directory}/permissions.db`);
    service = new PermissionService(repository, { executorId: "machine", workspaceId: "workspace", ownerPrincipalId: principalId("account", "owner"), protectedPaths: [`${directory}/control`], now: () => now });
  };
  const request = (change: unknown, lifetime: PermissionLifetime = "persistent", sender = "owner") => {
    const response = service.request(service.context(message("request", sender), "session"), change, lifetime);
    const id = response.match(/确认授权 ([a-f0-9-]+)/u)?.[1];
    if (!id) throw new Error("Missing request id");
    return id;
  };
  const confirm = (id: string, sender = "owner", peer = "peer", session = "session") => service.handleMessage(message(`确认授权 ${id}`, sender, peer), session);
  const context = () => service.context(message("tool"), "session");
  beforeEach(() => {
    directory = realpathSync(mkdtempSync("/tmp/pi-permissions-")); now = 10000; sequence = 0;
    mkdirSync(`${directory}/control`); mkdirSync(`${directory}/outside`); mkdirSync(`${directory}/workspace`);
    boot();
  });
  afterEach(() => { repository.close(); rmSync(directory, { recursive: true, force: true }); });

  it("persists grants and receipts across repository reopen", () => {
    const id = request({ kind: "shell" });
    const approval = message(`确认授权 ${id}`);
    const receipt = service.handleMessage(approval, "session");
    repository.close(); boot();
    expect(service.snapshot(context()).policy.shell).toBe(true);
    expect(service.handleMessage(approval, "session")).toBe(receipt);
    expect(service.snapshot(context()).revision).toBe(1);
  });
  it("rolls back the grant and revision if the audit write fails", () => {
    const id = request({ kind: "full-access" });
    const audit = vi.spyOn(repository, "recordEvent").mockImplementationOnce(() => { throw new Error("audit storage failure"); });
    expect(confirm(id)).toContain("未生效");
    expect(repository.findRequest(id)?.status).toBe("pending");
    expect(service.snapshot(context())).toMatchObject({ revision: 0, policy: { mode: "restricted" } });
    audit.mockRestore();
    expect(confirm(id)).toContain("已保存授权");
  });
  it("rejects confirmation by another user, peer, session, and executor scope", () => {
    const id = request({ kind: "shell" });
    expect(confirm(id, "other")).toContain("无此权限申请");
    expect(confirm(id, "owner", "other-peer")).toContain("无此权限申请");
    expect(confirm(id, "owner", "peer", "other-session")).toContain("另一个会话");
    const otherService = new PermissionService(repository, { executorId: "other-machine", workspaceId: "workspace", ownerPrincipalId: principalId("account", "owner"), protectedPaths: [], now: () => now });
    expect(otherService.handleMessage(message(`确认授权 ${id}`), "session")).toContain("无此权限申请");
    expect(service.snapshot(context()).policy.shell).toBe(false);
    expect(confirm(id)).toContain("已保存授权");
  });
  it("rejects stale, expired, and already consumed approval requests", () => {
    const shell = request({ kind: "shell" });
    const network = request({ kind: "network", resource: "example.com" });
    confirm(shell);
    expect(confirm(network)).toContain("权限已发生变化");
    expect(confirm(shell)).toContain("已处理");
    const expired = request({ kind: "network", resource: "example.org" });
    now += 600001;
    expect(confirm(expired)).toContain("已过期");
  });
  it("deduplicates identical request from one source message", () => {
    const ctx = context();
    expect(service.request(ctx, { kind: "shell" })).toBe(service.request(ctx, { kind: "shell" }));
    expect(repository.listRequests(ctx.subject)).toHaveLength(1);
  });
  it("atomically gives a one-use grant to only one competing acquisition", async () => {
    confirm(request({ kind: "shell" }, "once"));
    const snapshots = await Promise.all([1, 2].map(() => Promise.resolve().then(() => service.acquire(context(), { kind: "bash", command: "true" }, `${directory}/workspace`))));
    expect(snapshots.filter((snapshot) => snapshot.policy.shell)).toHaveLength(1);
  });
  it("consumes once-read permission when accessed through a symlink alias", () => {
    symlinkSync(`${directory}/outside`, `${directory}/workspace/link`);
    writeFileSync(`${directory}/outside/file`, "test");
    confirm(request({ kind: "read", resource: `${directory}/outside` }, "once"));
    const first = service.acquire(context(), { kind: "read", path: "link/file" }, `${directory}/workspace`);
    const second = service.acquire(context(), { kind: "read", path: "link/file" }, `${directory}/workspace`);
    expect(first.policy.readRoots).toContain(`${directory}/outside`);
    expect(second.policy.readRoots).not.toContain(`${directory}/outside`);
  });
  it("reset revokes grants and pending requests, surviving duplicate delivery", () => {
    confirm(request({ kind: "shell" }));
    const pending = request({ kind: "network", resource: "example.com" });
    const reset = message("/permissions reset");
    const response = service.handleMessage(reset, "session");
    expect(service.handleMessage(reset, "session")).toBe(response);
    expect(service.snapshot(context()).policy.shell).toBe(false);
    expect(confirm(pending)).toContain("已处理");
    expect(service.snapshot(context()).revision).toBe(2);
  });
  it("limits host full access to owner and grants it only after confirmation", () => {
    expect(() => request({ kind: "full-access" }, "persistent", "other")).toThrow("机器所有者");
    const id = request({ kind: "full-access" });
    expect(service.snapshot(context()).policy.mode).toBe("restricted");
    confirm(id);
    expect(service.snapshot(context()).policy.mode).toBe("full-access");
  });
  it("rejects relative/missing/protected paths and malformed domains", () => {
    for (const resource of ["relative/path", `${directory}/missing`, `${directory}/control`]) {
      expect(() => request({ kind: "write", resource })).toThrow();
    }
    for (const resource of ["https://example.com", "example.com/path", "example.com:443", "*.com/", "bad host"]) {
      expect(() => request({ kind: "network", resource })).toThrow();
    }
  });
  it("keeps session grants out of a new session while persistent grants survive", () => {
    confirm(request({ kind: "shell" }, "session"));
    confirm(request({ kind: "network", resource: "example.com" }));
    const snapshot = service.snapshot(service.context(message("tool"), "new-session"));
    expect(snapshot.policy.shell).toBe(false);
    expect(snapshot.policy.allowedDomains).toEqual(["example.com"]);
  });
});

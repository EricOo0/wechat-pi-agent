import { randomUUID } from "node:crypto";
import { realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, relative, resolve, sep } from "node:path";
import type { InboundMessage } from "../../domain/messaging/inbound-message.js";
import { basicPolicy, permissionChangeSchema, principalId, subjectKey, type PermissionChange, type PermissionPolicy, type PermissionSnapshot, type PermissionSubject, type ToolOperation } from "../../domain/policy/permissions.js";
import type { PermissionLifetime, PermissionRepository, PermissionRequest } from "../interfaces/permission-repository.js";

export interface PermissionContext {
  subject: PermissionSubject;
  peerId: string;
  sessionId: string;
  sourceMessageId: string;
  taskTurnId?: string;
}

export interface PermissionServiceOptions {
  executorId: string;
  workspaceId: string;
  ownerPrincipalId: string;
  protectedPaths: string[];
  workspaceBase?: string;
  onChange?: (subject: PermissionSubject) => void;
  now?: () => number;
}

export class PermissionService {
  private readonly now: () => number;
  public constructor(private readonly repository: PermissionRepository, private readonly options: PermissionServiceOptions) {
    this.now = options.now ?? Date.now;
  }

  public context(message: InboundMessage, sessionId: string, taskTurnId?: string): PermissionContext {
    return {
      subject: { principalId: principalId(message.accountId, message.senderId), executorId: this.options.executorId, workspaceId: this.options.workspaceId },
      peerId: message.peerId, sessionId,
      sourceMessageId: JSON.stringify([message.accountId, message.channelMessageId]),
      ...(taskTurnId === undefined ? {} : { taskTurnId }),
    };
  }

  /** Only the original successful confirmation can schedule the linked task. */
  public continuationFor(message: InboundMessage, sessionId: string): { permissionRequestId: string; sourceTurnId: string } | undefined {
    const id = message.text.trim().match(/^(?:\/permissions\s+confirm|确认授权)\s+([a-f0-9-]+)$/iu)?.[1];
    if (!id) return undefined;
    const context = this.context(message, sessionId);
    const request = this.repository.findRequest(id);
    if (!request || request.approvedByMessageId !== context.sourceMessageId || !request.blockedTurnId || !this.canResume(context, request)) return undefined;
    return { permissionRequestId: request.id, sourceTurnId: request.blockedTurnId };
  }

  public canContinue(message: InboundMessage, sessionId: string, requestId: string, sourceTurnId: string): boolean {
    const request = this.repository.findRequest(requestId);
    return request !== undefined && request.blockedTurnId === sourceTurnId && this.canResume(this.context(message, sessionId), request);
  }

  private canResume(context: PermissionContext, request: PermissionRequest): boolean {
    return subjectKey(request.subject) === subjectKey(context.subject) && request.peerId === context.peerId
      && request.sessionId === context.sessionId && !request.continuationCancelled && request.status === "approved" && request.expiresAt > this.now();
  }

  public snapshot(context: PermissionContext): PermissionSnapshot {
    const stored = this.repository.get(context.subject);
    return { ...stored, policy: this.effective(context) };
  }

  public describe(context: PermissionContext): string {
    const snapshot = this.snapshot(context);
    const grants = this.active(context);
    return [
      `权限版本：${snapshot.revision}`,
      `模式：${snapshot.policy.mode === "full-access" ? "宿主机全部权限（当前系统账号，不自动提权）" : "受限模式"}`,
      "基本权限：个人工作目录读写、已批准 Skill 目录只读。",
      `命令执行：${snapshot.policy.shell || snapshot.policy.mode === "full-access" ? "开启" : "关闭"}`,
      `网络：${snapshot.policy.mode === "full-access" ? "宿主机网络" : snapshot.policy.allowedDomains.join(", ") || "关闭"}`,
      ...grants.map((grant) => `${grant.id}：${describeChange(grant.change)}；${lifetimeLabel(grant.lifetime)}`),
      "可说“开启全部权限”或说明需要访问的目录／域名。申请后回复“确认授权 请求编号”。",
      "撤销某项：/permissions revoke 请求编号；恢复基本权限：/permissions reset。",
    ].join("\n");
  }

  public request(context: PermissionContext, input: unknown, lifetime: PermissionLifetime = "persistent"): string {
    return this.repository.transaction(() => this.createRequest(context, input, lifetime));
  }

  /** Only call for authenticated, persisted user messages, never model/tool output. */
  public handleMessage(message: InboundMessage, sessionId: string): string | undefined {
    const text = message.text.trim();
    const isCommand = /^\/permissions(?:\s|$)/iu.test(text)
      || /^(?:确认授权\s+\S+|开启全部权限|打开全部权限|查看权限|恢复基本权限|撤销全部权限)$/u.test(text);
    if (!isCommand) return undefined;
    const context = this.context(message, sessionId);
    const receiptKey = JSON.stringify([context.subject, context.sourceMessageId]);
    const before = this.repository.get(context.subject).revision;
    let response: string;
    try {
      response = this.repository.transaction(() => {
        const receipt = this.repository.receipt(receiptKey);
        if (receipt !== undefined) return receipt;
        const reply = this.command(context, text);
        this.repository.saveReceipt(receiptKey, reply);
        return reply;
      });
    } catch (error) {
      // A failed command rolls back grants, policy, audit AND receipt together.
      response = this.repository.transaction(() => {
        const receipt = this.repository.receipt(receiptKey);
        if (receipt !== undefined) return receipt;
        const reply = `权限变更未生效：${error instanceof Error ? error.message : String(error)}`;
        this.repository.saveReceipt(receiptKey, reply);
        return reply;
      });
    }
    if (this.repository.get(context.subject).revision !== before) this.options.onChange?.(context.subject);
    return response;
  }

  /** A one-use grant is atomically consumed only by the matching tool operation. */
  public acquire(context: PermissionContext, operation: ToolOperation, workspaceRoot: string): PermissionSnapshot {
    return this.repository.transaction(() => {
      const applicable = this.active(context).filter((grant) => grant.lifetime !== "once" || matchesOperation(grant.change, operation, workspaceRoot));
      const snapshot = { ...this.repository.get(context.subject), policy: applicable.reduce((policy, grant) => applyChange(policy, grant.change), basicPolicy()) };
      for (const grant of applicable) {
        if (grant.lifetime !== "once") continue;
        this.repository.putRequest({ ...grant, status: "consumed" });
        this.repository.recordEvent(context.subject, context.sourceMessageId, "consume", { requestId: grant.id });
      }
      return snapshot;
    });
  }

  public endSession(context: PermissionContext): void {
    const receiptKey = `end-session:${JSON.stringify([context.subject, context.sourceMessageId])}`;
    const before = this.repository.get(context.subject).revision;
    this.repository.transaction(() => {
      if (this.repository.receipt(receiptKey) !== undefined) return;
      for (const request of this.repository.listRequests(context.subject)) {
        if (request.sessionId !== context.sessionId) continue;
        if (request.status === "pending" || (request.status === "approved" && request.lifetime !== "persistent")) {
          this.repository.putRequest({ ...request, status: "revoked", continuationCancelled: true });
        } else if (request.status === "approved") {
          this.repository.putRequest({ ...request, continuationCancelled: true });
        }
      }
      this.bump(context, "end-session", { sessionId: context.sessionId });
      this.repository.saveReceipt(receiptKey, "ended");
    });
    if (this.repository.get(context.subject).revision !== before) this.options.onChange?.(context.subject);
  }

  private command(context: PermissionContext, text: string): string {
    if (/^(?:\/permissions(?:\s+status)?|查看权限)$/iu.test(text)) return this.describe(context);
    if (/^(?:\/permissions\s+reset|恢复基本权限|撤销全部权限)$/iu.test(text)) {
      for (const request of this.repository.listRequests(context.subject)) {
        if (request.status === "approved" || request.status === "pending") this.repository.putRequest({ ...request, status: "revoked" });
      }
      this.bump(context, "reset", {});
      return "已恢复基本权限并取消待确认申请；旧工具执行已取消，后续工具将采用新策略。宿主机 Full Access 期间已产生的改动不会回滚。";
    }
    if (/^(?:开启全部权限|打开全部权限)$/u.test(text)) return this.createRequest(context, { kind: "full-access" }, "persistent");
    const confirm = text.match(/^(?:\/permissions\s+confirm|确认授权)\s+([a-f0-9-]+)$/iu);
    if (confirm?.[1]) return this.confirm(context, confirm[1]);
    const revoke = text.match(/^\/permissions\s+(revoke|reject)\s+([a-f0-9-]+)$/iu);
    if (revoke?.[2]) {
      const request = this.owned(context, revoke[2]);
      this.repository.putRequest({ ...request, status: "revoked" });
      this.bump(context, "revoke", { requestId: request.id });
      return `已撤销 ${request.id}；旧工具执行已取消，后续工具采用新策略。`;
    }
    const request = text.match(/^\/permissions\s+request\s+(full-access|shell|read|write|network)(?:\s+(.+))?$/iu);
    if (request?.[1]) {
      const kind = request[1].toLowerCase();
      const resource = request[2]?.trim();
      return this.createRequest(context, kind === "shell" || kind === "full-access" ? { kind } : { kind, resource }, "persistent");
    }
    return "权限命令：/permissions、/permissions request full-access、/permissions request shell、/permissions request read /绝对目录、/permissions request write /绝对目录、/permissions request network example.com、/permissions confirm 编号、/permissions revoke 编号、/permissions reset。也可直接用自然语言提出申请。";
  }

  private createRequest(context: PermissionContext, input: unknown, lifetime: PermissionLifetime): string {
    const change = this.normalize(permissionChangeSchema.parse(input), context);
    if (change.kind === "full-access" && context.subject.principalId !== this.options.ownerPrincipalId) {
      throw new Error("只有机器所有者可以开启宿主机全部权限");
    }
    const duplicate = this.repository.listRequests(context.subject).find((request) => request.sourceMessageId === context.sourceMessageId
      && request.sessionId === context.sessionId && request.lifetime === lifetime && JSON.stringify(request.change) === JSON.stringify(change)
      && request.status === "pending" && request.expiresAt > this.now());
    const request: PermissionRequest = duplicate ?? {
      id: randomUUID(), subject: context.subject, peerId: context.peerId, sessionId: context.sessionId,
      sourceMessageId: context.sourceMessageId, change, lifetime, baseRevision: this.repository.get(context.subject).revision,
      ...(context.taskTurnId === undefined ? {} : { blockedTurnId: context.taskTurnId }),
      status: "pending", expiresAt: this.now() + 10 * 60_000,
    };
    if (!duplicate) {
      this.repository.putRequest(request);
      this.repository.recordEvent(context.subject, context.sourceMessageId, "request", request);
    }
    return [
      `待授权：${describeChange(change)}`, `有效范围：${lifetimeLabel(lifetime)}`,
      ...(change.kind === "full-access" ? ["确认后将退出工具沙箱，可访问当前系统账号的文件和网络、运行任意命令，包括服务本身的数据与配置；不自动获得 root 权限。"] : []),
      "尚未开启。请在当前对话中于 10 分钟内回复：", `确认授权 ${request.id}`,
    ].join("\n");
  }

  private confirm(context: PermissionContext, id: string): string {
    const request = this.owned(context, id);
    if (request.sessionId !== context.sessionId) throw new Error("申请属于另一个会话，请重新申请");
    if (request.status !== "pending") throw new Error("申请已处理，不能再次确认");
    if (request.expiresAt <= this.now()) throw new Error("申请已过期，请重新申请");
    if (request.baseRevision !== this.repository.get(context.subject).revision) throw new Error("权限已发生变化，请按当前状态重新申请");
    const change = this.normalize(request.change, context);
    if (change.kind === "full-access" && context.subject.principalId !== this.options.ownerPrincipalId) throw new Error("只有机器所有者可以开启宿主机全部权限");
    this.repository.putRequest({ ...request, change, status: "approved", approvedByMessageId: context.sourceMessageId, expiresAt: request.lifetime === "once" ? this.now() + 10 * 60_000 : Number.MAX_SAFE_INTEGER });
    this.bump(context, "approve", { requestId: id, change, lifetime: request.lifetime });
    return `已保存授权：${describeChange(change)}；${lifetimeLabel(request.lifetime)}。${request.blockedTurnId ? "将自动继续申请权限时的任务，无需再次输入。" : "下一次工具调用将应用新权限。"}`;
  }

  private owned(context: PermissionContext, id: string): PermissionRequest {
    const request = this.repository.findRequest(id);
    if (!request || subjectKey(request.subject) !== subjectKey(context.subject) || request.peerId !== context.peerId) throw new Error("当前用户／对话无此权限申请");
    return request;
  }

  private active(context: PermissionContext): PermissionRequest[] {
    return this.repository.listRequests(context.subject).filter((request) => request.status === "approved" && request.expiresAt > this.now()
      && (request.lifetime === "persistent" || request.sessionId === context.sessionId));
  }

  private effective(context: PermissionContext): PermissionPolicy {
    return this.active(context).reduce((policy, grant) => applyChange(policy, grant.change), basicPolicy());
  }

  private bump(context: PermissionContext, action: string, data: unknown): void {
    const before = this.repository.get(context.subject);
    const persistent = this.repository.listRequests(context.subject).filter((request) => request.status === "approved" && request.lifetime === "persistent")
      .reduce((policy, request) => applyChange(policy, request.change), basicPolicy());
    this.repository.save({ ...before, revision: before.revision + 1, policy: persistent });
    this.repository.recordEvent(context.subject, context.sourceMessageId, action, data);
  }

  private normalize(change: PermissionChange, context: PermissionContext): PermissionChange {
    if (change.kind === "read" || change.kind === "write") {
      const input = change.resource.startsWith("~/") ? resolve(homedir(), change.resource.slice(2)) : change.resource;
      if (!isAbsolute(input)) throw new Error("目录必须是绝对路径或 ~/ 路径");
      const path = realpathSync(input);
      if (!statSync(path).isDirectory()) throw new Error("请授权一个已存在的目录");
      if (this.options.protectedPaths.some((root) => within(path, root))) throw new Error("该目录属于服务控制面；受限模式下不可授权");
      if (this.options.workspaceBase) {
        const base = realpathSync(this.options.workspaceBase);
        const own = resolve(base, subjectKey(context.subject));
        if ((within(path, base) || within(base, path)) && !within(path, own)) throw new Error("目录覆盖其他用户工作区，请选择更具体的目录；宿主机完整访问需要 Full Access");
      }
      return { ...change, resource: path };
    }
    if (change.kind === "network") {
      const host = change.resource.toLowerCase().replace(/\.$/u, "");
      if (host !== "*" && !/^(?:\*\.)?(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/u.test(host)) throw new Error("请提供域名（例如 example.com、*.example.com 或 *），不要包含 URL 路径");
      return { kind: "network", resource: host };
    }
    return change;
  }
}

function applyChange(policy: PermissionPolicy, change: PermissionChange): PermissionPolicy {
  if (change.kind === "full-access") return { ...policy, mode: "full-access" };
  if (change.kind === "shell") return { ...policy, shell: true };
  const key = change.kind === "read" ? "readRoots" : change.kind === "write" ? "writeRoots" : "allowedDomains";
  return { ...policy, [key]: [...new Set([...policy[key], change.resource])] };
}

function describeChange(change: PermissionChange): string {
  if (change.kind === "full-access") return "宿主机全部权限";
  if (change.kind === "shell") return "沙箱内执行命令（文件与网络限制仍生效）";
  return `${change.kind === "read" ? "读取目录" : change.kind === "write" ? "读写目录" : "访问域名"} ${change.resource}`;
}

function lifetimeLabel(lifetime: PermissionLifetime): string {
  return lifetime === "persistent" ? "长期保存，跨会话／重启有效" : lifetime === "session" ? "仅当前会话" : "一次匹配的工具调用，批准后 10 分钟内有效";
}

function within(path: string, root: string): boolean {
  const suffix = relative(resolve(root), resolve(path));
  return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

function matchesOperation(change: PermissionChange, operation: ToolOperation, workspaceRoot: string): boolean {
  if (change.kind === "full-access") return true;
  if (operation.kind === "bash") return true; // a shell can exercise any granted capability
  if (change.kind === "shell") return false;
  if (change.kind === "network") {
    if (operation.kind !== "http") return false;
    const host = new URL(operation.url).hostname.toLowerCase();
    return change.resource === "*" || host === change.resource || (change.resource.startsWith("*.") && host.endsWith(change.resource.slice(1)));
  }
  if (operation.kind === "http") return false;
  if (change.kind === "read" && operation.kind === "write") return false;
  const candidate = resolve(workspaceRoot, operation.path);
  let canonical: string;
  try { canonical = realpathSync(candidate); }
  catch { canonical = candidate; }
  return within(canonical, change.resource);
}

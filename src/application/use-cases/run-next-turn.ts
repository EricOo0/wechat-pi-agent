import { ModelManagementError } from "../../domain/models/model-selection.js";
import { commandHelp } from "../services/command-catalog.js";
import type { ModelManagement } from "./select-model.js";
import type { EndSession } from "./end-session.js";
import type { SaveInboundFiles } from "./save-inbound-files.js";
import { subjectKey } from "../../domain/policy/permissions.js";
import { FileInputError, fileSummary } from "../../domain/files/user-file.js";
import type { Agent } from "../interfaces/agent.js";
import type { Channel } from "../interfaces/channel.js";
import type { ControlPlane } from "../interfaces/control-plane.js";
import { noopTelemetry, type Telemetry } from "../interfaces/telemetry.js";
import type { ReplyChunker } from "../services/reply-chunker.js";
import { CommandRouter } from "../services/command-router.js";
import type { PermissionService } from "../services/permission-service.js";

export interface RunNextTurnOptions {
  ownerId: string;
  leaseMs?: number;
}

export type RunNextTurnResult =
  | { status: "idle" }
  | { status: "completed"; turnId: string; finalResponse: string; chunks: readonly string[] }
  | { status: "failed"; turnId: string; error: Error };

export class RunNextTurn {
  private readonly leaseMs: number;

  public constructor(
    private readonly controlPlane: ControlPlane,
    private readonly agent: Agent,
    private readonly channel: Channel,
    private readonly replyChunker: ReplyChunker,
    private readonly options: RunNextTurnOptions,
    private readonly telemetry: Telemetry = noopTelemetry,
    private readonly commandRouter: CommandRouter = new CommandRouter(),
    private readonly permissions?: PermissionService,
    private readonly saveFiles?: SaveInboundFiles,
    private readonly endSession?: EndSession,
    private readonly modelManagement?: ModelManagement,
  ) {
    this.leaseMs = options.leaseMs ?? 60_000;
  }

  public async execute(signal: AbortSignal = new AbortController().signal): Promise<RunNextTurnResult> {
    const claimed = this.controlPlane.claimNextTurn(this.options.ownerId, this.leaseMs);
    if (claimed === undefined) {
      return { status: "idle" };
    }

    const { turn, session, message } = claimed;
    const startedAt = Date.now();
    if (claimed.continuation && (session.status !== "ACTIVE" || !this.permissions?.canContinue(message, session.id,
      claimed.continuation.permissionRequestId, claimed.continuation.sourceTurnId))) {
      const finalResponse = "自动续跑已取消：授权已失效或原会话已结束。";
      const chunks = this.replyChunker.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }
    const permissionReply = claimed.continuation ? undefined : this.permissions?.handleMessage(message, session.id);
    if (permissionReply !== undefined) {
      const continuation = session.status === "ACTIVE" ? this.permissions?.continuationFor(message, session.id) : undefined;
      const chunks = this.replyChunker.chunk(permissionReply);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse: permissionReply, chunks,
        ...(continuation === undefined ? {} : { continuation }) });
      return { status: "completed", turnId: turn.id, finalResponse: permissionReply, chunks };
    }
    const parsedCommand = this.commandRouter.route(message.text);
    const routed = parsedCommand.type === "management" && (message.files?.length || message.images?.length)
      ? { type: "message" as const, text: message.text } : parsedCommand;
    if (routed.type === "management" && this.modelManagement) {
      const owner = this.permissions ? subjectKey(this.permissions.context(message, session.id, turn.id).subject) : message.senderId;
      const finalResponse = await this.modelManagement.execute(owner, routed.command);
      this.controlPlane.appendAgentEvent(turn.id, { type: "model_management", at: new Date(), data: { command: routed.command.type, response: finalResponse, status: "completed" } });
      const chunks = this.replyChunker.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }
    if (routed.type === "management") {
      const finalResponse = routed.command.type === "help" ? commandHelp(routed.command.name)
        : "模型管理功能尚未开启，请在运行 Agent 的电脑设置 MODEL_MANAGEMENT_ENABLED=true 并重启服务。";
      const chunks = this.replyChunker.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }
    if (routed.type === "new" || routed.type === "status") {
      const finalResponse = routed.type === "new"
        ? "已归档当前会话，下一条消息将创建新的上下文。"
        : `状态正常。session=${session.id} turn=${turn.id}`;
      if (routed.type === "new") {
        if (this.endSession) this.endSession.execute(session.id,"manual",{currentTurnId:turn.id});
        else {
          if (this.permissions) this.permissions.endSession(this.permissions.context(message, session.id));
          this.controlPlane.archiveActiveSession(message.accountId, message.peerId);
        }
      }
      const chunks = this.replyChunker.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      this.telemetry.increment("turns_completed", { kind: "command" });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }

    await this.setTyping(message.accountId, message.peerId, true, signal);

    try {
      const permissionContext = this.permissions?.context(message, session.id, turn.id);
      const saved = message.files?.length && this.saveFiles && permissionContext
        ? await this.saveFiles.execute(subjectKey(permissionContext.subject), message, event => this.controlPlane.appendAgentEvent(turn.id, event), signal) : undefined;
      if (saved && !message.text.trim() && !message.images?.length) {
        const contextEvent = {
          id: `file_receipt:${turn.id}`, kind: "file_receipt" as const, at: turn.queuedAt.toISOString(),
          content: JSON.stringify({ at: turn.queuedAt.toISOString(), userAction: "uploaded_files", files: saved.files.map(file => ({
            fileId: file.id, name: file.name, status: file.status, bytes: file.bytes, mimeType: file.mimeType,
            ...(file.errorCode ? { errorCode: file.errorCode } : {}),
          })), applicationReply: saved.receipt }),
        };
        try {
          await this.agent.recordContext({ session, contextEvents: [contextEvent],
            ...(permissionContext === undefined ? {} : { permissionContext }), signal,
            onSessionReady: (id, path) => this.controlPlane.updateSessionPiLocator(session.id, id, path),
            onEvent: event => this.controlPlane.appendAgentEvent(turn.id, event),
          });
        } catch (error) {
          if (signal.aborted) throw error;
          this.controlPlane.appendAgentEvent(turn.id, { type: "context_update", at: new Date(), data: { status: "failed", input: [contextEvent], error: "Immediate context update failed; the durable receipt will be replayed on the next model turn." } });
        }
        const chunks = this.replyChunker.chunk(saved.receipt);
        this.controlPlane.completeTurn({ turnId: turn.id, finalResponse: saved.receipt, chunks });
        return { status: "completed", turnId: turn.id, finalResponse: saved.receipt, chunks };
      }
      const result = await this.agent.runTurn({
        session,
        ...(permissionContext === undefined ? {} : { contextEvents: this.controlPlane.getSessionContextEvents(turn.id, subjectKey(permissionContext.subject)) }),
        prompt: routed.text + (saved ? `\n\n文件保存结果：\n${saved.receipt}` : ""),
        ...(saved === undefined ? {} : { files: saved.files.map(fileSummary) }),
        ...(this.permissions === undefined ? {} : { permissionContext: this.permissions.context(message, session.id, turn.id) }),
        ...(message.images === undefined ? {} : { images: message.images }),
        signal,
        onInvocation: (trace) => this.controlPlane.recordAgentInvocation(turn.id, trace),
        onSessionReady: (id, file) => this.controlPlane.updateSessionPiLocator(session.id, id, file),
        onEvent: (event) => this.controlPlane.appendAgentEvent(turn.id, event),
      });
      const chunks = this.replyChunker.chunk(result.text);
      const completion = {
        turnId: turn.id,
        finalResponse: result.text,
        chunks,
        ...(result.piSessionId === undefined ? {} : { piSessionId: result.piSessionId }),
        ...(result.piSessionFile === undefined ? {} : { piSessionFile: result.piSessionFile }),
      };
      this.controlPlane.completeTurn(completion);
      this.telemetry.increment("turns_completed", { kind: "agent" });
      this.telemetry.observe("turn_duration_ms", Date.now() - startedAt);
      return { status: "completed", turnId: turn.id, finalResponse: result.text, chunks };
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (error instanceof ModelManagementError) {
        this.controlPlane.appendAgentEvent(turn.id, { type: "model_management", at: new Date(), data: { status: "failed", code: error.code, response: error.message } });
        const chunks = this.replyChunker.chunk(error.message);
        this.controlPlane.completeTurn({ turnId: turn.id, finalResponse: error.message, chunks });
        return { status: "completed", turnId: turn.id, finalResponse: error.message, chunks };
      }
      if (error instanceof FileInputError) {
        this.controlPlane.appendAgentEvent(turn.id, { type: "file_error", at: new Date(), data: { status: "failed", errorCode: error.code, message: error.message } });
        const chunks = this.replyChunker.chunk(error.message);
        this.controlPlane.completeTurn({ turnId: turn.id, finalResponse: error.message, chunks });
        return { status: "completed", turnId: turn.id, finalResponse: error.message, chunks };
      }
      this.controlPlane.failTurn({
        turnId: turn.id,
        errorCode: this.errorCode(error),
        errorMessage: error.message,
      });
      this.telemetry.increment("turns_failed", { error_code: this.errorCode(error) });
      return { status: "failed", turnId: turn.id, error };
    } finally {
      await this.setTyping(message.accountId, message.peerId, false, signal);
    }
  }

  private async setTyping(accountId: string, peerId: string, active: boolean, signal: AbortSignal): Promise<void> {
    try {
      await this.channel.setTyping?.(accountId, peerId, active, signal);
    } catch {
      this.telemetry.increment("typing_updates_failed", { active: String(active) });
    }
  }

  private errorCode(error: Error): string {
    if (error.name === "AbortError") {
      return "ABORTED";
    }
    return "AGENT_RUN_FAILED";
  }
}

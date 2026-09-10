import type { TaskManager } from "../../../tasks/index.js";
import type { AgentRunRequest } from "../../../../runtime/agent/index.js";
import { ReplyPresentation } from "../../../messaging/index.js";
import type { ClaimedTurn } from "../../domain/turn.js";
import { ModelManagementError } from "../../../models/index.js";
import { commandHelp } from "../../../models/index.js";
import type { ModelManagement } from "../../../models/index.js";
import type { EndSession } from "../../../conversation/index.js";
import type { SaveInboundFiles } from "../../../artifacts/index.js";
import { subjectKey } from "../../../permissions/index.js";
import { FileInputError, fileSummary } from "../../../artifacts/index.js";
import type { Agent } from "../../../../runtime/agent/ports/agent.js";
import type { Channel } from "../../../messaging/index.js";
import type { TurnExecutionStore } from "../../ports/turn-store.js";
import { noopTelemetry, type Telemetry } from "../../../observability/index.js";
import type { ReplyChunker } from "../../../messaging/index.js";
import { CommandRouter } from "../../../messaging/index.js";
import type { PermissionService } from "../../../permissions/index.js";

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
  private readonly presentation: ReplyPresentation;

  public constructor(
    private readonly controlPlane: TurnExecutionStore,
    private readonly agent: Agent,
    channel: Channel,
    replyChunker: ReplyChunker,
    private readonly options: RunNextTurnOptions,
    private readonly telemetry: Telemetry = noopTelemetry,
    private readonly commandRouter: CommandRouter = new CommandRouter(),
    private readonly permissions?: PermissionService,
    private readonly saveFiles?: SaveInboundFiles,
    private readonly endSession?: EndSession,
    private readonly modelManagement?: ModelManagement,
    private readonly tasks?: TaskManager,
  ) {
    this.leaseMs = options.leaseMs ?? 60_000;
    this.presentation = new ReplyPresentation(channel, replyChunker, telemetry);
  }

  public async execute(signal: AbortSignal = new AbortController().signal): Promise<RunNextTurnResult> {
    const claimed = this.controlPlane.claimNextTurn(this.options.ownerId, this.leaseMs);
    if (claimed === undefined) {
      return { status: "idle" };
    }

    const { turn, session, message } = claimed;
    const startedAt = Date.now();
    let typing = false;
    try {
      signal.throwIfAborted();
      const controlResult = await this.handleControl(claimed);
      if (controlResult) return controlResult;
      const permissionContext = this.permissions?.context(message, session.id, turn.id);
      typing = true;
      await this.setTyping(message.accountId, message.peerId, true, signal);
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
        const continueExistingTask = this.tasks && turn.taskId && permissionContext
          ? this.tasks.shouldExecuteUploadedFile(claimed, subjectKey(permissionContext.subject)) : false;
        if (!continueExistingTask) {
        const chunks = this.presentation.chunk(saved.receipt);
        const taskResult = this.tasks && turn.taskId && permissionContext ? this.tasks.upload(claimed, subjectKey(permissionContext.subject), saved.receipt) : undefined;
        this.controlPlane.completeTurn({ turnId: turn.id, finalResponse: saved.receipt, chunks, ...(taskResult?.settlement ? { taskSettlement: taskResult.settlement } : {}) });
        return { status: "completed", turnId: turn.id, finalResponse: saved.receipt, chunks };
        }
      }
      const agentRequest: AgentRunRequest = {
        session,
        ...(permissionContext === undefined ? {} : { contextEvents: this.controlPlane.getSessionContextEvents(turn.id, subjectKey(permissionContext.subject)) }),
        prompt: message.text + (saved ? `\n\n文件保存结果：\n${saved.receipt}` : ""),
        ...(saved === undefined ? {} : { files: saved.files.map(fileSummary) }),
        ...(this.permissions === undefined ? {} : { permissionContext: this.permissions.context(message, session.id, turn.id) }),
        ...(message.images === undefined ? {} : { images: message.images }),
        signal,
        onInvocation: (trace) => this.controlPlane.recordAgentInvocation(turn.id, trace),
        onSessionReady: (id, file) => this.controlPlane.updateSessionPiLocator(session.id, id, file),
        onEvent: (event) => this.controlPlane.appendAgentEvent(turn.id, event),
      };
      const taskResult = this.tasks && turn.taskId ? await this.tasks.execute(claimed, agentRequest, this.agent) : undefined;
      const agentResult = taskResult ?? await this.agent.runTurn(agentRequest);
      const chunks = taskResult?.publish === false ? [] : this.presentation.chunk(agentResult.text);
      const completion = {
        turnId: turn.id,
        finalResponse: agentResult.text,
        chunks,
        imageIds: taskResult?.publish ? taskResult.replyImages ?? [] : [],
        ...(taskResult?.settlement ? { taskSettlement: taskResult.settlement } : {}),
        ...(agentResult.piSessionId === undefined ? {} : { piSessionId: agentResult.piSessionId }),
        ...(agentResult.piSessionFile === undefined ? {} : { piSessionFile: agentResult.piSessionFile }),
      };
      this.controlPlane.completeTurn(completion);
      this.telemetry.increment("turns_completed", { kind: "agent" });
      this.telemetry.observe("turn_duration_ms", Date.now() - startedAt);
      return { status: "completed", turnId: turn.id, finalResponse: agentResult.text, chunks };
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (error instanceof ModelManagementError) {
        this.controlPlane.appendAgentEvent(turn.id, { type: "model_management", at: new Date(), data: { status: "failed", code: error.code, response: error.message } });
        const chunks = this.presentation.chunk(error.message);
        this.controlPlane.completeTurn({ turnId: turn.id, finalResponse: error.message, chunks });
        return { status: "completed", turnId: turn.id, finalResponse: error.message, chunks };
      }
      if (error instanceof FileInputError) {
        this.controlPlane.appendAgentEvent(turn.id, { type: "file_error", at: new Date(), data: { status: "failed", errorCode: error.code, message: error.message } });
        const chunks = this.presentation.chunk(error.message);
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
      if (typing) await this.setTyping(message.accountId, message.peerId, false, signal);
    }
  }

  private async handleControl(claimed: ClaimedTurn): Promise<RunNextTurnResult | undefined> {
    const { turn, session, message } = claimed;
    const taskReply = this.tasks?.handleMessage(message, session.id);
    if (taskReply !== undefined) {
      const chunks = this.presentation.chunk(taskReply);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse: taskReply, chunks });
      return { status: 'completed', turnId: turn.id, finalResponse: taskReply, chunks };
    }
    if (claimed.continuation && (session.status !== "ACTIVE" || !this.permissions?.canContinue(message, session.id,
      claimed.continuation.permissionRequestId, claimed.continuation.sourceTurnId))) {
      const finalResponse = "自动续跑已取消：授权已失效或原会话已结束。";
      const chunks = this.presentation.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }
    const permissionReply = claimed.continuation ? undefined : this.permissions?.handleMessage(message, session.id);
    if (permissionReply !== undefined) {
      const continuation = session.status === "ACTIVE" ? this.permissions?.continuationFor(message, session.id) : undefined;
      const chunks = this.presentation.chunk(permissionReply);
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
      const chunks = this.presentation.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }
    if (routed.type === "management") {
      const finalResponse = routed.command.type === "help" ? commandHelp(routed.command.name)
        : "模型管理功能尚未开启，请在运行 Agent 的电脑设置 MODEL_MANAGEMENT_ENABLED=true 并重启服务。";
      const chunks = this.presentation.chunk(finalResponse);
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
      const chunks = this.presentation.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      this.telemetry.increment("turns_completed", { kind: "command" });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }

    return undefined;
  }

  private async setTyping(accountId: string, peerId: string, active: boolean, signal: AbortSignal): Promise<void> {
    await this.presentation.setTyping(accountId, peerId, active, signal);
  }

  private errorCode(error: Error): string {
    if (error.name === "AbortError") {
      return "ABORTED";
    }
    return "AGENT_RUN_FAILED";
  }
}

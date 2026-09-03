import type { AgentPort } from "../ports/agent.port.js";
import type { ChannelPort } from "../ports/channel.port.js";
import type { ControlPlanePort } from "../ports/control-plane.port.js";
import { noopTelemetry, type TelemetryPort } from "../ports/telemetry.port.js";
import type { ReplyChunker } from "../services/reply-chunker.js";
import { CommandRouter } from "../services/command-router.js";

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
    private readonly controlPlane: ControlPlanePort,
    private readonly agent: AgentPort,
    private readonly channel: ChannelPort,
    private readonly replyChunker: ReplyChunker,
    private readonly options: RunNextTurnOptions,
    private readonly telemetry: TelemetryPort = noopTelemetry,
    private readonly commandRouter: CommandRouter = new CommandRouter(),
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
    const routed = this.commandRouter.route(message.text);
    if (routed.type !== "message") {
      const finalResponse = routed.type === "new"
        ? "已归档当前会话，下一条消息将创建新的上下文。"
        : `状态正常。session=${session.id} turn=${turn.id}`;
      if (routed.type === "new") this.controlPlane.archiveActiveSession(message.accountId, message.peerId);
      const chunks = this.replyChunker.chunk(finalResponse);
      this.controlPlane.completeTurn({ turnId: turn.id, finalResponse, chunks });
      this.telemetry.increment("turns_completed", { kind: "command" });
      return { status: "completed", turnId: turn.id, finalResponse, chunks };
    }

    await this.setTyping(message.accountId, message.peerId, true, signal);

    try {
      const result = await this.agent.runTurn({
        session,
        prompt: routed.text,
        ...(message.images === undefined ? {} : { images: message.images }),
        signal,
        onInvocation: (trace) => this.controlPlane.recordAgentInvocation(turn.id, trace),
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

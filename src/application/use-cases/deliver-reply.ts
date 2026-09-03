import type { ChannelPort } from "../ports/channel.port.js";
import type { ControlPlanePort } from "../ports/control-plane.port.js";
import { noopTelemetry, type TelemetryPort } from "../ports/telemetry.port.js";
import { systemClock, type Clock } from "../../shared/clock.js";

export interface DeliverReplyOptions {
  ownerId: string;
  leaseMs?: number;
  maxAttempts?: number;
  retryDelaysMs?: readonly number[];
}

export type DeliverReplyResult =
  | { status: "idle" }
  | { status: "sent"; outboxId: string; remoteRequestId?: string }
  | { status: "retry_scheduled"; outboxId: string; retryAt: Date; error: Error };

export class DeliverReply {
  private readonly leaseMs: number;
  private readonly maxAttempts: number;
  private readonly retryDelaysMs: readonly number[];

  public constructor(
    private readonly controlPlane: ControlPlanePort,
    private readonly channel: ChannelPort,
    private readonly options: DeliverReplyOptions,
    private readonly clock: Clock = systemClock,
    private readonly telemetry: TelemetryPort = noopTelemetry,
  ) {
    this.leaseMs = options.leaseMs ?? 30_000;
    this.maxAttempts = options.maxAttempts ?? 5;
    this.retryDelaysMs = options.retryDelaysMs ?? [1_000, 3_000, 10_000, 30_000];
    if (this.retryDelaysMs.length === 0 || this.retryDelaysMs.some((delay) => delay < 0 || !Number.isFinite(delay))) {
      throw new RangeError("retryDelaysMs must contain finite non-negative delays");
    }
  }

  public async execute(signal: AbortSignal = new AbortController().signal): Promise<DeliverReplyResult> {
    const claimed = this.controlPlane.claimNextOutbox(this.options.ownerId, this.leaseMs);
    if (claimed === undefined) {
      return { status: "idle" };
    }

    try {
      const sent = await this.channel.sendText(claimed.message, signal);
      this.controlPlane.markOutboxSent(claimed.message.id, sent.remoteRequestId);
      this.telemetry.increment("outbox_messages_sent");
      return sent.remoteRequestId === undefined
        ? { status: "sent", outboxId: claimed.message.id }
        : { status: "sent", outboxId: claimed.message.id, remoteRequestId: sent.remoteRequestId };
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      const delayIndex = Math.min(Math.max(0, claimed.attemptNo - 1), this.retryDelaysMs.length - 1);
      const delayMs = this.retryDelaysMs[delayIndex] ?? 0;
      const retryAt = new Date(this.clock.now().getTime() + delayMs);
      this.controlPlane.markOutboxFailed(claimed.message.id, error, retryAt, this.maxAttempts);
      this.telemetry.increment("outbox_messages_failed");
      return { status: "retry_scheduled", outboxId: claimed.message.id, retryAt, error };
    }
  }
}

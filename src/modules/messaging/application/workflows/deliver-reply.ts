import type { Channel } from "../../ports/channel.js";
import type { DeliveryStore } from "../../ports/delivery-store.js";
import { noopTelemetry, type Telemetry } from "../../../observability/index.js";
import { systemClock, type Clock } from "../../../../shared/clock.js";

export interface DeliverReplyOptions {
  ownerId: string;
  loadImage?: (artifactId: string) => Promise<{ data: Buffer; mimeType: "image/png" | "image/jpeg" }>;
  onImageEvent?: (turnId: string, data: { artifactId: string; outboxId: string; eventId: string; stage: string; status: string }) => void;
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
    private readonly controlPlane: DeliveryStore,
    private readonly channel: Channel,
    private readonly options: DeliverReplyOptions,
    private readonly clock: Clock = systemClock,
    private readonly telemetry: Telemetry = noopTelemetry,
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

    const lease = { ownerId: this.options.ownerId, attemptNo: claimed.attemptNo };
    const controller = new AbortController();
    const workSignal = AbortSignal.any([signal, controller.signal]);
    let lost = false;
    const renew = () => {
      try {
        if (this.controlPlane.renewOutboxLease && !this.controlPlane.renewOutboxLease(claimed.message.id, lease, this.leaseMs)) { lost = true; controller.abort(new Error("Outbox lease lost")); }
      } catch { lost = true; controller.abort(new Error("Outbox lease renewal failed")); }
    };
    const heartbeat = setInterval(renew, Math.max(10, Math.floor(this.leaseMs / 3)));
    const check = () => { workSignal.throwIfAborted(); renew(); workSignal.throwIfAborted(); };
    let currentStage = "load";
    const event = (stage: string, status: string) => {
      if (claimed.message.artifactId) this.options.onImageEvent?.(claimed.message.turnId, { artifactId: claimed.message.artifactId, outboxId: claimed.message.id, eventId: `${claimed.message.id}:${claimed.attemptNo}:${stage}`, stage, status });
    };
    try {
      check();
      let sent: { remoteRequestId?: string };
      if (claimed.message.artifactId) {
        if (!this.channel.prepareImage || !this.channel.sendPreparedImage || !this.channel.imageCredentialScope || !this.options.loadImage || !this.controlPlane.savePreparedImage) throw new Error("Image delivery unavailable on this channel");
        const scope = this.channel.imageCredentialScope();
        let prepared = this.controlPlane.getPreparedImage?.(claimed.message.id, scope);
        if (!prepared) {
          currentStage = "upload";
          event("upload", "started");
          const image = await this.options.loadImage(claimed.message.artifactId);
          check();
          prepared = await this.channel.prepareImage( claimed.message, image, workSignal);
          check();
          this.controlPlane.savePreparedImage(claimed.message.id, scope, prepared, lease);
          event("upload", "succeeded");
        }
        check();
        currentStage = "send";
        event("send", "started");
        sent = await this.channel.sendPreparedImage( claimed.message, prepared, workSignal);
      } else sent = await this.channel.sendText(claimed.message, workSignal);
      check();
      this.controlPlane.markOutboxSent(claimed.message.id, sent.remoteRequestId, lease);
      event("send", "succeeded");
      this.telemetry.increment("outbox_messages_sent");
      return sent.remoteRequestId === undefined
        ? { status: "sent", outboxId: claimed.message.id }
        : { status: "sent", outboxId: claimed.message.id, remoteRequestId: sent.remoteRequestId };
    } catch (cause: unknown) {
      const error = cause instanceof Error ? cause : new Error(String(cause));
      if (lost) throw error; // Never let a stale worker settle another owner's attempt.
      const delayIndex = Math.min(Math.max(0, claimed.attemptNo - 1), this.retryDelaysMs.length - 1);
      const delayMs = this.retryDelaysMs[delayIndex] ?? 0;
      const retryAt = new Date(this.clock.now().getTime() + delayMs);
      this.controlPlane.markOutboxFailed(claimed.message.id, error, retryAt, this.maxAttempts, lease);
      event(currentStage, "failed");
      this.telemetry.increment("outbox_messages_failed");
      return { status: "retry_scheduled", outboxId: claimed.message.id, retryAt, error };
    } finally { clearInterval(heartbeat); }
  }
}

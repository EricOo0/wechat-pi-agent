import type { ControlPlanePort } from "../ports/control-plane.port.js";
import { noopTelemetry, type TelemetryPort } from "../ports/telemetry.port.js";
import type { InboundBatch } from "../../domain/messaging/inbound-message.js";
import type { SenderPolicy } from "../../domain/policy/sender-policy.js";

export interface IngestMessageResult {
  inserted: number;
  rejected: number;
}

export class IngestMessage {
  public constructor(
    private readonly controlPlane: ControlPlanePort,
    private readonly senderPolicy: SenderPolicy,
    private readonly telemetry: TelemetryPort = noopTelemetry,
  ) {}

  public execute(batch: InboundBatch): IngestMessageResult {
    const acceptedMessages = batch.messages.filter((message) => this.senderPolicy.allows(message));
    const policyRejected = batch.messages.length - acceptedMessages.length;
    const result = this.controlPlane.ingestBatch({ ...batch, messages: acceptedMessages });
    const rejected = policyRejected + result.rejected;

    this.telemetry.increment("inbound_messages_inserted", undefined, result.inserted);
    this.telemetry.increment("inbound_messages_rejected", undefined, rejected);

    return { inserted: result.inserted, rejected };
  }
}

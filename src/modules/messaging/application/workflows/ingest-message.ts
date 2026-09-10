import type { MessageStore } from "../../ports/message-store.js";
import { noopTelemetry, type Telemetry } from "../../../observability/index.js";
import type { InboundBatch } from "../../domain/inbound-message.js";
import type { SenderPolicy } from "../../domain/sender-policy.js";
import type { PermissionService } from "../../../permissions/index.js";
import { CommandRouter } from "../command-router.js";

export interface IngestMessageResult {
  inserted: number;
  rejected: number;
}

export class IngestMessage {
  public constructor(
    private readonly controlPlane: MessageStore,
    private readonly senderPolicy: SenderPolicy,
    private readonly telemetry: Telemetry = noopTelemetry,
    private readonly permissions?: PermissionService,
  ) {}

  public execute(batch: InboundBatch): IngestMessageResult {
    const acceptedMessages = batch.messages.filter((message) => this.senderPolicy.allows(message));
    const policyRejected = batch.messages.length - acceptedMessages.length;
    const result = this.controlPlane.ingestBatch({ ...batch, messages: acceptedMessages });
    // Apply authenticated permission controls on ingress, even while a model turn is running.
    // The durable receipt makes processing the same message again in RunNextTurn idempotent.
    for (const message of acceptedMessages) {
      const sessionId = this.controlPlane.getMessageSession(message.accountId, message.channelMessageId);
      const persisted = this.controlPlane.getPersistedMessage(message.accountId, message.channelMessageId);
      if (sessionId !== undefined && persisted !== undefined && this.senderPolicy.allows(persisted)) {
        this.permissions?.handleMessage(persisted, sessionId);
        if (this.permissions && new CommandRouter().route(persisted.text).type === "new") {
          this.permissions.endSession(this.permissions.context(persisted, sessionId));
        }
      }
    }
    const rejected = policyRejected + result.rejected;

    this.telemetry.increment("inbound_messages_inserted", undefined, result.inserted);
    this.telemetry.increment("inbound_messages_rejected", undefined, rejected);

    return { inserted: result.inserted, rejected };
  }
}

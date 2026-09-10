import type { OutboundMessage } from "./outbound-message.js";

export type OutboxStatus = "PENDING" | "SENDING" | "SENT" | "RETRY_WAIT" | "DEAD_LETTER";

export interface OutboxRecord extends OutboundMessage {
  status: OutboxStatus;
  attemptCount: number;
  nextAttemptAt: Date;
  createdAt: Date;
}

export interface ClaimedOutbox {
  message: OutboxRecord;
  attemptNo: number;
}

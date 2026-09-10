import type { OutboxLease, PreparedImage } from "../domain/outbound-message.js";
import type { ClaimedOutbox } from "../domain/outbox-message.js";
export interface DeliveryStore {
  claimNextOutbox(ownerId: string, leaseMs: number): ClaimedOutbox | undefined;
  markOutboxSent(outboxId: string, remoteRequestId?: string, lease?: OutboxLease): void;
  markOutboxFailed(outboxId: string, error: Error, retryAt: Date, maxAttempts: number, lease?: OutboxLease): void;
  renewOutboxLease?(id: string, lease: OutboxLease, leaseMs: number): boolean;
  getPreparedImage?(id: string, scope: string): PreparedImage | undefined;
  savePreparedImage?(id: string, scope: string, image: PreparedImage, lease: OutboxLease): void;
}

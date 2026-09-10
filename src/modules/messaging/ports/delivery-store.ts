import type { ClaimedOutbox } from "../domain/outbox-message.js";
export interface DeliveryStore {
  claimNextOutbox(ownerId: string, leaseMs: number): ClaimedOutbox | undefined;
  markOutboxSent(outboxId: string, remoteRequestId?: string): void;
  markOutboxFailed(outboxId: string, error: Error, retryAt: Date, maxAttempts: number): void;
}

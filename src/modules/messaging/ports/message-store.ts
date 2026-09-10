import type { InboundBatch, InboundMessage } from "../domain/inbound-message.js";
export interface MessageStore {
  getCursor(accountId: string): string;
  ingestBatch(batch: InboundBatch): { inserted: number; rejected: number };
  getMessageSession(accountId: string, channelMessageId: string): string | undefined;
  getPersistedMessage(accountId: string, channelMessageId: string): InboundMessage | undefined;
}

import type { InboundBatch } from "../../domain/messaging/inbound-message.js";
import type { OutboundMessage } from "../../domain/messaging/outbound-message.js";

export interface ChannelPort {
  getUpdates(accountId: string, cursor: string, signal: AbortSignal): Promise<InboundBatch>;
  sendText(message: OutboundMessage, signal: AbortSignal): Promise<{ remoteRequestId?: string }>;
  setTyping?(accountId: string, peerId: string, active: boolean, signal: AbortSignal): Promise<void>;
  checkReady(): Promise<{ ready: boolean; reason?: string }>;
}

import type { InboundBatch } from "../domain/inbound-message.js";
import type { OutboundMessage, PreparedImage } from "../domain/outbound-message.js";

export interface Channel {
  getUpdates(accountId: string, cursor: string, signal: AbortSignal): Promise<InboundBatch>;
  sendText(message: OutboundMessage, signal: AbortSignal): Promise<{ remoteRequestId?: string }>;
  prepareImage?(message: OutboundMessage, image: { data: Buffer; mimeType: "image/png" | "image/jpeg" }, signal: AbortSignal): Promise<PreparedImage>;
  sendPreparedImage?(message: OutboundMessage, image: PreparedImage, signal: AbortSignal): Promise<{ remoteRequestId?: string }>;
  imageCredentialScope?(): string;
  setTyping?(accountId: string, peerId: string, active: boolean, signal: AbortSignal): Promise<void>;
  checkReady(): Promise<{ ready: boolean; reason?: string }>;
}

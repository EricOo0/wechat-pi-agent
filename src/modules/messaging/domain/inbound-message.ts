import type { InboundFileReference } from "../../artifacts/index.js";
export interface InboundImage {
  path: string;
  mimeType: "image/jpeg" | "image/png" | "image/gif" | "image/webp";
  bytes: number;
}

export interface InboundMessage {
  id: string;
  accountId: string;
  channelMessageId: string;
  peerId: string;
  senderId: string;
  sequence?: number;
  contextToken?: string;
  text: string;
  images?: readonly InboundImage[];
  files?: readonly InboundFileReference[];
  receivedAt: Date;
  raw?: unknown;
}

export interface InboundBatch {
  accountId: string;
  previousCursor: string;
  nextCursor: string;
  messages: readonly InboundMessage[];
}

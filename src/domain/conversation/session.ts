export type SessionStatus = "ACTIVE" | "ARCHIVED" | "CORRUPTED";

export interface ConversationSession {
  id: string;
  key: string;
  accountId: string;
  peerId: string;
  piSessionId?: string;
  piSessionFile?: string;
  status: SessionStatus;
  createdAt: Date;
  updatedAt: Date;
}

export function sessionKey(accountId: string, peerId: string): string {
  return `weixin:${accountId}:${peerId}`;
}

import type { ConversationSession, SessionEndReason } from "../../domain/conversation/session.js";
import type { InboundMessage } from "../../domain/messaging/inbound-message.js";
export type { SessionEndReason } from "../../domain/conversation/session.js";
export interface EndSessionInput { sessionId: string; ownerId: string; reason: SessionEndReason; now: Date; idleMs?: number; currentTurnId?: string }
export interface SessionLifecycleRepository {
  listActiveSessions(): ConversationSession[];
  sessionMessage(sessionId: string): InboundMessage | undefined;
  endSession(input: EndSessionInput): boolean;
  pendingSessionCleanup(): string[];
  markSessionCleaned(sessionId: string): void;
}

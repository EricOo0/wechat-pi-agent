import type { ConversationSession, SessionEndReason } from "../domain/session.js";
import type { InboundMessage } from "../../messaging/index.js";
export type { SessionEndReason } from "../domain/session.js";
export interface EndSessionInput { sessionId: string; ownerId: string; reason: SessionEndReason; now: Date; idleMs?: number; currentTurnId?: string }
export interface SessionLifecycleRepository {
  listActiveSessions(): ConversationSession[];
  sessionMessage(sessionId: string): InboundMessage | undefined;
  endSession(input: EndSessionInput): boolean;
  pendingSessionCleanup(): string[];
  markSessionCleaned(sessionId: string): void;
}

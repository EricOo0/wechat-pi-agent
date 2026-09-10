import type { ConversationContextEvent } from "../domain/context-event.js";
import type { ConversationSession } from "../domain/session.js";
export interface ConversationContextStore {
  updateSessionPiLocator(sessionId: string, piSessionId?: string, piSessionFile?: string): void;
  archiveActiveSession(accountId: string, peerId: string): ConversationSession | undefined;
  getSessionContextEvents(beforeTurnId: string, ownerId: string): ConversationContextEvent[];
}

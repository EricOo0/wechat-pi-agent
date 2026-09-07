import type { ConversationContextEvent } from "../../domain/conversation/context-event.js";
import type { InboundBatch, InboundMessage } from "../../domain/messaging/inbound-message.js";
import type { ClaimedTurn } from "../../domain/execution/turn.js";
import type { AgentEvent } from "../../domain/execution/step.js";
import type { ClaimedOutbox } from "../../domain/delivery/outbox-message.js";
import type { ConversationSession } from "../../domain/conversation/session.js";
import type { AgentInvocationTrace } from "./agent.js";

export interface CompleteTurnInput {
  turnId: string;
  finalResponse: string;
  chunks: readonly string[];
  piSessionId?: string;
  piSessionFile?: string;
  continuation?: { permissionRequestId: string; sourceTurnId: string };
}

export interface FailTurnInput {
  turnId: string;
  errorCode: string;
  errorMessage: string;
}

export interface ControlPlane {
  migrate(): void;
  healthCheck(): { ready: boolean; reason?: string };
  getCursor(accountId: string): string;
  ingestBatch(batch: InboundBatch): { inserted: number; rejected: number };
  getMessageSession(accountId: string, channelMessageId: string): string | undefined;
  getPersistedMessage(accountId: string, channelMessageId: string): InboundMessage | undefined;
  claimNextTurn(ownerId: string, leaseMs: number): ClaimedTurn | undefined;
  appendAgentEvent(turnId: string, event: AgentEvent): void;
  recordAgentInvocation(turnId: string, trace: AgentInvocationTrace): void;
  completeTurn(input: CompleteTurnInput): void;
  failTurn(input: FailTurnInput): void;
  updateSessionPiLocator(sessionId: string, piSessionId?: string, piSessionFile?: string): void;
  claimNextOutbox(ownerId: string, leaseMs: number): ClaimedOutbox | undefined;
  markOutboxSent(outboxId: string, remoteRequestId?: string): void;
  markOutboxFailed(outboxId: string, error: Error, retryAt: Date, maxAttempts: number): void;
  recoverInterrupted(now: Date): { turns: number; outbox: number };
  archiveActiveSession(accountId: string, peerId: string): ConversationSession | undefined;
  getTurnDetails(turnId: string): unknown;
  getSessionContextEvents(beforeTurnId: string, ownerId: string): ConversationContextEvent[];
  getAgentTrace(turnId: string): unknown;
  getRecentAgentTraces(limit: number): readonly unknown[];
  getRecentErrors(limit: number): readonly unknown[];
  close(): void;
}

import type { InboundBatch } from "../../domain/messaging/inbound-message.js";
import type { ClaimedTurn } from "../../domain/execution/turn.js";
import type { AgentEvent } from "../../domain/execution/step.js";
import type { ClaimedOutbox } from "../../domain/delivery/outbox-message.js";
import type { ConversationSession } from "../../domain/conversation/session.js";
import type { AgentInvocationTrace } from "./agent.port.js";

export interface CompleteTurnInput {
  turnId: string;
  finalResponse: string;
  chunks: readonly string[];
  piSessionId?: string;
  piSessionFile?: string;
}

export interface FailTurnInput {
  turnId: string;
  errorCode: string;
  errorMessage: string;
}

export interface ControlPlanePort {
  migrate(): void;
  healthCheck(): { ready: boolean; reason?: string };
  getCursor(accountId: string): string;
  ingestBatch(batch: InboundBatch): { inserted: number; rejected: number };
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
  getAgentTrace(turnId: string): unknown;
  getRecentAgentTraces(limit: number): readonly unknown[];
  getRecentErrors(limit: number): readonly unknown[];
  close(): void;
}

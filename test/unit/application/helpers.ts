import { vi } from "vitest";
import type { ControlPlane } from "../../../src/adapters/sqlite/control-plane.js";
import type { ClaimedTurn } from "../../../src/modules/turns/domain/turn.js";
import type { ClaimedOutbox } from "../../../src/modules/messaging/domain/outbox-message.js";
import type { InboundBatch, InboundMessage } from "../../../src/modules/messaging/domain/inbound-message.js";

export const now = new Date("2025-01-02T03:04:05.000Z");

export function inbound(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    id: "msg-1",
    accountId: "account-1",
    channelMessageId: "channel-1",
    peerId: "peer-1",
    senderId: "sender-1",
    text: "hello",
    receivedAt: now,
    ...overrides,
  };
}

export function batch(messages: readonly InboundMessage[]): InboundBatch {
  return { accountId: "account-1", previousCursor: "10", nextCursor: "11", messages };
}

export function claimedTurn(): ClaimedTurn {
  return {
    turn: {
      id: "turn-1",
      sessionId: "session-1",
      inboxId: "msg-1",
      traceId: "trace-1",
      runId: "run-1",
      status: "RUNNING",
      queuedAt: now,
    },
    session: {
      id: "session-1",
      key: "weixin:account-1:peer-1",
      accountId: "account-1",
      peerId: "peer-1",
      status: "ACTIVE",
      createdAt: now,
      updatedAt: now,
    },
    message: inbound(),
  };
}

export function claimedOutbox(attemptNo = 1): ClaimedOutbox {
  return {
    attemptNo,
    message: {
      id: "outbox-1",
      turnId: "turn-1",
      accountId: "account-1",
      peerId: "peer-1",
      chunkIndex: 0,
      text: "reply",
      clientId: "client-1",
      runId: "run-1",
      status: "SENDING",
      attemptCount: attemptNo,
      nextAttemptAt: now,
      createdAt: now,
    },
  };
}

export function controlPlane(overrides: Partial<ControlPlane> = {}): ControlPlane {
  return {
    migrate: vi.fn(),
    healthCheck: vi.fn(() => ({ ready: true })),
    getCursor: vi.fn(() => ""),
    ingestBatch: vi.fn(() => ({ inserted: 0, rejected: 0 })),
    getMessageSession: vi.fn(() => undefined),
    getPersistedMessage: vi.fn(() => undefined),
    claimNextTurn: vi.fn(() => undefined),
    appendAgentEvent: vi.fn(),
    recordAgentInvocation: vi.fn(),
    completeTurn: vi.fn(),
    failTurn: vi.fn(),
    updateSessionPiLocator: vi.fn(),
    claimNextOutbox: vi.fn(() => undefined),
    markOutboxSent: vi.fn(),
    markOutboxFailed: vi.fn(),
    recoverInterrupted: vi.fn(() => ({ turns: 0, outbox: 0 })),
    archiveActiveSession: vi.fn(() => undefined),
    getTurnDetails: vi.fn(() => undefined),
    getSessionContextEvents: vi.fn(() => []),
    getAgentTrace: vi.fn(() => undefined),
    getRecentAgentTraces: vi.fn(() => []),
    getRecentErrors: vi.fn(() => []),
    close: vi.fn(),
    ...overrides,
  };
}

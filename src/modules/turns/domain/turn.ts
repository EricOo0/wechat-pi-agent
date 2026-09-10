import type { InboundMessage } from "../../messaging/index.js";
import type { ConversationSession } from "../../conversation/index.js";

export type TurnStatus =
  | "RECEIVED"
  | "QUEUED"
  | "RUNNING"
  | "REPLY_PENDING"
  | "SUCCEEDED"
  | "FAILED"
  | "DEAD_LETTER"
  | "CANCELLED";

const ALLOWED: Readonly<Record<TurnStatus, readonly TurnStatus[]>> = {
  RECEIVED: ["QUEUED", "CANCELLED"],
  QUEUED: ["RUNNING", "CANCELLED"],
  RUNNING: ["REPLY_PENDING", "FAILED", "CANCELLED"],
  REPLY_PENDING: ["SUCCEEDED", "FAILED", "DEAD_LETTER"],
  SUCCEEDED: [],
  FAILED: ["QUEUED", "DEAD_LETTER"],
  DEAD_LETTER: [],
  CANCELLED: [],
};

export interface Turn {
  taskId?: string;
  taskRevision?: number;
  source?: "user_message" | "task_continue" | "permission_continue";
  id: string;
  sessionId: string;
  inboxId: string;
  traceId: string;
  runId: string;
  status: TurnStatus;
  queuedAt: Date;
  startedAt?: Date;
  completedAt?: Date;
  finalResponse?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ClaimedTurn {
  turn: Turn;
  session: ConversationSession;
  message: InboundMessage;
  continuation?: { permissionRequestId: string; sourceTurnId: string };
}

export function assertTurnTransition(from: TurnStatus, to: TurnStatus): void {
  if (!ALLOWED[from].includes(to)) {
    throw new Error(`Invalid turn transition: ${from} -> ${to}`);
  }
}

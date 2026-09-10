import type { ConversationContextStore } from "../../conversation/index.js";
import type { ClaimedTurn } from "../domain/turn.js";
import type { AgentEvent } from "../../observability/index.js";
import type { AgentInvocationTrace } from "../../../runtime/agent/ports/agent.js";
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

export interface TurnStore {
  claimNextTurn(ownerId: string, leaseMs: number): ClaimedTurn | undefined;
  appendAgentEvent(turnId: string, event: AgentEvent): void;
  recordAgentInvocation(turnId: string, trace: AgentInvocationTrace): void;
  completeTurn(input: CompleteTurnInput): void;
  failTurn(input: FailTurnInput): void;
}

export type TurnExecutionStore = TurnStore & ConversationContextStore;

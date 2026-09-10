import type { MessageStore } from "../../modules/messaging/index.js";
import type { DeliveryStore } from "../../modules/messaging/index.js";
import type { TurnStore } from "../../modules/turns/index.js";
import type { ConversationContextStore } from "../../modules/conversation/index.js";
import type { TraceQuery } from "../../modules/observability/index.js";
import type { RecoveryStore } from "../../modules/turns/index.js";
export type { CompleteTurnInput, FailTurnInput } from "../../modules/turns/index.js";

/** Adapter composition only. Application consumers use the narrow owning ports. */
export interface ControlPlane extends MessageStore, DeliveryStore, TurnStore, ConversationContextStore, TraceQuery, RecoveryStore {
  migrate(): void;
  close(): void;
}

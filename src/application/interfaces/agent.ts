import type { ConversationContextEvent } from "../../domain/conversation/context-event.js";
import type { fileSummary } from "../../domain/files/user-file.js";
import type { AgentEvent } from "../../domain/execution/step.js";
import type { ConversationSession } from "../../domain/conversation/session.js";
import type { InboundImage } from "../../domain/messaging/inbound-message.js";
import type { PermissionContext } from "../services/permission-service.js";

export interface AgentInvocationTrace {
  systemPrompt: string;
  provider: string;
  modelId: string;
  skills: readonly { name: string; description: string; filePath: string; source?: string; scope?: string; origin?: string }[];
  tools: readonly string[];
  permissionRevision?: number;
  permissionMode?: string;
}

export interface AgentRunRequest {
  session: ConversationSession;
  prompt: string;
  permissionContext?: PermissionContext;
  images?: readonly InboundImage[];
  files?: readonly ReturnType<typeof fileSummary>[];
  contextEvents?: readonly ConversationContextEvent[];
  signal?: AbortSignal;
  onInvocation?: (trace: AgentInvocationTrace) => void;
  onSessionReady?: (piSessionId: string, piSessionFile?: string) => void;
  onEvent?: (event: AgentEvent) => void;
}

export type AgentContextRequest = Pick<AgentRunRequest, "session" | "permissionContext" | "contextEvents" | "signal" | "onSessionReady" | "onEvent">;

export interface AgentRunResult {
  text: string;
  piSessionId?: string;
  piSessionFile?: string;
  usage?: Readonly<Record<string, number>>;
}

export interface Agent {
  recordContext(request: AgentContextRequest): Promise<void>;
  runTurn(request: AgentRunRequest): Promise<AgentRunResult>;
  checkReady(): Promise<{ ready: boolean; reason?: string }>;
}

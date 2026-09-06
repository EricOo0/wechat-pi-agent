import type { AgentEvent } from "../../domain/execution/step.js";
import type { ConversationSession } from "../../domain/conversation/session.js";
import type { InboundImage } from "../../domain/messaging/inbound-message.js";
import type { PermissionContext } from "../services/permission-service.js";

export interface AgentInvocationTrace {
  systemPrompt: string;
  provider: string;
  modelId: string;
  skills: readonly { name: string; description: string; filePath: string }[];
  tools: readonly string[];
  permissionRevision?: number;
  permissionMode?: string;
}

export interface AgentRunRequest {
  session: ConversationSession;
  prompt: string;
  permissionContext?: PermissionContext;
  images?: readonly InboundImage[];
  signal?: AbortSignal;
  onInvocation?: (trace: AgentInvocationTrace) => void;
  onSessionReady?: (piSessionId: string, piSessionFile?: string) => void;
  onEvent?: (event: AgentEvent) => void;
}

export interface AgentRunResult {
  text: string;
  piSessionId?: string;
  piSessionFile?: string;
  usage?: Readonly<Record<string, number>>;
}

export interface Agent {
  runTurn(request: AgentRunRequest): Promise<AgentRunResult>;
  checkReady(): Promise<{ ready: boolean; reason?: string }>;
}

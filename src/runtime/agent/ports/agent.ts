import type { Task, TaskInput } from "../../../modules/tasks/index.js";
import type { TurnModelBinding } from "../../../modules/models/index.js";
import type { ConversationContextEvent } from "../../../modules/conversation/index.js";
import type { fileSummary } from "../../../modules/artifacts/index.js";
import type { AgentEvent } from "../../../modules/observability/index.js";
import type { ConversationSession } from "../../../modules/conversation/index.js";
import type { InboundImage } from "../../../modules/messaging/index.js";
import type { PermissionContext } from "../../../modules/permissions/index.js";

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
  task?: { task: Task; inputs: TaskInput[] };
  beforeModelCall?: () => void;
  modelBinding?: TurnModelBinding;
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
  /** Set only by TaskManager after approval, never trusted from model output. */
  replyImages?: readonly string[];
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

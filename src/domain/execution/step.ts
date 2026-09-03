export type StepStatus = "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | "SKIPPED" | "INTERRUPTED";
export type StepKind = "agent_run" | "pi_llm_round" | "tool_call" | "compaction" | "provider_retry" | "outbound_delivery";

export interface Step {
  id: string;
  turnId: string;
  parentStepId?: string;
  ordinal: number;
  kind: StepKind;
  name: string;
  status: StepStatus;
  startedAt?: Date;
  endedAt?: Date;
  inputSummary?: string;
  outputSummary?: string;
  error?: unknown;
}

export interface AgentEvent {
  type: string;
  at: Date;
  data?: Readonly<Record<string, unknown>>;
}

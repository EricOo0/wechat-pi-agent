import type { ExecutionPolicy, ToolOperation, ToolOutput } from "../../permissions/index.js";

export interface SandboxExecutor {
  execute(policy: ExecutionPolicy, operation: ToolOperation, signal?: AbortSignal): Promise<ToolOutput>;
  revoke(subjectKey: string): void;
  close(): void;
}

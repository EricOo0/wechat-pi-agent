import type { ExecutionPolicy, ToolOperation, ToolOutput } from "../../domain/policy/permissions.js";

export interface SandboxExecutor {
  execute(policy: ExecutionPolicy, operation: ToolOperation, signal?: AbortSignal): Promise<ToolOutput>;
  revoke(subjectKey: string): void;
  close(): void;
}

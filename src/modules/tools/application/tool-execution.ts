import type { ToolOperation } from "../../permissions/index.js";
import type { PermissionContext, PermissionService } from "../../permissions/index.js";
import type { SandboxExecutor } from "../../execution/index.js";
import type { ExecutionPolicyCompiler } from "../../execution/index.js";
export interface ToolExecutionOptions {
  context(): PermissionContext;
  permissions: PermissionService;
  compiler: ExecutionPolicyCompiler;
  executor: SandboxExecutor;
}
/** Authorize at execution time; the SDK adapter only converts arguments/results. */
export async function executeTool(options: ToolExecutionOptions, operation: ToolOperation, signal?: AbortSignal) {
  const context = options.context();
  const workspace = options.compiler.workspace(context.subject);
  const snapshot = options.permissions.acquire(context, operation, workspace);
  const result = await options.executor.execute(options.compiler.compile(snapshot), operation, signal);
  return { text: result.text || "(no output)", details: { ...result.details, permissionRevision: snapshot.revision, permissionMode: snapshot.policy.mode } };
}

import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ToolOperation } from "../../../modules/permissions/index.js";
import { executeTool, type ToolExecutionOptions } from "../../../modules/tools/index.js";
export type AgentToolOptions = ToolExecutionOptions;
export function createAgentTools(options: AgentToolOptions) {
  const execute = async (operation: ToolOperation, signal?: AbortSignal) => {
    const result = await executeTool(options, operation, signal);
    return { content: [{ type: "text" as const, text: result.text }], details: result.details };
  };
  return [
    defineTool({
      name: "read", label: "Read file", description: "Read a text file under the current user's permissions. Relative paths resolve inside the personal workspace.",
      parameters: Type.Object({ path: Type.String() }),
      execute: (_id, params, signal) => execute({ kind: "read", path: params.path }, signal),
    }),
    defineTool({
      name: "list_files", label: "List files", description: "List files under the current user's permissions.",
      parameters: Type.Object({ path: Type.Optional(Type.String()) }),
      execute: (_id, params, signal) => execute({ kind: "list", path: params.path ?? "." }, signal),
    }),
    defineTool({
      name: "sandbox_write", label: "Write file", description: "Create or replace a text file under the current user's permissions. Relative paths resolve inside the personal workspace.",
      parameters: Type.Object({ path: Type.String(), content: Type.String() }), executionMode: "sequential",
      execute: (_id, params, signal) => execute({ kind: "write", path: params.path, content: params.content }, signal),
    }),
    defineTool({
      name: "http_get", label: "HTTPS GET", description: "Fetch an HTTPS URL only when its domain is authorized. Network is disabled by default. Redirects are not followed.",
      parameters: Type.Object({ url: Type.String() }),
      execute: (_id, params, signal) => execute({ kind: "http", url: params.url }, signal),
    }),
    defineTool({
      name: "bash", label: "Run command", description: "Execute a command under the current permissions. Requires shell permission in restricted mode. Full Access runs on the host as the current OS user. Maximum timeout is 120 seconds.",
      parameters: Type.Object({ command: Type.String(), timeout: Type.Optional(Type.Number({ minimum: 1, maximum: 120 })) }), executionMode: "sequential",
      execute: (_id, params, signal) => execute({ kind: "bash", command: params.command, ...(params.timeout === undefined ? {} : { timeout: params.timeout }) }, signal),
    }),
    defineTool({
      name: "permissions_get", label: "View permissions", description: "View current permissions and the user's personal workspace.",
      parameters: Type.Object({}),
      execute() {
        const context = options.context();
        return Promise.resolve({ content: [{ type: "text" as const, text: `${options.permissions.describe(context)}\n个人工作目录：${options.compiler.workspace(context.subject)}` }], details: {} });
      },
    }),
    defineTool({
      name: "permissions_request", label: "Request permission", description: "Propose a permission change requested by the user. This tool NEVER grants permission. Return the exact confirmation message and pause the task. After user confirmation, the system automatically queues a continuation of this task. Never attempt to confirm through shell, files, HTTP or other tools.",
      parameters: Type.Object({
        kind: Type.Union([Type.Literal("read"), Type.Literal("write"), Type.Literal("network"), Type.Literal("shell"), Type.Literal("full-access")]),
        resource: Type.Optional(Type.String({ description: "Existing absolute directory for read/write, domain (or *) for network; omit for shell/full-access" })),
        lifetime: Type.Optional(Type.Union([Type.Literal("persistent"), Type.Literal("session"), Type.Literal("once")])),
      }), executionMode: "sequential",
      execute(id, params) {
        const context = options.context();
        const change = params.kind === "shell" || params.kind === "full-access" ? { kind: params.kind } : { kind: params.kind, resource: params.resource };
        const text = options.permissions.request({ ...context, sourceMessageId: `${context.sourceMessageId}:${id}` }, change, params.lifetime ?? "persistent");
        return Promise.resolve({ content: [{ type: "text" as const, text }], details: { granted: false } });
      },
    }),
  ];
}

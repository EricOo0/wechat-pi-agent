import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { createHttpTool } from "./http-tool.js";
import { createSandboxTools } from "./sandbox-tools.js";

export interface AgentToolOptions {
  sandboxRoot: string;
  skillRoots: string[];
  httpEnabled: boolean;
  httpAllowedHosts: string[];
}

export async function createAgentTools(options: AgentToolOptions): Promise<ToolDefinition[]> {
  const tools: ToolDefinition[] = await createSandboxTools({
    sandboxRoot: options.sandboxRoot,
    skillRoots: options.skillRoots,
  });
  if (options.httpEnabled) tools.push(createHttpTool({ allowedHosts: options.httpAllowedHosts }));
  return tools;
}

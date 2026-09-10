import type { Agent, AgentContextRequest, AgentRunRequest, AgentRunResult } from "../../runtime/agent/ports/agent.js";

export class DryRunAgent implements Agent {
  public recordContext(request: AgentContextRequest): Promise<void> {
    request.onEvent?.({ type: "context_update", at: new Date(), data: { status: "succeeded", input: request.contextEvents ?? [] } });
    return Promise.resolve();
  }

  public runTurn(request: AgentRunRequest): Promise<AgentRunResult> {
    request.onEvent?.({ type: "agent_start", at: new Date() });
    const text = `[dry-run] ${request.prompt}`;
    request.onEvent?.({ type: "agent_end", at: new Date(), data: { willRetry: false } });
    return Promise.resolve({ text, piSessionId: `dry_${request.session.id}` });
  }

  public checkReady(): Promise<{ ready: boolean }> {
    return Promise.resolve({ ready: true });
  }
}

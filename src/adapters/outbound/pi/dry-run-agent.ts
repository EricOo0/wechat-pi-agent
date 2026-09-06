import type { Agent, AgentRunRequest, AgentRunResult } from "../../../application/interfaces/agent.js";

export class DryRunAgent implements Agent {
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

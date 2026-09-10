import type { Agent, AgentContextRequest, AgentRunRequest, AgentRunResult } from "./ports/agent.js";

/** Owns in-process execution; the SDK adapter owns model/history protocol details. */
export class AgentRuntime implements Agent {
  private readonly active = new Set<string>();
  public constructor(private readonly engine: Agent) {}
  public checkReady(): Promise<{ ready: boolean; reason?: string }> { return this.engine.checkReady(); }
  public recordContext(request: AgentContextRequest): Promise<void> {
    return this.exclusive(request.session.id, () => this.engine.recordContext(request));
  }
  public runTurn(request: AgentRunRequest): Promise<AgentRunResult> {
    return this.exclusive(request.session.id, () => this.engine.runTurn(request));
  }
  private async exclusive<T>(sessionId: string, work: () => Promise<T>): Promise<T> {
    if (this.active.has(sessionId)) throw new Error(`Agent session already running: ${sessionId}`);
    this.active.add(sessionId);
    try { return await work(); } finally { this.active.delete(sessionId); }
  }
}

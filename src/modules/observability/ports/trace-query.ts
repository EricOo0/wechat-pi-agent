
export interface TraceQuery {
  healthCheck(): { ready: boolean; reason?: string };
  getTurnDetails(turnId: string): unknown;
  getAgentTrace(turnId: string): unknown;
  getRecentAgentTraces(limit: number): readonly unknown[];
  getRecentErrors(limit: number): readonly unknown[];
}

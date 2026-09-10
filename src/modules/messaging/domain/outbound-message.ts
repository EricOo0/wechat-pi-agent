export interface OutboundMessage {
  id: string;
  turnId: string;
  accountId: string;
  peerId: string;
  contextToken?: string;
  chunkIndex: number;
  text: string;
  clientId: string;
  runId: string;
}

export interface OutboundMessage {
  id: string;
  turnId: string;
  accountId: string;
  peerId: string;
  contextToken?: string;
  chunkIndex: number;
  text: string;
  artifactId?: string;
  clientId: string;
  runId: string;
}

/** Private channel upload result. Never include in Trace or model context. */
export interface PreparedImage { encryptQueryParam: string; aesKey: string; ciphertextSize: number }
export interface OutboxLease { ownerId: string; attemptNo: number }

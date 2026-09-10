/** Durable application-handled conversation event, replayed before the next model turn. */
export interface ConversationContextEvent {
  id: string;
  kind: "file_receipt";
  at: string;
  content: string;
}

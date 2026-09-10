import type { ConversationContextEvent } from "../../conversation/index.js";
export function renderApplicationContext(event: ConversationContextEvent): string {
  return `Conversation event handled by the application (not a new model request):\n${event.content}`;
}

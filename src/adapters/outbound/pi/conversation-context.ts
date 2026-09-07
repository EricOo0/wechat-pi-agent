import type { AgentSession } from "@earendil-works/pi-coding-agent";
import type { ConversationContextEvent } from "../../../domain/conversation/context-event.js";
import type { AgentEvent } from "../../../domain/execution/step.js";

/** Sync non-model replies from the application's durable history, without triggering inference. */
export async function syncConversationContext(
  session: Pick<AgentSession, "agent" | "sendCustomMessage">,
  events: readonly ConversationContextEvent[],
  emit: (event: AgentEvent) => void,
): Promise<void> {
  const present = new Set(session.agent.state.messages.flatMap(message => {
    if (message.role !== "custom" || message.customType !== "application_context") return [];
    const details = message.details as { contextEventId?: unknown } | undefined;
    return typeof details?.contextEventId === "string" ? [details.contextEventId] : [];
  }));
  for (const event of events) {
    if (present.has(event.id)) continue;
    await session.sendCustomMessage({ customType: "application_context", display: false,
      content: `Earlier conversation event handled by the application (not a new user request):\n${event.content}`,
      details: { contextEventId: event.id, kind: event.kind, at: event.at } }, { triggerTurn: false });
    present.add(event.id);
    emit({ type: "context_replay", at: new Date(), data: { contextEventId: event.id, kind: event.kind, content: event.content, status: "succeeded" } });
  }
}

import type { SessionEndReason, SessionLifecycleRepository } from "../../ports/session-lifecycle-repository.js";
import type { PermissionService } from "../../../permissions/index.js";
import { subjectKey } from "../../../permissions/index.js";
export class EndSession {
  public constructor(private readonly sessions: SessionLifecycleRepository, private readonly permissions: PermissionService,
    private readonly onEnded: (sessionId: string) => void = () => {},
    private readonly onCleanupError: (error: unknown) => void = () => {}) {}
  public execute(sessionId: string, reason: SessionEndReason, options: { currentTurnId?: string; now?: Date; idleMs?: number } = {}): boolean {
    const message = this.sessions.sessionMessage(sessionId);
    if (!message) return false;
    const context = this.permissions.context(message, sessionId);
    const ended = this.sessions.endSession({ sessionId, ownerId: subjectKey(context.subject), reason, now: options.now ?? new Date(),
      ...(options.currentTurnId ? { currentTurnId: options.currentTurnId } : {}), ...(options.idleMs === undefined ? {} : { idleMs: options.idleMs }) });
    if (ended) this.attemptCleanup(sessionId);
    return ended;
  }
  private attemptCleanup(id: string): void { try { this.cleanup(id); } catch(error) { this.onCleanupError(error); } }
  private cleanup(sessionId: string): void {
    const message = this.sessions.sessionMessage(sessionId);
    if (message) this.permissions.endSession({ ...this.permissions.context(message,sessionId), sourceMessageId: `session-end:${sessionId}` });
    this.onEnded(sessionId);
    this.sessions.markSessionCleaned(sessionId);
  }
  public repairCleanup(): void { for (const id of this.sessions.pendingSessionCleanup()) this.attemptCleanup(id); }
  public all(reason: "shutdown" | "recovery"): void {
    this.repairCleanup();
    for (const session of this.sessions.listActiveSessions()) this.execute(session.id,reason);
  }
}

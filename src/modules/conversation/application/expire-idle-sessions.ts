import type { SessionLifecycleRepository } from "../ports/session-lifecycle-repository.js";
import type { EndSession } from "./workflows/end-session.js";
export class ExpireIdleSessions {
  public constructor(private readonly sessions: SessionLifecycleRepository, private readonly end: EndSession) {}
  public execute(now = new Date()): number {
    this.end.repairCleanup();
    let count = 0;
    for (const session of this.sessions.listActiveSessions()) if (this.end.execute(session.id,"idle_timeout",{now,idleMs:3_600_000})) count++;
    return count;
  }
}

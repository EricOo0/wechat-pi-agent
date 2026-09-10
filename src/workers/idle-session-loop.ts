import type { ExpireIdleSessions } from "../modules/conversation/index.js";
import { sleep } from "../shared/sleep.js";
export class IdleSessionLoop {
  public constructor(private readonly sessions: ExpireIdleSessions) {}
  public async run(stop: AbortSignal): Promise<void> {
    while (!stop.aborted) { this.sessions.execute(); await sleep(60_000, stop); }
  }
}

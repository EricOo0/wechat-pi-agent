import type { Channel } from "../ports/channel.js";
import type { ReplyChunker } from "../domain/reply-chunker.js";
import type { Telemetry } from "../../observability/index.js";
export class ReplyPresentation {
  public constructor(private readonly channel: Channel, private readonly chunker: ReplyChunker, private readonly telemetry: Telemetry) {}
  public chunk(text: string): readonly string[] { return this.chunker.chunk(text); }
  public async setTyping(accountId: string, peerId: string, active: boolean, signal: AbortSignal): Promise<void> {
    try { await this.channel.setTyping?.(accountId, peerId, active, signal); }
    catch { this.telemetry.increment("typing_updates_failed", { active: String(active) }); }
  }
}

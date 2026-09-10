import type { Channel, PreparedImage } from "../../modules/messaging/index.js";
import type { InboundBatch } from "../../modules/messaging/index.js";
import type { OutboundMessage } from "../../modules/messaging/index.js";

export class DryRunChannel implements Channel {
  public readonly sent: OutboundMessage[] = [];

  public async getUpdates(accountId: string, cursor: string, signal: AbortSignal): Promise<InboundBatch> {
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, 1000);
      signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
    });
    return { accountId, previousCursor: cursor, nextCursor: cursor, messages: [] };
  }

  public sendText(message: OutboundMessage): Promise<{ remoteRequestId: string }> {
    this.sent.push(message);
    return Promise.resolve({ remoteRequestId: `dry_${message.clientId}` });
  }

  public imageCredentialScope(): string { return "dry-run"; }
  public prepareImage(): Promise<PreparedImage> { return Promise.resolve({ encryptQueryParam: "dry-run", aesKey: "dry-run", ciphertextSize: 0 }); }
  public sendPreparedImage(message: OutboundMessage): Promise<{ remoteRequestId: string }> { return this.sendText(message); }

  public checkReady(): Promise<{ ready: boolean }> {
    return Promise.resolve({ ready: true });
  }
}

import type { InboundMessage } from "./inbound-message.js";

export interface SenderPolicy {
  allows(message: InboundMessage): boolean;
}

export class ExactSenderPolicy implements SenderPolicy {
  public constructor(private readonly allowedSenderId: string) {}

  public allows(message: InboundMessage): boolean {
    return this.allowedSenderId.length > 0 && message.senderId === this.allowedSenderId;
  }
}

export class AllowAllSendersPolicy implements SenderPolicy {
  public allows(): boolean {
    return true;
  }
}

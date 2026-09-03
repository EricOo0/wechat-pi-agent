import type { Logger } from "pino";
import type { RuntimeHealth } from "../../adapters/inbound/admin-http/runtime-health.js";
import { sleep } from "../../shared/sleep.js";
import type { DeliverReply } from "./deliver-reply.js";

export class OutboxWorkerLoop {
  public constructor(
    private readonly deliverReply: DeliverReply,
    private readonly health: RuntimeHealth,
    private readonly logger: Logger,
  ) {}

  public async run(signal: AbortSignal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.deliverReply.execute(signal);
        this.health.beat("outbox");
        if (result.status === "retry_scheduled") this.logger.warn({ err: result.error, outboxId: result.outboxId }, "outbox retry scheduled");
        if (result.status === "idle") await sleep(250, signal);
      } catch (error) {
        if (!signal.aborted) this.logger.error({ err: error }, "outbox worker iteration failed");
        await sleep(1000, signal);
      }
    }
  }
}

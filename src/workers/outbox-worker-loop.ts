import type { Logger } from "pino";
import type { RuntimeHealth } from "../modules/observability/index.js";
import { sleep } from "../shared/sleep.js";
import type { DeliverReply } from "../modules/messaging/index.js";

export class OutboxWorkerLoop {
  public constructor(
    private readonly deliverReply: DeliverReply,
    private readonly health: RuntimeHealth,
    private readonly logger: Logger,
  ) {}

  public async run(signal: AbortSignal, workSignal: AbortSignal = signal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.deliverReply.execute(workSignal);
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

import type { Logger } from "pino";
import type { RuntimeHealth } from "../modules/observability/index.js";
import { sleep } from "../shared/sleep.js";
import type { RunNextTurn } from "../modules/turns/index.js";

export class TurnWorkerLoop {
  public constructor(
    private readonly runNextTurn: RunNextTurn,
    private readonly health: RuntimeHealth,
    private readonly logger: Logger,
  ) {}

  public async run(signal: AbortSignal, workSignal: AbortSignal = signal): Promise<void> {
    while (!signal.aborted) {
      try {
        const result = await this.runNextTurn.execute(workSignal);
        this.health.beat("turn");
        if (result.status === "failed") this.logger.warn({ err: result.error, turnId: result.turnId }, "turn failed");
        if (result.status === "idle") await sleep(250, signal);
      } catch (error) {
        if (!signal.aborted) this.logger.error({ err: error }, "turn worker iteration failed");
        await sleep(1000, signal);
      }
    }
  }
}

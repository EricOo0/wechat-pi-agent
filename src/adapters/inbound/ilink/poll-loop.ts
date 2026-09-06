import type { Logger } from "pino";
import type { Channel } from "../../../application/interfaces/channel.js";
import type { ControlPlane } from "../../../application/interfaces/control-plane.js";
import type { Telemetry } from "../../../application/interfaces/telemetry.js";
import type { IngestMessage } from "../../../application/use-cases/ingest-message.js";
import { sleep } from "../../../shared/sleep.js";
import type { RuntimeHealth } from "../admin-http/runtime-health.js";

export interface PollLoopOptions {
  accountId: string;
  channel: Channel;
  control: ControlPlane;
  ingest: IngestMessage;
  health: RuntimeHealth;
  telemetry: Telemetry;
  logger: Logger;
}

export class PollLoop {
  public constructor(private readonly options: PollLoopOptions) {}

  public async run(signal: AbortSignal): Promise<void> {
    let failures = 0;
    while (!signal.aborted) {
      try {
        const cursor = this.options.control.getCursor(this.options.accountId);
        const batch = await this.options.channel.getUpdates(this.options.accountId, cursor, signal);
        if (signal.aborted) break;
        const result = this.options.ingest.execute(batch);
        this.options.health.beat("poll");
        this.options.telemetry.increment("ilink_poll_requests_total", { result: "success" });
        this.options.telemetry.increment("ilink_inbound_messages_total", { result: "inserted" }, result.inserted);
        failures = 0;
      } catch (error) {
        if (signal.aborted) break;
        failures += 1;
        this.options.telemetry.increment("ilink_poll_requests_total", { result: "error" });
        this.options.logger.warn({ err: error, failures }, "iLink poll failed");
        await sleep(Math.min(30_000, 1000 * 2 ** Math.min(failures, 5)), signal);
      }
    }
  }
}

import type { RecoveryStore } from "../modules/turns/index.js";
import { noopTelemetry, type Telemetry } from "../modules/observability/index.js";
import { systemClock, type Clock } from "../shared/clock.js";

export interface RecoverInterruptedWorkResult {
  turns: number;
  outbox: number;
}

export class RecoverInterruptedWork {
  public constructor(
    private readonly controlPlane: RecoveryStore,
    private readonly clock: Clock = systemClock,
    private readonly telemetry: Telemetry = noopTelemetry,
  ) {}

  public execute(now: Date = this.clock.now()): RecoverInterruptedWorkResult {
    const result = this.controlPlane.recoverInterrupted(now);
    this.telemetry.increment("interrupted_turns_recovered", undefined, result.turns);
    this.telemetry.increment("interrupted_outbox_recovered", undefined, result.outbox);
    return result;
  }
}

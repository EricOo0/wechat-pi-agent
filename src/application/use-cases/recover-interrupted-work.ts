import type { ControlPlane } from "../interfaces/control-plane.js";
import { noopTelemetry, type Telemetry } from "../interfaces/telemetry.js";
import { systemClock, type Clock } from "../../shared/clock.js";

export interface RecoverInterruptedWorkResult {
  turns: number;
  outbox: number;
}

export class RecoverInterruptedWork {
  public constructor(
    private readonly controlPlane: ControlPlane,
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

import { describe, expect, it, vi } from "vitest";
import { RecoverInterruptedWork } from "../../../src/bootstrap/recover-interrupted-work.js";
import { controlPlane, now } from "./helpers.js";

describe("RecoverInterruptedWork", () => {
  it("recovers expired turns and outbox leases at the supplied time", () => {
    const recoverInterrupted = vi.fn(() => ({ turns: 2, outbox: 3 }));
    const useCase = new RecoverInterruptedWork(controlPlane({ recoverInterrupted }));

    expect(useCase.execute(now)).toEqual({ turns: 2, outbox: 3 });
    expect(recoverInterrupted).toHaveBeenCalledWith(now);
  });
});

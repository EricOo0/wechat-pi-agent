import { describe, expect, it } from "vitest";
import { PrometheusTelemetry } from "../../../src/adapters/outbound/observability/metrics.js";

describe("PrometheusTelemetry", () => {
  it("accepts command and agent turn counters with one stable label set", async () => {
    const telemetry = new PrometheusTelemetry(false);

    telemetry.increment("turns_completed", { kind: "command" });
    telemetry.increment("turns_completed", { kind: "agent" });

    const metrics = await telemetry.metrics();
    expect(metrics).toContain('turns_completed{kind="command"} 1');
    expect(metrics).toContain('turns_completed{kind="agent"} 1');
  });
});

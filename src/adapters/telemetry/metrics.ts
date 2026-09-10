import { Counter, Gauge, Histogram, Registry, collectDefaultMetrics } from "prom-client";
import type { Telemetry } from "../../modules/observability/index.js";

export class PrometheusTelemetry implements Telemetry {
  public readonly registry = new Registry();
  private readonly counters = new Map<string, Counter<string>>();
  private readonly histograms = new Map<string, Histogram<string>>();
  private readonly gauges = new Map<string, Gauge<string>>();

  public constructor(collectDefaults = true) {
    if (collectDefaults) collectDefaultMetrics({ register: this.registry, prefix: "wechat_pi_" });
  }

  public increment(name: string, labels: Readonly<Record<string, string>> = {}, value = 1): void {
    let metric = this.counters.get(name);
    if (metric === undefined) {
      metric = new Counter({ name, help: name, labelNames: Object.keys(labels), registers: [this.registry] });
      this.counters.set(name, metric);
    }
    metric.inc(labels, value);
  }

  public observe(name: string, value: number, labels: Readonly<Record<string, string>> = {}): void {
    let metric = this.histograms.get(name);
    if (metric === undefined) {
      metric = new Histogram({ name, help: name, labelNames: Object.keys(labels), registers: [this.registry] });
      this.histograms.set(name, metric);
    }
    metric.observe(labels, value);
  }

  public set(name: string, value: number): void {
    let metric = this.gauges.get(name);
    if (metric === undefined) {
      metric = new Gauge({ name, help: name, registers: [this.registry] });
      this.gauges.set(name, metric);
    }
    metric.set(value);
  }

  public async metrics(): Promise<string> {
    return this.registry.metrics();
  }
}

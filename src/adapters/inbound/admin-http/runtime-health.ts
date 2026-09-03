export type WorkerName = "poll" | "turn" | "outbox";

export class RuntimeHealth {
  private readonly heartbeats = new Map<WorkerName, number>();

  public beat(worker: WorkerName): void {
    this.heartbeats.set(worker, Date.now());
  }

  public staleWorkers(maxAgeMs: number): WorkerName[] {
    const now = Date.now();
    return (["poll", "turn", "outbox"] as const).filter((worker) => {
      const last = this.heartbeats.get(worker);
      return last === undefined || now - last > maxAgeMs;
    });
  }
}

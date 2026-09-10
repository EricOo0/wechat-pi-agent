import { ModelManagementError } from "../domain/model-selection.js";
/** Holds a provider for an entire agent/memory task, not individual HTTP calls. */
export class ProviderRequestGate {
  private readonly quarantined = new Set<string>();
  public quarantine(provider: string): void { this.quarantined.add(provider); this.wake(); }
  private assertAvailable(provider: string): void { if (this.quarantined.has(provider)) throw new ModelManagementError("AUTH_RECOVERY_REQUIRED", "供应商账户提交需要恢复核对（recovery），请重启服务后重试。"); }
  private readonly active = new Map<string, number>();
  private readonly blocked = new Set<string>();
  private readonly wakeups = new Set<() => void>();
  public activeCount(provider: string): number { return this.active.get(provider) ?? 0; }
  public async enter(provider: string, signal?: AbortSignal): Promise<() => void> {
    this.assertAvailable(provider);
    while (this.blocked.has(provider)) { await this.changed(signal); this.assertAvailable(provider); }
    signal?.throwIfAborted();
    this.active.set(provider, this.activeCount(provider) + 1);
    let released = false;
    return () => { if (released) return; released = true; this.active.set(provider, this.activeCount(provider) - 1); this.wake(); };
  }
  public async exclusive<T>(provider: string, action: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    this.assertAvailable(provider);
    while (this.blocked.has(provider)) { await this.changed(signal); this.assertAvailable(provider); }
    signal?.throwIfAborted(); this.blocked.add(provider);
    try { while (this.activeCount(provider)) await this.changed(signal); signal?.throwIfAborted(); this.assertAvailable(provider); return await action(); }
    finally { this.blocked.delete(provider); this.wake(); }
  }
  private wake(): void { for (const wake of [...this.wakeups]) wake(); }
  private changed(signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
      const cleanup = () => { this.wakeups.delete(wake); signal?.removeEventListener("abort", abort); };
      const wake = () => { cleanup(); resolve(); };
      const abort = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
      this.wakeups.add(wake); signal?.addEventListener("abort", abort, { once: true }); if (signal?.aborted) abort();
    });
  }
}

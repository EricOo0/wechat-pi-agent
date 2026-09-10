import type { Logger } from "pino";

export type BackgroundLoop = (stop: AbortSignal, work: AbortSignal) => Promise<void>;

/** Stop admission first, then allow in-flight work to settle before cancellation. */
export async function runBackgroundLoops(signal: AbortSignal, logger: Logger, loops: BackgroundLoop[]): Promise<void> {
  const stop = new AbortController(), work = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const shutdown = () => {
    if (stop.signal.aborted) return;
    logger.info("stopping intake; waiting up to 30 seconds for active work");
    stop.abort();
    if (signal.reason instanceof Error && signal.reason.name === "ServiceLockLost") work.abort();
    else timer = setTimeout(() => work.abort(), 30_000);
  };
  signal.addEventListener("abort", shutdown, { once: true });
  if (signal.aborted) shutdown();
  const tasks = loops.map(loop => loop(stop.signal, work.signal));
  try { await Promise.all(tasks); }
  finally { shutdown(); await Promise.allSettled(tasks); if (timer) clearTimeout(timer); signal.removeEventListener("abort", shutdown); }
}

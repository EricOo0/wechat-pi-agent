import { createServer } from "node:net";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import lockfile from "proper-lockfile";
/** All app processes sharing a data directory must hold this lock before recovery. */
export async function acquireServiceLock(dataDir: string): Promise<{ signal: AbortSignal; release: () => Promise<void> }> {
  await mkdir(dataDir,{recursive:true});
  const lost=new AbortController();
  const release=await lockfile.lock(dataDir,{lockfilePath:join(dataDir,'.service.lock'),stale:30_000,update:10_000,retries:0,
    onCompromised:()=>{const error=new Error('Service data-directory lock lost');error.name='ServiceLockLost';lost.abort(error);}});
  return {signal:lost.signal,release:async()=>{if(!lost.signal.aborted)await release();}};
}

/** Fail before database migration when an older, unlocked service owns the configured port. */
export async function assertAdminPortFree(host: string, port: number): Promise<void> {
  await new Promise<void>((resolve,reject)=>{
    const server=createServer();
    server.once("error",()=>reject(new Error(`Admin port ${port} is in use; stop the existing service before starting this version`)));
    server.listen(port,host,()=>server.close(error=>error?reject(error):resolve()));
  });
}

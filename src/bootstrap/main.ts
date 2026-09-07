import { loadEnvFile } from "node:process";
import { buildApp, type AppRuntime } from "./container.js";
import { loadConfig } from "./config.js";
import { acquireServiceLock, assertAdminPortFree } from "./service-lock.js";
try { loadEnvFile('.env'); } catch(error) { if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error; }
const config=loadConfig();
const controller=new AbortController();
const stop=()=>controller.abort();
process.on('SIGINT',stop);
process.on('SIGTERM',stop);
const lock=await acquireServiceLock(config.dataDir);
let app:AppRuntime|undefined;
try {
  await assertAdminPortFree(config.adminHost,config.adminPort);
  app=await buildApp(config);
  await app.run(AbortSignal.any([controller.signal,lock.signal]));
} catch(error) {
  if(app)app.logger.fatal({err:error},'application failed');else console.error(error instanceof Error?error.message:'Application failed');
  process.exitCode=1;
} finally {
  try { await app?.close(!lock.signal.aborted); } finally { await lock.release(); process.removeListener('SIGINT',stop); process.removeListener('SIGTERM',stop); }
}

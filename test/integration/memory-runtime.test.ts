import { createServer } from 'node:net';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { buildApp } from '../../src/bootstrap/container.js';
import { loadConfig } from '../../src/bootstrap/config.js';
import { SqliteControlPlane } from '../../src/adapters/sqlite/sqlite-control-plane.js';
import { SqliteMemoryJobRepository } from '../../src/adapters/sqlite/sqlite-memory-job-repository.js';
import { acquireServiceLock } from '../../src/bootstrap/service-lock.js';
const freePort=()=>new Promise<number>((resolve,reject)=>{const server=createServer();server.on('error',reject);server.listen(0,'127.0.0.1',()=>{const address=server.address();if(!address||typeof address==='string')throw Error('no port');server.close(()=>resolve(address.port));});});
async function until(check:()=>boolean|Promise<boolean>){for(let i=0;i<100;i++){if(await check())return;await new Promise(r=>setTimeout(r,30));}throw Error('condition timed out');}
it('gracefully archives sessions, queues memory work, and processes it after restart',async()=>{
 const root=await realpath(await mkdtemp('/tmp/memory-runtime-'));const port=await freePort();
 const config=loadConfig({DRY_RUN:'true',DATA_DIR:root,WORKSPACE_ROOT:root,ADMIN_PORT:String(port),LOG_LEVEL:'silent'});
 let lock=await acquireServiceLock(root);let app=await buildApp(config);let stop=new AbortController();let run=app.run(stop.signal);
 const inspect=new SqliteControlPlane(root+'/app.db');const jobs=new SqliteMemoryJobRepository(root+'/app.db');
 try {
  await until(async()=>{try{return (await fetch(`http://127.0.0.1:${port}/healthz`)).ok;}catch{return false;}});
  inspect.ingestBatch({accountId:'dry-run-account',previousCursor:inspect.getCursor('dry-run-account'),nextCursor:'test',messages:[{id:'test',accountId:'dry-run-account',channelMessageId:'test',peerId:'user',senderId:'user',text:'请保持简洁',receivedAt:new Date()}]});
  await until(()=>{const rows=inspect.getRecentAgentTraces(1) as Array<{status:string}>;return rows[0]?.status==='SUCCEEDED'||rows[0]?.status==='REPLY_PENDING';});
  stop.abort();await run;await app.close();await lock.release();
  expect(inspect.listActiveSessions()).toHaveLength(0);expect(jobs.list()).toHaveLength(1);expect(jobs.list()[0]?.phase).toBe('PENDING');
  lock=await acquireServiceLock(root);app=await buildApp(config);stop=new AbortController();run=app.run(stop.signal);
  await until(()=>jobs.list()[0]?.phase==='COMPLETED');
  const response=await fetch(`http://127.0.0.1:${port}/debug/memory/jobs`).then(r=>r.json()) as Array<{recordKind:string;turnId:string}>;
  expect(response[0]?.recordKind).toBe('memory_job');
  const detail=await fetch(`http://127.0.0.1:${port}/debug/memory/jobs/${response[0]!.turnId}`).then(r=>r.json()) as {spans:unknown[]};expect(detail.spans.length).toBeGreaterThan(0);
 } finally {stop.abort();await run;await app.close();await lock.release();jobs.close();inspect.close();await rm(root,{recursive:true,force:true});}
},15000);

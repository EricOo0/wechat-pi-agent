import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { expect, it } from 'vitest';
import { SqliteControlPlane } from '../../src/adapters/outbound/sqlite/sqlite-control-plane.js';
import { SqliteMemoryJobRepository } from '../../src/adapters/outbound/sqlite/sqlite-memory-job-repository.js';
it('SIGTERM runs real main shutdown before releasing the process lock',async()=>{
 const root=await realpath(await mkdtemp('/tmp/session-sigterm-'));
 const port=await new Promise<number>((yes,no)=>{const s=createServer();s.on('error',no);s.listen(0,'127.0.0.1',()=>{const a=s.address();if(!a||typeof a==='string')throw Error('no port');s.close(()=>yes(a.port));});});
 const child=spawn(process.execPath,['--import',pathToFileURL(resolve('node_modules/tsx/dist/loader.mjs')).href,resolve('src/bootstrap/main.ts')],{cwd:root,env:{PATH:process.env.PATH,DRY_RUN:'true',DATA_DIR:root,WORKSPACE_ROOT:root,ADMIN_PORT:String(port),LOG_LEVEL:'silent'},stdio:['ignore','ignore','pipe']});
 let stderr='';child.stderr.on('data',(data:Buffer)=>{stderr=(stderr+data.toString()).slice(-2000);});
 const exited=new Promise<{code:number|null;signal:NodeJS.Signals|null}>(yes=>child.once('exit',(code,signal)=>yes({code,signal})));
 let control:SqliteControlPlane|undefined,jobs:SqliteMemoryJobRepository|undefined;
 try {
  let ready=false;
  for(let i=0;i<250;i++){try{if((await fetch(`http://127.0.0.1:${port}/healthz`)).ok){ready=true;break;}}catch{ /* The child has not bound its port yet. */ }if(child.exitCode!==null)throw Error(stderr);await new Promise(r=>setTimeout(r,40));}
  if(!ready)throw Error('Service not ready: '+stderr);
  control=new SqliteControlPlane(root+'/app.db');jobs=new SqliteMemoryJobRepository(root+'/app.db');
  control.ingestBatch({accountId:'dry-run-account',previousCursor:control.getCursor('dry-run-account'),nextCursor:'1',messages:[{id:'sigterm-message',accountId:'dry-run-account',channelMessageId:'sigterm-message',peerId:'user',senderId:'user',text:'以后请保持简洁',receivedAt:new Date()}]});
  child.kill('SIGTERM');
  const result=await exited;expect(result).toEqual({code:0,signal:null});expect(control.listActiveSessions()).toHaveLength(0);expect(jobs.list()).toHaveLength(1);expect(existsSync(root+'/.service.lock')).toBe(false);
 } finally {if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');await exited;jobs?.close();control?.close();await rm(root,{recursive:true,force:true});}
},20000);

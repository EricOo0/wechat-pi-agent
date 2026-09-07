import { mkdtemp, realpath, rm, symlink, mkdir } from 'node:fs/promises';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SqliteControlPlane } from '../../src/adapters/outbound/sqlite/sqlite-control-plane.js';
import { SqlitePermissionRepository } from '../../src/adapters/outbound/sqlite/sqlite-permission-repository.js';
import { SqliteMemoryJobRepository } from '../../src/adapters/outbound/sqlite/sqlite-memory-job-repository.js';
import { MarkdownMemoryStore } from '../../src/adapters/outbound/filesystem/markdown-memory-store.js';
import { PermissionService } from '../../src/application/services/permission-service.js';
import { EndSession } from '../../src/application/use-cases/end-session.js';
import { GenerateSessionMemory } from '../../src/application/use-cases/generate-session-memory.js';
import { principalId, subjectKey } from '../../src/domain/policy/permissions.js';
import type { InboundMessage } from '../../src/domain/messaging/inbound-message.js';
import type { MemoryGenerator } from '../../src/application/interfaces/memory-generator.js';
import { acquireServiceLock } from '../../src/bootstrap/service-lock.js';
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const run of cleanup.splice(0))await run();});
async function fixture(){
 const root=await realpath(await mkdtemp('/tmp/user-memory-'));
 const db=new SqliteControlPlane(root+'/app.db');db.migrate();const jobs=new SqliteMemoryJobRepository(root+'/app.db');const permissionDb=new SqlitePermissionRepository(root+'/permissions.db');
 const permissions=new PermissionService(permissionDb,{executorId:'executor',workspaceId:root,ownerPrincipalId:principalId('bot','user'),protectedPaths:[]});
 const end=new EndSession(db,permissions);const store=new MarkdownMemoryStore(root+'/memory');let n=0;
 const send=(text:string,peer='user')=>{const id='msg-'+(++n);const message:InboundMessage={id,accountId:'bot',channelMessageId:id,peerId:peer,senderId:peer,text,receivedAt:new Date()};db.ingestBatch({accountId:'bot',previousCursor:db.getCursor('bot'),nextCursor:id,messages:[message]});return message;};
 const finish=()=>{const claimed=db.claimNextTurn('worker',30000)!;db.completeTurn({turnId:claimed.turn.id,finalResponse:'已理解用户明确的偏好。',chunks:['ok']});return claimed;};
 const owner=(m:InboundMessage)=>subjectKey(permissions.context(m,'unused').subject);
 cleanup.push(async()=>{jobs.close();db.close();permissionDb.close();await rm(root,{recursive:true,force:true});});return {root,db,jobs,permissions,end,store,send,finish,owner};
}
function generator():MemoryGenerator{return {extract:()=>Promise.resolve({content:'用户明确要求回答简洁。来源：当前会话。',shouldMerge:true}),merge:(_old,_detail,id)=>Promise.resolve('# 用户记忆\n- 用户偏好简洁回答。\n- 明细：'+id)};}

describe('session ending and user memory',()=>{
 it('expires only after one hour with no queued/running work and enqueues once',async()=>{
  const f=await fixture();const m=f.send('请保持回答简洁');const session=f.db.getMessageSession('bot',m.channelMessageId)!;const later=new Date(Date.now()+3_600_001);
  expect(f.end.execute(session,'idle_timeout',{now:later})).toBe(false);
  f.finish();expect(f.end.execute(session,'idle_timeout',{now:new Date()})).toBe(false);
  expect(f.end.execute(session,'idle_timeout',{now:new Date(Date.now()+3_600_001)})).toBe(true);
  expect(f.end.execute(session,'shutdown')).toBe(false);expect(f.jobs.list()).toHaveLength(1);expect(f.db.listActiveSessions()).toHaveLength(0);
 });
 it('moves queued messages after /new to the next session and waits for the command to finish before summarizing',async()=>{
  const f=await fixture();f.send('我的偏好是简洁');const first=f.finish();f.send('/new');const command=f.db.claimNextTurn('w',30000)!;const following=f.send('新的话题');
  expect(f.end.execute(first.session.id,'manual',{currentTurnId:command.turn.id})).toBe(true);
  expect(f.db.getMessageSession('bot',following.channelMessageId)).not.toBe(first.session.id);expect(f.jobs.claim('memory')).toBeUndefined();
  f.db.completeTurn({turnId:command.turn.id,finalResponse:'已归档',chunks:['已归档']});const job=f.jobs.claim('memory')!;
  expect(f.jobs.source(job).turns.map(t=>t.user)).toEqual(['我的偏好是简洁']);expect(f.jobs.source(job).turns[0]?.responseGenerated).toBe(true);
 });
 it('archives interrupted sessions on recovery and repairs permission cleanup before memory work',async()=>{
  const f=await fixture();const m=f.send('未完成的任务');const active=f.db.claimNextTurn('w',30000)!;
  const revoke=vi.spyOn(f.permissions,'endSession').mockImplementationOnce(()=>{throw Error('temporary store failure');});
  f.end.all('recovery');expect(f.db.listActiveSessions()).toHaveLength(0);expect(f.db.pendingSessionCleanup()).toHaveLength(1);expect(f.jobs.claim('m')).toBeUndefined();
  f.end.repairCleanup();expect(revoke).toHaveBeenCalledTimes(2);expect(f.db.pendingSessionCleanup()).toHaveLength(0);
  const detail=f.db.getTurnDetails(active.turn.id) as {turn:{status:string}};expect(detail.turn.status).toBe('CANCELLED');
  const job=f.jobs.claim('m')!;expect(job.ownerId).toBe(f.owner(m));expect(f.jobs.source(job).turns[0]?.status).toBe('CANCELLED');
 });
 it('creates detail and overview files and resumes merge without extracting twice',async()=>{
  const f=await fixture();f.send('请保持回答简洁');const c=f.finish();f.end.execute(c.session.id,'manual');const g=generator();const extract=vi.spyOn(g,'extract');const merge=vi.spyOn(g,'merge').mockRejectedValueOnce(Error('temporary model failure'));
  const run=new GenerateSessionMemory(f.jobs,f.store,g);const job=f.jobs.claim('m1')!;
  await expect(run.execute(job,new AbortController().signal)).rejects.toThrow('temporary');expect(f.jobs.details(job.id)?.job.phase).toBe('EXTRACTED');expect(f.store.read(job.ownerId,job.detailId)).toContain('用户明确');
  const retry=f.jobs.claim('m2',new Date(Date.now()+3_600_000))!;await run.execute(retry,new AbortController().signal);
  expect(extract).toHaveBeenCalledTimes(1);expect(merge).toHaveBeenCalledTimes(2);expect(f.jobs.details(job.id)?.job.phase).toBe('COMPLETED');expect(f.store.overview(job.ownerId).content).toContain('简洁');expect(f.store.search(job.ownerId,'简洁',20).hits.length).toBeGreaterThan(0);
  expect(f.store.overview('b'.repeat(64)).content).toBe('');expect(()=>f.store.read('b'.repeat(64),job.detailId)).toThrow();
 });
 it('serializes unfinished jobs for the same user but lets other users proceed',async()=>{
  const f=await fixture();f.send('第一条偏好');const one=f.finish();f.end.execute(one.session.id,'manual');f.send('第二条偏好');const two=f.finish();f.end.execute(two.session.id,'manual');f.send('另一个用户','other');const other=f.finish();f.end.execute(other.session.id,'manual');
  const a=f.jobs.claim('a')!,b=f.jobs.claim('b')!;expect(a.ownerId).not.toBe(b.ownerId);expect(f.jobs.claim('c')).toBeUndefined();
  f.jobs.commit(a,'SKIPPED',()=>{});expect(f.jobs.claim('c')?.ownerId).toBe(a.ownerId);
 });
 it('does not repeat overview consolidation after a publish/checkpoint crash window',async()=>{
  const f=await fixture();f.send('用户偏好');const c=f.finish();f.end.execute(c.session.id,'manual');const job=f.jobs.claim('m')!;
  f.jobs.commit(job,'EXTRACTED',()=>f.store.write(job.ownerId,job.detailId,'detail'));
  f.store.write(job.ownerId,'MEMORY.md',`<!-- consolidated:${job.id} -->\n# Already published`);
  const g=generator();const merge=vi.spyOn(g,'merge');await new GenerateSessionMemory(f.jobs,f.store,g).execute({...job,phase:'EXTRACTED'},new AbortController().signal);
  expect(merge).not.toHaveBeenCalled();expect(f.jobs.details(job.id)?.job.phase).toBe('COMPLETED');
 });
 it('rejects path escapes, symlinks and oversized overviews',async()=>{
  const f=await fixture();const owner='a'.repeat(64);await mkdir(f.root+'/outside');await mkdir(f.root+'/memory');await symlink(f.root+'/outside',f.root+'/memory/'+owner);
  expect(()=>f.store.write(owner,'MEMORY.md','bad')).toThrow('symlink');expect(()=>f.store.read(owner,'../other/MEMORY.md')).toThrow('Invalid');
  expect(()=>f.store.write('b'.repeat(64),'MEMORY.md','x'.repeat(6001))).toThrow('6000');
 });
 it('locks a data directory against concurrent service instances',async()=>{
  const f=await fixture();const first=await acquireServiceLock(f.root);try{await expect(acquireServiceLock(f.root)).rejects.toThrow();}finally{await first.release();}
  const second=await acquireServiceLock(f.root);await second.release();
 });
 it('does not overwrite an overview edited while the model is merging',async()=>{
  const f=await fixture();f.send('用户偏好');const c=f.finish();f.end.execute(c.session.id,'manual');const job=f.jobs.claim('m')!;const g=generator();
  g.merge=()=>{f.store.write(job.ownerId,'MEMORY.md','# Manual correction');return Promise.resolve('# Stale generated replacement');};
  await expect(new GenerateSessionMemory(f.jobs,f.store,g).execute(job,new AbortController().signal)).rejects.toThrow('changed during generation');
  expect(f.store.overview(job.ownerId).content).toBe('# Manual correction');expect(f.jobs.details(job.id)?.job.phase).toBe('EXTRACTED');
 });

});

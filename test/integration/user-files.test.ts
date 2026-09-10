import type { AgentContextRequest, AgentRunRequest, AgentRunResult } from "../../src/runtime/agent/ports/agent.js";
import { createCipheriv } from "node:crypto";
import { mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";
import { SqliteUserFileRepository } from "../../src/adapters/sqlite/sqlite-user-file-repository.js";
import { LocalFileStorage } from "../../src/adapters/filesystem/local-file-storage.js";
import { ILinkFileDownloader } from "../../src/adapters/ilink/ilink-file-downloader.js";
import { ILinkHttpClient } from "../../src/adapters/ilink/ilink-http-client.js";
import { SaveInboundFiles } from "../../src/modules/artifacts/application/workflows/save-inbound-files.js";
import { IngestMessage } from "../../src/modules/messaging/application/workflows/ingest-message.js";
import { ExactSenderPolicy } from "../../src/modules/messaging/domain/sender-policy.js";
import { RunNextTurn } from "../../src/modules/turns/application/workflows/run-next-turn.js";
import { ReplyChunker } from "../../src/modules/messaging/domain/reply-chunker.js";
import { PermissionService } from "../../src/modules/permissions/application/permission-service.js";
import { SqlitePermissionRepository } from "../../src/adapters/sqlite/sqlite-permission-repository.js";
import { DryRunChannel } from "../../src/adapters/dry-run/dry-run-channel.js";
import { subjectKey, principalId } from "../../src/modules/permissions/domain/permissions.js";
import type { InboundMessage } from "../../src/modules/messaging/domain/inbound-message.js";
import { createFileTools } from "../../src/adapters/pi/tools/file-tools.js";
const cleanup:Array<()=>Promise<void>>=[];
afterEach(async()=>{for(const fn of cleanup.splice(0))await fn();});
async function setup(){
  const root=await realpath(await mkdtemp('/tmp/user-files-'));const control=new SqliteControlPlane(root+'/app.db');control.migrate();const repo=new SqliteUserFileRepository(root+'/app.db');const store=new LocalFileStorage(root+'/files');const permissionsRepo=new SqlitePermissionRepository(root+'/permissions.db');const permissions=new PermissionService(permissionsRepo,{executorId:'machine',workspaceId:root,ownerPrincipalId:principalId('bot','owner'),protectedPaths:[]});
  cleanup.push(async()=>{repo.close();control.close();permissionsRepo.close();await rm(root,{recursive:true,force:true});});return {root,control,repo,store,permissions};
}
function message(id='one'):InboundMessage{return {id,accountId:'bot',channelMessageId:id,peerId:'owner',senderId:'owner',text:'',receivedAt:new Date(),files:[{itemIndex:0,name:'resume.pdf',media:{encrypt_query_param:'secret-download-ref',aes_key:'secret-key'}}]};}

describe('user PDF library',()=>{
 it('persists file-only messages, saves once, exposes metadata in traces, and reuses files across sessions',async()=>{
  const {control,repo,store,permissions}=await setup();const msg=message();
  control.ingestBatch({accountId:'bot',previousCursor:'',nextCursor:'1',messages:[msg]});
  const download=vi.fn(()=>Promise.resolve(Buffer.from('%PDF-1.4\nfixture')));
  const save=new SaveInboundFiles(repo,store,{download});const run=vi.fn<(request: AgentRunRequest) => Promise<AgentRunResult>>(()=>Promise.resolve({text:'model response'}));
  const recordContext=vi.fn<(request: AgentContextRequest)=>Promise<void>>(()=>Promise.resolve());
  const worker=new RunNextTurn(control,{recordContext,runTurn:run,checkReady:()=>Promise.resolve({ready:true})},new DryRunChannel(),new ReplyChunker(),{ownerId:'worker'},undefined,undefined,permissions,save);
  const result=await worker.execute();expect(result.status).toBe('completed');expect(run).not.toHaveBeenCalled();expect(recordContext).toHaveBeenCalledTimes(1);expect(recordContext.mock.calls[0]?.[0].contextEvents?.[0]?.content).toContain("已保存");expect(download).toHaveBeenCalledTimes(1);
  const owner=subjectKey(permissions.context(msg,'old').subject);const [file]=repo.list(owner);expect(file?.status).toBe('ready');expect(await store.read(file!)).toEqual(Buffer.from('%PDF-1.4\nfixture'));
  const recent=control.getRecentAgentTraces(100) as Array<{turnId:string;provider:string}>;expect(recent).toHaveLength(1);expect(recent[0]?.provider).toBe('');
  const details=control.getTurnDetails(recent[0]!.turnId);expect(JSON.stringify(details)).not.toContain('secret-download-ref');expect(JSON.stringify(details)).not.toContain('secret-key');expect(JSON.stringify(details)).toContain('file_save');
  expect(control.getPersistedMessage('bot','one')?.files?.[0]?.media?.aes_key).toBe('secret-key');
  await save.execute(owner,msg,()=>{});expect(download).toHaveBeenCalledTimes(1);
  const followup: InboundMessage = { id:'followup', channelMessageId:'followup', accountId:msg.accountId, peerId:msg.peerId, senderId:msg.senderId, receivedAt:new Date(), text:'帮我看一下这个简历' };
  control.ingestBatch({accountId:'bot',previousCursor:'1',nextCursor:'2',messages:[followup]});
  await worker.execute();
  expect(run).toHaveBeenCalledTimes(1);
  const context = run.mock.calls[0]?.[0].contextEvents;
  expect(context).toHaveLength(1);
  expect(context?.[0]?.content).toContain(file!.id);
  expect(context?.[0]?.content).toContain('已保存');
  expect(JSON.stringify(context)).not.toContain('secret-download-ref');
  const contextTurn = control.getRecentAgentTraces(100) as Array<{turnId:string}>;
  // The mock Agent does not create an invocation snapshot; query the known deterministic turn ID.
  expect(control.getSessionContextEvents('trn_bot_followup','b'.repeat(64))).toEqual([]);
  expect(contextTurn).toHaveLength(2);
  control.archiveActiveSession('bot','owner');
  const selected:string[]=[];const tools=createFileTools(repo,()=>subjectKey(permissions.context(msg,'new-session').subject),id=>selected.push(id));
  const listing=await tools[0]!.execute('list',{query:'resume'} as never,undefined,undefined,{} as never);expect(JSON.stringify(listing)).toContain(file!.id);
  await tools[1]!.execute('use',{fileId:file!.id} as never,undefined,undefined,{} as never);expect(selected).toEqual([file!.id]);
  const other=createFileTools(repo,()=> 'b'.repeat(64),()=>{throw Error('must not select');});
  expect(JSON.stringify(await other[0]!.execute('list',{} as never,undefined,undefined,{} as never))).not.toContain(file!.id);
  expect(()=>other[1]!.execute('use',{fileId:file!.id} as never,undefined,undefined,{} as never)).toThrow('找不到');
 });
 it('normalizes FILE without downloading and filters unauthorized senders before file work',async()=>{
  const {root,control}=await setup();const fetchMock=vi.fn<typeof fetch>(async()=>{await Promise.resolve();return new Response(JSON.stringify({get_updates_buf:'1',msgs:[{message_id:123,message_type:1,from_user_id:'stranger',item_list:[{type:4,file_item:{file_name:'resume.pdf',len:'10',media:{encrypt_query_param:'secret',aes_key:'key'}}}]}]}));});
  const client=new ILinkHttpClient({baseUrl:'https://ilinkai.weixin.qq.com',botToken:'test',mediaDir:root,fetch:fetchMock});const batch=await client.getUpdates('bot','',new AbortController().signal);
  expect(batch.messages[0]?.text).toBe('');expect(batch.messages[0]?.files?.[0]?.name).toBe('resume.pdf');expect(JSON.stringify(batch.messages[0]?.raw)).not.toContain('secret');expect(fetchMock).toHaveBeenCalledTimes(1);
  new IngestMessage(control,new ExactSenderPolicy('owner')).execute(batch);expect(control.claimNextTurn('w',1000)).toBeUndefined();expect(control.getCursor('bot')).toBe('1');
 });
 it('decrypts PDF bytes and rejects invalid, oversized and foreign CDN downloads',async()=>{
  const data=Buffer.from('%PDF-1.4\ntext');const key=Buffer.alloc(16,1);const cipher=createCipheriv('aes-128-ecb',key,null);const encrypted=Buffer.concat([cipher.update(data),cipher.final()]);
  const fetchMock=vi.fn<typeof fetch>(()=>Promise.resolve(new Response(encrypted)));const dl=new ILinkFileDownloader('https://novac2c.cdn.weixin.qq.com/c2c',fetchMock);
  expect(await dl.download({itemIndex:0,name:'a.pdf',media:{encrypt_query_param:'q',aes_key:key.toString('base64')}})).toEqual(data);
  await expect(dl.download({itemIndex:0,name:'a.pdf',media:{full_url:'https://example.com/a.pdf'}})).rejects.toThrow('下载');expect(fetchMock).toHaveBeenCalledTimes(1);
  await expect(dl.download({itemIndex:0,name:'a.pdf',declaredBytes:21*1024*1024})).rejects.toThrow('20 MiB');
  await expect(dl.download({itemIndex:0,name:'a.docx'})).rejects.toThrow('仅支持 PDF');
  const invalid=new ILinkFileDownloader('https://novac2c.cdn.weixin.qq.com/c2c',()=>Promise.resolve(new Response('not a pdf')));await expect(invalid.download({itemIndex:0,name:'a.pdf',media:{encrypt_query_param:'q'}})).rejects.toThrow('有效的 PDF');
 });
 it('reports failed download, retries deterministically, and detects changed originals',async()=>{
  const {root,repo,store}=await setup();const owner='a'.repeat(64);const msg=message();let fail=true;const save=new SaveInboundFiles(repo,store,{download:async()=>{await Promise.resolve();if(fail)throw Error('sensitive remote url');return Buffer.from('%PDF-1.4\nOK');}});
  const first=await save.execute(owner,msg,()=>{});expect(first.files[0]?.status).toBe('failed');expect(first.receipt).not.toContain('sensitive');fail=false;
  const second=await save.execute(owner,msg,()=>{});expect(second.files[0]?.id).toBe(first.files[0]?.id);expect(repo.list(owner)).toHaveLength(1);
  await writeFile(`${root}/files/${owner}/${second.files[0]!.id}/original.pdf`,'modified');await expect(store.read(second.files[0]!)).rejects.toThrow('校验');
 });
 it('replays only earlier receipts from the current session',async()=>{
  const {control,repo,store,permissions}=await setup();
  const first=message('first'),future=message('future');
  const question:InboundMessage={id:'question',channelMessageId:'question',accountId:'bot',peerId:'owner',senderId:'owner',text:'这个简历',receivedAt:new Date()};
  control.ingestBatch({accountId:'bot',previousCursor:'',nextCursor:'batch',messages:[first,question,future]});
  const save=new SaveInboundFiles(repo,store,{download:()=>Promise.resolve(Buffer.from('%PDF-1.4 fixture'))});
  const owner=subjectKey(permissions.context(first,'s').subject);
  const a=control.claimNextTurn('a',30000)!;
  const receipt=await save.execute(owner,first,()=>{});control.completeTurn({turnId:a.turn.id,finalResponse:receipt.receipt,chunks:[receipt.receipt]});
  const current=control.claimNextTurn('b',30000)!;
  expect(control.claimNextTurn('c',30000)).toBeUndefined();
  control.completeTurn({turnId:current.turn.id,finalResponse:'fixture question completed',chunks:[]});
  const later=control.claimNextTurn('c',30000)!;
  const laterReceipt=await save.execute(owner,future,()=>{});control.completeTurn({turnId:later.turn.id,finalResponse:laterReceipt.receipt,chunks:[laterReceipt.receipt]});
  const events=control.getSessionContextEvents(current.turn.id,owner);
  expect(events).toHaveLength(1);expect(events[0]?.content).toContain(receipt.files[0]!.id);expect(events[0]?.content).not.toContain(laterReceipt.files[0]!.id);
  control.archiveActiveSession('bot','owner');
  control.ingestBatch({accountId:'bot',previousCursor:'batch',nextCursor:'new',messages:[{...question,id:'new',channelMessageId:'new'}]});
  expect(control.getSessionContextEvents('trn_bot_new',owner)).toEqual([]);
 });

});

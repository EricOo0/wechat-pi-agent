import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { CodexFileUpload } from '../../../src/adapters/codex-files/codex-file-upload.js';
import { CodexFileInput } from '../../../src/adapters/codex-files/codex-file-input.js';
import { ModelFileInputRouter } from '../../../src/modules/artifacts/application/model-file-input-router.js';
import type { UserFileRepository } from '../../../src/modules/artifacts/ports/user-file-repository.js';
import type { ModelFileRef, UserFile } from '../../../src/modules/artifacts/domain/user-file.js';
import type { AgentEvent } from '../../../src/modules/observability/domain/step.js';
const model={api:'openai-codex-responses',provider:'openai-codex',id:'test',baseUrl:'https://chatgpt.com/backend-api'};
function fixture(){
 const data=Buffer.from('%PDF-1.4\nfixture');const file:UserFile={id:'fil_'+'1'.repeat(32),ownerId:'a'.repeat(64),name:'resume.pdf',messageId:'m',itemIndex:0,status:'ready',bytes:data.length,sha256:createHash('sha256').update(data).digest('hex'),mimeType:'application/pdf',createdAt:new Date().toISOString()};
 const refs=new Map<string,ModelFileRef>();const repository:UserFileRepository={save:()=>{},get:(owner,id)=>owner===file.ownerId&&id===file.id?file:undefined,list:()=>[file],usedBytes:()=>data.length,getModelRef:(id,scope)=>refs.get(id+scope),saveModelRef:r=>{refs.set(r.fileId+r.scope,r);},deleteModelRef:(id,scope)=>{refs.delete(id+scope);}};
 let account='account-one';let remoteMissing=false;let rejectStatus=0;const calls:Array<{path:string;method:string;body:unknown;hasAuth:boolean}>=[];
 const fetchMock=vi.fn<typeof fetch>(async(input,init)=>{
  await Promise.resolve();
  const url=new URL(typeof input === "string" ? input : input instanceof URL ? input : input.url);calls.push({path:url.pathname,method:init?.method??'GET',body:typeof init?.body==='string'?JSON.parse(init.body) as unknown:null,hasAuth:new Headers(init?.headers).has('Authorization')});
  if(rejectStatus)return new Response('https://private.example/?secret=credential',{status:rejectStatus});
  if(url.pathname==='/backend-api/files')return Response.json({file_id:'file_123',upload_url:'https://test.oaiusercontent.com/upload?sig=secret'});
  if(init?.method==='PUT')return new Response(null,{status:201});
  if(remoteMissing){remoteMissing=false;return new Response(null,{status:404});}
  return Response.json({status:'success',download_url:'https://test.oaiusercontent.com/download?sig=secret&se='+encodeURIComponent(new Date(Date.now()+300000).toISOString())});
 });
 const auth=()=>Promise.resolve({apiKey:'x.'+Buffer.from(JSON.stringify({'https://api.openai.com/auth':{chatgpt_account_id:account}})).toString('base64url')+'.x'});
 const storage={save:async()=>{},read:vi.fn(()=>Promise.resolve(data))};
 const make=()=>new CodexFileUpload(repository,storage,auth,fetchMock);const events:AgentEvent[]=[];
 return {file,repository,make,events,calls,storage,fetchMock,setAccount:(v:string)=>{account=v;},missing:()=>{remoteMissing=true;},reject:(status:number)=>{rejectStatus=status;}};
}
describe('Codex file transport and input',()=>{
 it('uploads once, reuses short-lived link, and refreshes a persisted remote reference after restart',async()=>{
  const f=fixture();const uploads=f.make();const emit=(e:AgentEvent)=>f.events.push(e);
  const first=await uploads.prepare(f.file,emit);expect(await uploads.prepare(f.file,emit)).toBe(first);
  expect(f.calls.map(c=>c.method)).toEqual(['POST','PUT','POST']);expect(f.calls[1]?.hasAuth).toBe(false);
  await f.make().prepare(f.file,emit);expect(f.calls.at(-1)?.path).toContain('/file_123/uploaded');expect(f.calls.filter(c=>c.path==='/backend-api/files')).toHaveLength(1);
  expect(JSON.stringify(f.events)).not.toContain('sig=secret');expect(JSON.stringify(f.events)).not.toContain('apiKey');expect(f.events.at(-1)?.data?.reused).toBe(true);
 });
 it('reuploads an unavailable remote file and separates authenticated remote stores',async()=>{
  const f=fixture();await f.make().prepare(f.file,()=>{});f.missing();await f.make().prepare(f.file,()=>{});
  expect(f.calls.filter(c=>c.path==='/backend-api/files')).toHaveLength(2);
  f.setAccount('other-account');await f.make().prepare(f.file,()=>{});expect(f.calls.filter(c=>c.path==='/backend-api/files')).toHaveLength(3);
 });
 it('does not turn authentication failures into reuploads and hides signed endpoints in errors',async()=>{
  const f=fixture();await f.make().prepare(f.file,()=>{});f.reject(401);
  await expect(f.make().prepare(f.file,()=>{})).rejects.toMatchObject({code:'FILE_AUTH_FAILED'});
  expect(f.calls.filter(c=>c.path==='/backend-api/files')).toHaveLength(1);
  try{await f.make().prepare(f.file,()=>{});}catch(error){expect(String(error)).not.toContain('credential');}
 });
 it('injects only authorized selected files without mutating the base history or leaking URL to traces',async()=>{
  const f=fixture();const router=new ModelFileInputRouter(new CodexFileInput(f.repository,f.make()));const original={input:[{role:'user',content:[{type:'input_text',text:'Review my resume'}]}],store:false};
  const output=await router.apply(original,model,{ownerId:f.file.ownerId,fileIds:[f.file.id],emit:e=>f.events.push(e)}) as {input:Array<{content:Array<{type:string;file_url?:string}>}>};
  expect(output.input).toHaveLength(2);expect(output.input[1]?.content[1]?.type).toBe('input_file');expect(output.input[1]?.content[1]?.file_url).toContain('download');expect(original.input).toHaveLength(1);expect(JSON.stringify(f.events)).not.toContain('sig=');
  await expect(router.apply(original,model,{ownerId:'other',fileIds:[f.file.id],emit:()=>{}})).rejects.toMatchObject({code:'FILE_NOT_FOUND'});
 });
 it('passes text-only requests unchanged and rejects unimplemented file protocols before I/O',async()=>{
  const f=fixture();const router=new ModelFileInputRouter(new CodexFileInput(f.repository,f.make()));const body={input:[]};const unsupported={...model,api:'anthropic-messages',provider:'anthropic'};
  expect(await router.apply(body,unsupported,{ownerId:f.file.ownerId,fileIds:[],emit:()=>{}})).toBe(body);
  await expect(router.apply(body,unsupported,{ownerId:f.file.ownerId,fileIds:[f.file.id],emit:()=>{}})).rejects.toMatchObject({code:'FILE_INPUT_UNSUPPORTED'});expect(f.fetchMock).not.toHaveBeenCalled();
 });
 it('coalesces concurrent uploads of the same original',async()=>{
  const f=fixture();const uploads=f.make();await Promise.all([uploads.prepare(f.file,()=>{}),uploads.prepare(f.file,()=>{})]);expect(f.calls.filter(c=>c.path==='/backend-api/files')).toHaveLength(1);
 });
});

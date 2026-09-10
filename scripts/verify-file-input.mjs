// Opt-in live verification with an artificial PDF. No user documents are read.
import { mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { SqliteControlPlane } from '../dist/adapters/sqlite/sqlite-control-plane.js';
import { SqliteUserFileRepository } from '../dist/adapters/sqlite/sqlite-user-file-repository.js';
import { SqlitePermissionRepository } from '../dist/adapters/sqlite/sqlite-permission-repository.js';
import { LocalFileStorage } from '../dist/adapters/filesystem/local-file-storage.js';
import { SaveInboundFiles } from '../dist/modules/artifacts/application/workflows/save-inbound-files.js';
import { PermissionService } from '../dist/modules/permissions/application/permission-service.js';
import { LocalSandboxExecutor } from '../dist/adapters/sandbox/local-sandbox-executor.js';
import { PiAgentGateway } from '../dist/adapters/pi/pi-agent-gateway.js';
import { principalId, subjectKey } from '../dist/modules/permissions/domain/permissions.js';
import { RunNextTurn } from '../dist/modules/turns/application/workflows/run-next-turn.js';
import { ReplyChunker } from '../dist/modules/messaging/domain/reply-chunker.js';
import { DryRunChannel } from '../dist/adapters/dry-run/dry-run-channel.js';
if (!process.argv.includes('--live')) throw Error('Use --live to authorize a synthetic PDF upload and two model requests using the configured Codex account.');
const settings=JSON.parse(await readFile('data/settings.json','utf8'));
const root=await realpath(await mkdtemp('/tmp/file-gateway-live-'));
const control=new SqliteControlPlane(root+'/app.db');control.migrate();
const repo=new SqliteUserFileRepository(root+'/app.db');const storage=new LocalFileStorage(root+'/files');const permissionsRepo=new SqlitePermissionRepository(root+'/permissions.db');const executor=new LocalSandboxExecutor();
const permissions=new PermissionService(permissionsRepo,{executorId:'probe-machine',workspaceId:root,ownerPrincipalId:principalId('probe','owner'),protectedPaths:[root+'/files']});
const marker='GATEWAY_'+randomBytes(6).toString('hex');
const stream=`BT /F1 18 Tf 40 100 Td (${marker}) Tj ET`;
const objects=['<< /Type /Catalog /Pages 2 0 R >>','<< /Type /Pages /Kids [3 0 R] /Count 1 >>','<< /Type /Page /Parent 2 0 R /MediaBox [0 0 400 200] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>','<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',`<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`];
let pdf='%PDF-1.4\n';const offsets=[];objects.forEach((o,i)=>{offsets.push(Buffer.byteLength(pdf));pdf+=`${i+1} 0 obj\n${o}\nendobj\n`;});const xref=Buffer.byteLength(pdf);pdf+='xref\n0 6\n0000000000 65535 f \n'+offsets.map(x=>String(x).padStart(10,'0')+' 00000 n \n').join('')+`trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
const message={id:'probe',accountId:'probe',channelMessageId:'probe',peerId:'owner',senderId:'owner',text:'',receivedAt:new Date(),files:[{itemIndex:0,name:'gateway-verification.pdf'}]};
const saveFiles=new SaveInboundFiles(repo,storage,{download:async()=>Buffer.from(pdf)});
control.ingestBatch({accountId:'probe',previousCursor:'',nextCursor:'upload',messages:[message]});
let gateway;const results=[];
try {
 gateway=await PiAgentGateway.create({cwd:root,provider:settings.piProvider,modelId:settings.piModelId,thinkingLevel:'low',authPath:homedir()+'/.pi/agent/auth.json',modelsStorePath:homedir()+'/.pi/agent/models.json',sessionDir:root+'/sessions',systemPromptPath:process.cwd()+'/src/prompts/wechat-assistant.md',loadLocalSkills:false,toolSandboxRoot:root+'/workspace',permissions,executor,deniedPaths:[root+'/files'],protectedWritePaths:[],deniedNetworkPorts:[],files:{repository:repo,storage}});
 const worker=new RunNextTurn(control,gateway,new DryRunChannel(),new ReplyChunker(),{ownerId:'live-test',leaseMs:180000},undefined,undefined,permissions,saveFiles);
 const receipt=await worker.execute();
 if(receipt.status!=='completed'||!receipt.finalResponse.includes('已保存'))throw Error('Upload receipt failed');
 const uploadTrace=control.getTurnDetails(receipt.turnId);
 const immediate=uploadTrace.steps.find(e=>e.event_type==='context_update'&&e.eventData?.status==='succeeded');
 if(!immediate||uploadTrace.steps.some(e=>e.event_type==='model_start'))throw Error('Upload must update context immediately without inference');
 results.push({stage:'upload',immediateContext:true,modelCalls:0});
 const savedFile=repo.list(subjectKey(permissions.context(message,'ignored').subject))[0];
 let cursor='upload';
 for (const id of ['one','two']) {
  if(id==='two')control.archiveActiveSession('probe','owner');
  const question={id,accountId:'probe',channelMessageId:id,peerId:'owner',senderId:'owner',text:id==='one'?'帮我看一下刚才这个文档，只返回页面中的英文标记。':'请查询文件库里的 gateway-verification.pdf，只返回文档中的英文标记。',receivedAt:new Date()};
  control.ingestBatch({accountId:'probe',previousCursor:cursor,nextCursor:id,messages:[question]});cursor=id;
  const result=await worker.execute(AbortSignal.timeout(120000));
  if(result.status!=='completed')throw Error('Model turn failed');
  const detail=control.getTurnDetails(result.turnId);
  const history=detail.session.piSessionFile?await readFile(detail.session.piSessionFile,'utf8'):'';
  const requests=detail.steps.filter(e=>e.event_type==='model_request');
  const responses=detail.steps.filter(e=>e.event_type==='model_end');
  if(requests.length<1||responses.length<1||!JSON.stringify(requests).includes('input_file'))throw Error('Actual model context/output trace missing');
  const summary={modelCalls:responses.length,requestSnapshots:requests.length,session:id,output:result.finalResponse,markerMatched:result.finalResponse.trim()===marker,
   fileEvents:detail.steps.filter(e=>e.event_type.startsWith('file_')||e.event_type==='context_replay'||e.event_type==='context_update').map(e=>({type:e.event_type,data:e.eventData})),
   contextReceiptPresent:history.includes('application_context')&&history.includes(savedFile.id),historyHasSignedUrl:/file_url|oaiusercontent\.com|sig=/.test(history)};
  if(process.env.FILE_TRACE_PREVIEW_OUTPUT)await writeFile(process.env.FILE_TRACE_PREVIEW_OUTPUT,JSON.stringify({trace:control.getAgentTrace(result.turnId),details:detail}));
  results.push(summary);console.log(JSON.stringify(summary));
  if(!summary.markerMatched||summary.historyHasSignedUrl||(id==='one'&&!summary.contextReceiptPresent))throw Error('Gateway verification failed');
 }
 await writeFile('docs/specs/pdf-attachments/evidence/gateway-verification.json',JSON.stringify({testedAt:new Date().toISOString(),model:settings.piModelId,synthetic:true,results},null,2)+'\n');
} finally { gateway?.dispose();executor.close();repo.close();control.close();permissionsRepo.close();await rm(root,{recursive:true,force:true}); }

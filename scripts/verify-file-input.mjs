// Opt-in live verification with an artificial PDF. No user documents are read.
import { mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { SqliteControlPlane } from '../dist/adapters/outbound/sqlite/sqlite-control-plane.js';
import { SqliteUserFileRepository } from '../dist/adapters/outbound/sqlite/sqlite-user-file-repository.js';
import { SqlitePermissionRepository } from '../dist/adapters/outbound/sqlite/sqlite-permission-repository.js';
import { LocalFileStorage } from '../dist/adapters/outbound/filesystem/local-file-storage.js';
import { SaveInboundFiles } from '../dist/application/use-cases/save-inbound-files.js';
import { PermissionService } from '../dist/application/services/permission-service.js';
import { LocalSandboxExecutor } from '../dist/adapters/outbound/sandbox/local-sandbox-executor.js';
import { PiAgentGateway } from '../dist/adapters/outbound/pi/pi-agent-gateway.js';
import { principalId, subjectKey } from '../dist/domain/policy/permissions.js';
import { fileSummary } from '../dist/domain/files/user-file.js';
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
const saved=await new SaveInboundFiles(repo,storage,{download:async()=>Buffer.from(pdf)}).execute(subjectKey(permissions.context(message,'one').subject),message,()=>{});
let gateway;const results=[];
try {
 gateway=await PiAgentGateway.create({cwd:root,provider:settings.piProvider,modelId:settings.piModelId,thinkingLevel:'low',authPath:homedir()+'/.pi/agent/auth.json',modelsStorePath:homedir()+'/.pi/agent/models.json',sessionDir:root+'/sessions',systemPromptPath:process.cwd()+'/src/prompts/wechat-assistant.md',loadLocalSkills:false,toolSandboxRoot:root+'/workspace',permissions,executor,deniedPaths:[root+'/files'],protectedWritePaths:[],deniedNetworkPorts:[],files:{repository:repo,storage}});
 for (const id of ['one','two']) {
  const events=[];const request={session:{id,key:id,accountId:'probe',peerId:'owner',status:'ACTIVE',createdAt:new Date(),updatedAt:new Date()},prompt:id==='one'?'请使用 file_use 读取这次上传的 PDF，只返回页面中的英文标记，不要解释。':'请用 file_list 查询我的文件库，找到 gateway-verification.pdf，使用 file_use 读取，只返回文档中的英文标记。',permissionContext:permissions.context(message,id,'turn-'+id),signal:AbortSignal.timeout(120000),onEvent:e=>{if(e.type.startsWith('file_'))events.push(e);},...(id==='one'?{files:saved.files.map(fileSummary)}:{})};
  const result=await gateway.runTurn(request);
  const history=result.piSessionFile?await readFile(result.piSessionFile,'utf8'):'';
  const summary={session:id,output:result.text,markerMatched:result.text.trim()===marker,fileEvents:events,historyHasSignedUrl:/file_url|oaiusercontent\.com|sig=/.test(history)};
  results.push(summary);console.log(JSON.stringify(summary));
  if(!summary.markerMatched||summary.historyHasSignedUrl)throw Error('Gateway verification failed');
 }
 await writeFile('docs/designs/pdf-attachments/gateway-verification.json',JSON.stringify({testedAt:new Date().toISOString(),model:settings.piModelId,synthetic:true,results},null,2)+'\n');
} finally { gateway?.dispose();executor.close();repo.close();control.close();permissionsRepo.close();await rm(root,{recursive:true,force:true}); }

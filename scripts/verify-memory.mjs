// Opt-in, isolated synthetic-data verification. Never reads real conversation records.
import { mkdtemp, realpath, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { randomBytes } from 'node:crypto';
import { SqliteControlPlane } from '../dist/adapters/sqlite/sqlite-control-plane.js';
import { SqlitePermissionRepository } from '../dist/adapters/sqlite/sqlite-permission-repository.js';
import { SqliteMemoryJobRepository } from '../dist/adapters/sqlite/sqlite-memory-job-repository.js';
import { MarkdownMemoryStore } from '../dist/adapters/filesystem/markdown-memory-store.js';
import { PermissionService } from '../dist/modules/permissions/application/permission-service.js';
import { UserMemoryService } from '../dist/modules/memory/application/user-memory-service.js';
import { EndSession } from '../dist/modules/conversation/application/workflows/end-session.js';
import { GenerateSessionMemory } from '../dist/modules/memory/application/workflows/generate-session-memory.js';
import { PiMemoryGenerator } from '../dist/adapters/pi/pi-memory-generator.js';
import { PiAgentGateway } from '../dist/adapters/pi/pi-agent-gateway.js';
import { LocalSandboxExecutor } from '../dist/adapters/sandbox/local-sandbox-executor.js';
import { principalId } from '../dist/modules/permissions/domain/permissions.js';
if(!process.argv.includes('--live'))throw Error('Use --live for synthetic memory extraction, consolidation and recall using the configured model.');
const config=JSON.parse(await readFile('data/settings.json','utf8'));const root=await realpath(await mkdtemp('/tmp/memory-live-'));const marker='MEMORY_VERIFY_'+randomBytes(5).toString('hex');
const control=new SqliteControlPlane(root+'/app.db');control.migrate();const jobs=new SqliteMemoryJobRepository(root+'/app.db');const pstore=new SqlitePermissionRepository(root+'/permissions.db');const store=new MarkdownMemoryStore(root+'/memory');
const permissions=new PermissionService(pstore,{executorId:'test',workspaceId:root,ownerPrincipalId:principalId('test','user'),protectedPaths:[root+'/memory']});const executor=new LocalSandboxExecutor();let gateway;
try {
 const message={id:'source',accountId:'test',channelMessageId:'source',senderId:'user',peerId:'user',text:`我的项目代号是 ${marker}。以后请用中文简洁回答，讨论项目时沿用这个代号。`,receivedAt:new Date()};control.ingestBatch({accountId:'test',previousCursor:'',nextCursor:'1',messages:[message]});const c=control.claimNextTurn('test',30000);control.completeTurn({turnId:c.turn.id,finalResponse:'了解你的项目代号与表达偏好。',chunks:['了解']});new EndSession(control,permissions).execute(c.session.id,'manual');
 const job=jobs.claim('test-memory');const generator=await PiMemoryGenerator.create({provider:config.piProvider,modelId:config.piModelId,authPath:homedir()+'/.pi/agent/auth.json',modelsStorePath:homedir()+'/.pi/agent/models.json'});
 await new GenerateSessionMemory(jobs,store,generator).execute(job,AbortSignal.timeout(180000));
 const overview=store.overview(job.ownerId);if(!overview.content.includes(marker))throw Error('Consolidated overview did not preserve the explicit project code');
 gateway=await PiAgentGateway.create({cwd:root,provider:config.piProvider,modelId:config.piModelId,thinkingLevel:'low',authPath:homedir()+'/.pi/agent/auth.json',modelsStorePath:homedir()+'/.pi/agent/models.json',sessionDir:root+'/pi-sessions',systemPromptPath:process.cwd()+'/src/prompts/wechat-assistant.md',loadLocalSkills:false,toolSandboxRoot:root+'/workspaces',permissions,executor,deniedPaths:[root+'/memory'],protectedWritePaths:[],deniedNetworkPorts:[],memory:new UserMemoryService(store)});
 const events=[];const result=await gateway.runTurn({session:{id:'new-session',key:'new-session',accountId:'test',peerId:'user',status:'ACTIVE',createdAt:new Date(),updatedAt:new Date()},permissionContext:permissions.context(message,'new-session'),prompt:'我们的项目代号是什么？只返回代号。',signal:AbortSignal.timeout(120000),onEvent:e=>{if(e.type==='memory_load')events.push(e);}});
 const report={testedAt:new Date().toISOString(),synthetic:true,model:config.piModelId,phase:jobs.details(job.id).job.phase,detailId:job.detailId,overview:overview.content,revision:overview.revision,recall:result.text,markerMatched:result.text.includes(marker),memoryLoad:events};
 if(!report.markerMatched)throw Error('New-session memory recall failed');
 await writeFile('docs/memory-verification.json',JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));
 if(process.env.MEMORY_TRACE_PREVIEW_OUTPUT)await writeFile(process.env.MEMORY_TRACE_PREVIEW_OUTPUT,JSON.stringify(jobs.details(job.id)));
}finally{gateway?.dispose();executor.close();jobs.close();control.close();pstore.close();await rm(root,{recursive:true,force:true});}

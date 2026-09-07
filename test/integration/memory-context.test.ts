import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createAgentSession, DefaultResourceLoader, ModelRuntime, SessionManager, SettingsManager } from '@earendil-works/pi-coding-agent';
import type { AssistantMessage } from '@earendil-works/pi-ai';
import { MarkdownMemoryStore } from '../../src/adapters/outbound/filesystem/markdown-memory-store.js';
import { UserMemoryService } from '../../src/application/services/user-memory-service.js';
import { pinUserMemory } from '../../src/adapters/outbound/pi/user-memory-context.js';
import { createMemoryTools } from '../../src/adapters/outbound/pi/tools/memory-tools.js';
it('pins the overview across compaction and restoration, while new sessions load the latest version',async()=>{
 const root=await realpath(await mkdtemp('/tmp/memory-context-'));const owner='a'.repeat(64);const store=new MarkdownMemoryStore(root+'/memory');const memory=new UserMemoryService(store);
 const runtime=await ModelRuntime.create({authPath:root+'/auth.json',modelsStorePath:root+'/models.json',allowModelNetwork:false,refreshOnCreate:false});const model=runtime.getModels('openai-codex')[0]!;
 const loader=new DefaultResourceLoader({cwd:root,agentDir:root,settingsManager:SettingsManager.inMemory(),systemPrompt:'You are a fixture assistant for user memory tests.',noSkills:true,noExtensions:true,noContextFiles:true,noPromptTemplates:true,noThemes:true});await loader.reload();
 const create=async(manager:SessionManager)=>(await createAgentSession({cwd:root,model,modelRuntime:runtime,sessionManager:manager,resourceLoader:loader,tools:[]})).session;
 const manager=SessionManager.create(root,root+'/sessions');const first=await create(manager);let second:Awaited<ReturnType<typeof create>>|undefined,restored:Awaited<ReturnType<typeof create>>|undefined;
 try {
  store.write(owner,'MEMORY.md','# 用户记忆\n偏好简洁');await pinUserMemory(first,manager,owner,memory,()=>{});
  store.write(owner,'MEMORY.md','# 用户记忆\n新的总览');
  expect(JSON.stringify(await first.agent.transformContext!([]))).toContain('偏好简洁');expect(JSON.stringify(await first.agent.transformContext!([]))).not.toContain('新的总览');
  manager.appendMessage({role:'assistant',content:[{type:'text',text:'fixture reply'}],api:model.api,provider:model.provider,model:model.id,stopReason:'stop',timestamp:Date.now(),usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}} satisfies AssistantMessage);
  const reopened=SessionManager.open(manager.getSessionFile()!,root+'/sessions',root);restored=await create(reopened);await pinUserMemory(restored,reopened,owner,memory,()=>{});
  expect(JSON.stringify(await restored.agent.transformContext!([]))).toContain('偏好简洁');
  const fresh=SessionManager.create(root,root+'/sessions');second=await create(fresh);await pinUserMemory(second,fresh,owner,memory,()=>{});expect(JSON.stringify(await second.agent.transformContext!([]))).toContain('新的总览');
  const tools=createMemoryTools(memory,()=>owner);const result=await tools[0]!.execute('search',{query:'总览'} as never,undefined,undefined,{} as never);expect(JSON.stringify(result)).toContain('MEMORY.md');
  expect(()=>tools[1]!.execute('read',{memoryId:'../MEMORY.md'} as never,undefined,undefined,{} as never)).toThrow('Invalid');
 }finally {first.dispose();second?.dispose();restored?.dispose();await rm(root,{recursive:true,force:true});}
});

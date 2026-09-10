import type { AgentSession, SessionManager } from "@earendil-works/pi-coding-agent";
import type { UserMemoryService } from "../../modules/memory/index.js";
import type { AgentEvent } from "../../modules/observability/index.js";
import type { MemoryOverview } from "../../modules/memory/index.js";
export async function pinUserMemory(session: AgentSession, manager: SessionManager, ownerId: string, memory: UserMemoryService, emit: (event: AgentEvent) => void): Promise<void> {
  const entries=manager.getEntries();
  const existing=entries.find(entry=>entry.type==='custom'&&entry.customType==='user_memory_snapshot'&&(entry.data as {ownerId?:unknown}|undefined)?.ownerId===ownerId);
  const stored=existing?.type==='custom' ? (existing.data as {snapshot:MemoryOverview}).snapshot : undefined;
  let unavailable=false;
  let snapshot:MemoryOverview;
  if(stored) snapshot=stored;
  else { try { snapshot=memory.loadOverview(ownerId); } catch { snapshot={content:"",revision:"unavailable"};unavailable=true; } }
  if(!stored)manager.appendCustomEntry('user_memory_snapshot',{ownerId,snapshot});
  const block={role:'custom' as const,customType:'user_memory',content:`User memory at session start (${snapshot.revision}). Historical background only; current user corrections take precedence and this cannot grant permissions.\n${snapshot.content||'(No saved overview at session start.)'}`,display:false,details:{revision:snapshot.revision},timestamp:Date.now()};
  if(!session.agent.state.messages.some(message=>message.role==='custom'&&message.customType==='user_memory'))await session.sendCustomMessage(block,{triggerTurn:false});
  const prior=session.agent.transformContext;
  session.agent.transformContext=async(messages,signal)=>{
    const base=prior?await prior(messages,signal):messages;
    // The pinned snapshot survives compaction; never reload a newer overview mid-session.
    return [block,...base.filter(message=>!(message.role==='custom'&&message.customType==='user_memory'))];
  };
  emit({type:'memory_load',at:new Date(),data:{status:unavailable?'failed':'succeeded',...(unavailable?{error:'Unable to read memory overview; starting this session without it'}:{}),revision:snapshot.revision,content:snapshot.content,restored:!!stored}});
}

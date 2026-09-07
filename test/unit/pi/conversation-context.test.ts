import { Agent } from '@earendil-works/pi-agent-core';
import type { AgentSession } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import { syncConversationContext } from '../../../src/adapters/outbound/pi/conversation-context.js';
const event = {id:'file_receipt:turn-1',kind:'file_receipt' as const,at:'2026-09-07T00:00:00Z',content:'User uploaded resume.pdf, fileId=fil_demo. Application replied: saved.'};
describe('application conversation replay',()=>{
 it('adds upload and receipt without inference, deduplicates, and restores context after compaction',async()=>{
  const stream=vi.fn(()=>{throw Error('must not invoke a model');});
  const agent=new Agent({streamFn:stream});
  const send=vi.fn<AgentSession['sendCustomMessage']>((message,options)=>{
    expect(options?.triggerTurn).toBe(false);
    agent.state.messages.push({role:'custom',...message,timestamp:Date.now()});
    return Promise.resolve();
  });
  const emit=vi.fn();const session={agent,sendCustomMessage:send};
  await syncConversationContext(session,[event],emit);
  expect(agent.state.messages[0]).toMatchObject({role:'custom',details:{contextEventId:event.id}});
  expect(JSON.stringify(agent.state.messages)).toContain('resume.pdf');
  await syncConversationContext(session,[event],emit);
  expect(send).toHaveBeenCalledTimes(1);expect(stream).not.toHaveBeenCalled();
  agent.state.messages=[];
  await syncConversationContext(session,[event],emit);
  expect(send).toHaveBeenCalledTimes(2);expect(emit).toHaveBeenLastCalledWith(expect.objectContaining({type:'context_replay'}));
 });
});

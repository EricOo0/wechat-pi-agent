import { createAssistantMessageEventStream, type AssistantMessage, type Model, type Api } from '@earendil-works/pi-ai';
import type { StreamFn } from '@earendil-works/pi-agent-core';
import { describe, expect, it } from 'vitest';
import { traceModelCalls } from '../../../src/adapters/pi/model-call-trace.js';
import { traceSnapshot } from '../../../src/modules/observability/application/trace-snapshot.js';
import type { AgentEvent } from '../../../src/modules/observability/domain/step.js';
const model={id:'test-model',provider:'test',api:'openai-responses'} as Model<Api>;
const answer:AssistantMessage={role:'assistant',content:[{type:'thinking',thinking:'Returned reasoning summary',thinkingSignature:'opaque-secret'},{type:'text',text:'Answer'},{type:'toolCall',id:'call-1',name:'read',arguments:{path:'/demo'}}],api:'openai-responses',provider:'test',model:'test-model',stopReason:'toolUse',timestamp:0,usage:{input:10,output:5,cacheRead:0,cacheWrite:0,totalTokens:15,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
describe('model round trace',()=>{
 it('captures final post-hook input, returned reasoning, tool calls and usage without changing the request',async()=>{
  const events:AgentEvent[]=[];let sent:unknown;
  const base:StreamFn=async(m,_c,options)=>{
   sent=await options?.onPayload?.({input:[]},m);
   const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:'toolUse',message:answer});stream.end();return stream;
  };
  const wrapped=traceModelCalls(base,e=>events.push(e));
  const stream=await wrapped(model,{systemPrompt:'real system',messages:[{role:'user',content:'read the PDF',timestamp:0}]},{onPayload:()=>({input:[{role:'user',content:[{type:'input_file',file_url:'https://x.oaiusercontent.com/pdf?sig=SECRET'}]}]})});
  for await(const event of stream){expect(event.type).toBe('done');}
  expect(events.map(e=>e.type)).toEqual(['model_start','model_request','model_end']);
  expect(new Set(events.map(e=>e.data?.modelCallId)).size).toBe(1);
  expect(JSON.stringify(sent)).toContain('sig=SECRET');expect(JSON.stringify(events)).not.toContain('sig=SECRET');expect(JSON.stringify(events)).not.toContain('opaque-secret');
  expect(JSON.stringify(events)).toContain('Returned reasoning summary');expect(JSON.stringify(events)).toContain('call-1');expect(events.at(-1)?.data?.usage).toEqual(answer.usage);
 });
 it('records failures before a stream exists',async()=>{
  const events:AgentEvent[]=[];const call=traceModelCalls(()=>{throw Error('request unavailable');},e=>events.push(e));
  await expect(call(model,{messages:[]})).rejects.toThrow('request unavailable');expect(events.at(-1)?.data?.status).toBe('failed');
 });
 it('preserves ordinary long text while marking binary and oversized snapshots',()=>{
  const text='x'.repeat(12000);const shared={text:'repeated'};const value=traceSnapshot({text,image:{type:'image',mimeType:'image/png',data:'binary'},shared,again:shared,inlineData:{mimeType:"image/png",data:"google-binary"}});
  expect(value).toMatchObject({text,shared:{text:'repeated'},again:{text:'repeated'}});expect(JSON.stringify(value)).not.toContain('"data":"binary"');expect(JSON.stringify(value)).not.toContain('google-binary');
  expect(traceSnapshot('x'.repeat(1000001))).toMatchObject({truncated:true,originalCharacters:1000001});
 });
});

it('captures final output when a consumer uses result() without iterating',async()=>{
 const events:AgentEvent[]=[];
 const base:StreamFn=()=>{const stream=createAssistantMessageEventStream();stream.push({type:'done',reason:'toolUse',message:answer});stream.end();return stream;};
 const stream=await traceModelCalls(base,e=>events.push(e))(model,{messages:[]});
 await stream.result();
 for await(const ignored of stream){void ignored;}
 expect(events.filter(e=>e.type==='model_end')).toHaveLength(1);
});

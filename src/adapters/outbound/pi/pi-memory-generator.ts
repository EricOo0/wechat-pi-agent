import { readFile } from "node:fs/promises";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../../domain/execution/step.js";
import type { ExtractedMemory, SessionMemorySource } from "../../../domain/memory/user-memory.js";
import type { MemoryGenerator } from "../../../application/interfaces/memory-generator.js";
import { traceModelCalls } from "./model-call-trace.js";
import { traceSnapshot } from "./trace-snapshot.js";
export class PiMemoryGenerator implements MemoryGenerator {
  private constructor(private readonly runtime: ModelRuntime, private readonly provider: string, private readonly modelId: string,
    private readonly extractPrompt: string, private readonly mergePrompt: string) {}
  public static async create(options:{provider:string;modelId:string;authPath:string;modelsStorePath:string}):Promise<PiMemoryGenerator>{
    const runtime=await ModelRuntime.create({authPath:options.authPath,modelsStorePath:options.modelsStorePath,allowModelNetwork:false,refreshOnCreate:false});
    const [extract,merge]=await Promise.all([readFile(new URL('../../../prompts/memory-extract.md',import.meta.url),'utf8'),readFile(new URL('../../../prompts/memory-merge.md',import.meta.url),'utf8')]);
    return new PiMemoryGenerator(runtime,options.provider,options.modelId,extract,merge);
  }
  public async extract(source:SessionMemorySource,emit:(event:AgentEvent)=>void,signal:AbortSignal):Promise<ExtractedMemory>{
    const bounded={...source,turns:[...source.turns]};
    while(JSON.stringify(bounded).length>160_000&&bounded.turns.length>1){bounded.turns.shift();bounded.truncated=true;}
    const parsed=await this.generate(this.extractPrompt,bounded,emit,signal);
    if(typeof parsed.content!=='string'||!parsed.content.trim()||parsed.content.length>50_000||typeof parsed.shouldMerge!=='boolean')throw new Error('Invalid memory extraction result');
    return {content:redactMemorySecrets(parsed.content),shouldMerge:parsed.shouldMerge};
  }
  public async merge(overview:string,detail:string,detailId:string,emit:(event:AgentEvent)=>void,signal:AbortSignal):Promise<string>{
    const parsed=await this.generate(this.mergePrompt,{overview,detail,detailId},emit,signal);
    if(typeof parsed.content!=='string'||!parsed.content.trim()||parsed.content.length>5500)throw new Error('Memory overview must contain at most 5500 characters');
    return redactMemorySecrets(parsed.content);
  }
  private async generate(systemPrompt:string,input:unknown,emit:(event:AgentEvent)=>void,signal:AbortSignal):Promise<Record<string,unknown>>{
    const model=this.runtime.getModel(this.provider,this.modelId);if(!model)throw new Error('Memory model is not available');
    const stream=traceModelCalls((m,c,o)=>this.runtime.streamSimple(m,c,{...o,reasoning:'low',maxRetries:0}),emit);
    const response=await (await stream(model,{systemPrompt,messages:[{role:'user',content:redactMemorySecrets(JSON.stringify(traceSnapshot(input))),timestamp:Date.now()}],tools:[]},{signal:AbortSignal.any([signal,AbortSignal.timeout(120_000)])})).result();
    if(response.stopReason==='error'||response.stopReason==='aborted')throw new Error('Memory model request failed');
    const text=response.content.filter(part=>part.type==='text').map(part=>part.text).join('');
    return JSON.parse(redactMemorySecrets(text).trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')) as Record<string,unknown>;
  }
}
export function redactMemorySecrets(text:string):string {
  return text.replace(/((?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|secret|aes_key|token)[\\"\s]*[:=][\\"\s]*)([A-Za-z0-9._~+/=-]{8,})/gi,'$1[redacted]')
    .replace(/Bearer\s+[a-zA-Z0-9._~+/-]+/gi,'Bearer [redacted]')
    .replace(/\bsk-[a-zA-Z0-9_-]{8,}\b/g,'[redacted key]')
    .replace(/\beyJ[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]{15,}\.[a-zA-Z0-9_-]+/g,'[redacted token]')
    .replace(/https?:\/\/[^\s"<>\\]*\?[^\s"<>\\]*/g,'[signed URL redacted]');
}

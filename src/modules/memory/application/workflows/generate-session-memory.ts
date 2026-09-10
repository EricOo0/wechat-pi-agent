import type { MemoryJobRepository } from "../../ports/memory-job-repository.js";
import type { MemoryStore } from "../../ports/memory-store.js";
import type { MemoryGenerator } from "../../ports/memory-generator.js";
import type { MemoryJob } from "../../domain/memory-job.js";
export class GenerateSessionMemory {
  public constructor(private readonly jobs: MemoryJobRepository, private readonly store: MemoryStore, private readonly generator: MemoryGenerator) {}
  public async execute(job: MemoryJob, signal: AbortSignal): Promise<void> {
    if (this.generator.withTask) {
      let entered = false;
      try { return await this.generator.withTask(job.ownerId, `memory:${job.id}`, signal,
        generator => { entered = true; return new GenerateSessionMemory(this.jobs, this.store, generator).execute(job, signal); }); }
      catch (error) { if (!entered) this.jobs.fail(job, "Memory model binding or authentication is unavailable"); throw error; }
    }
    const emit = (event: Parameters<MemoryJobRepository['appendEvent']>[1]) => this.jobs.appendEvent(job.id,event);
    const marker = `<!-- consolidated:${job.id} -->`;
    try {
      let shouldMerge=job.shouldMerge;
      if(job.phase==='PENDING') {
        const source=this.jobs.source(job);
        if(!source.turns.length) {this.jobs.commit(job,'SKIPPED',()=>{});return undefined;}
        let detail:string|undefined;
        try { const saved=this.store.read(job.ownerId,job.detailId);if(saved.startsWith(`<!-- memory-job:${job.id};`)) {detail=saved;shouldMerge=saved.startsWith(`<!-- memory-job:${job.id};merge=true`);} }catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        if(!detail) {
          const extracted=await this.generator.extract(source,emit,signal);
          shouldMerge=extracted.shouldMerge;
          detail=`<!-- memory-job:${job.id};merge=${shouldMerge} -->\n# 会话记忆\n\nSession: ${job.sessionId}\nEnded: ${job.endedAt}\nReason: ${job.reason}\nSource first turn: ${source.turns[0]?.turnId??''}\nSource last turn: ${source.turns.at(-1)?.turnId??''}\nSource truncated: ${source.truncated}\n\n${extracted.content}\n`;
        }
        signal.throwIfAborted();
        const content=detail;
        this.jobs.commit(job,'EXTRACTED',()=>this.store.write(job.ownerId,job.detailId,content),shouldMerge);
        emit({type:'memory_detail',at:new Date(),data:{status:'succeeded',memoryId:job.detailId,content,shouldMerge}});
      }
      if (!shouldMerge) { this.jobs.commit(job, 'COMPLETED', () => {}); return; }
      const previous=this.store.overview(job.ownerId);
      if(previous.content.startsWith(marker)){this.jobs.commit(job,'COMPLETED',()=>{});return undefined;}
      const detail=this.store.read(job.ownerId,job.detailId);
      const merged=await this.generator.merge(previous.content,detail,job.detailId,emit,signal);
      signal.throwIfAborted();
      const content=marker+'\n'+merged.replace(/^<!-- consolidated:[^\n]+-->\n?/,'').trim();
      this.jobs.commit(job,'COMPLETED',()=>{
        if(this.store.overview(job.ownerId).revision!==previous.revision)throw new Error('Memory overview changed during generation; retry with the latest revision');
        this.store.write(job.ownerId,'MEMORY.md',content);
      });
      emit({type:'memory_overview',at:new Date(),data:{status:'succeeded',previousRevision:previous.revision,revision:this.store.overview(job.ownerId).revision,previous:previous.content,content}});
    } catch(error) {
      this.jobs.fail(job,signal.aborted?'Memory task interrupted':error instanceof Error?error.message:'Memory generation failed');
      throw error;
    }
  }
}

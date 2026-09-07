import { randomUUID } from "node:crypto";
import type { Logger } from "pino";
import type { MemoryJobRepository } from "../interfaces/memory-job-repository.js";
import type { GenerateSessionMemory } from "./generate-session-memory.js";
import { sleep } from "../../shared/sleep.js";
export class MemoryWorkerLoop {
  private readonly id = `memory_${randomUUID()}`;
  public constructor(private readonly jobs: MemoryJobRepository, private readonly generate: GenerateSessionMemory, private readonly logger: Logger) {}
  public async run(stop: AbortSignal, work: AbortSignal): Promise<void> {
    while(!stop.aborted) {
      const job=this.jobs.claim(this.id);
      if(!job){await sleep(1000,stop);continue;}
      const lease=new AbortController();const signal=AbortSignal.any([work,lease.signal]);
      const timer=setInterval(()=>{try{if(!this.jobs.renew(job))lease.abort();}catch{lease.abort();}},10_000);
      try{await this.generate.execute(job,signal);}catch(error){this.logger.warn({jobId:job.id,err:error instanceof Error?error.message:'failed'},'memory task failed');}
      finally{clearInterval(timer);}
    }
  }
}

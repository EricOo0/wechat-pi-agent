import type { MemoryJob } from "../../../domain/memory/memory-job.js";
import type { TraceEvent } from "./trace-model.js";
import { buildTraceSpans } from "./trace-model.js";
export function memoryJobTrace(job: MemoryJob) {
  const done=job.phase==='COMPLETED'||job.phase==='SKIPPED';
  return {recordKind:'memory_job',turnId:job.id,sessionId:job.sessionId,queuedAt:job.endedAt,capturedAt:job.endedAt,
    status:done?'SUCCEEDED':job.workerId?'RUNNING':job.error?'RETRY_WAIT':'QUEUED',provider:'',modelId:'',systemPrompt:'',skills:[],tools:[],
    userPrompt:`记忆整理 · ${job.sessionId}`,finalResponse:done?job.phase==='SKIPPED'?'无可整理内容，已跳过。':'记忆整理完成。':`当前阶段：${job.phase}`,errorMessage:job.error};
}
export function memoryJobDetails(job:MemoryJob,events:TraceEvent[]) {
  const trace=memoryJobTrace(job);
  return {trace,details:{job,steps:events,turn:{status:trace.status},outbox:[]},spans:buildTraceSpans(events,trace.status)};
}

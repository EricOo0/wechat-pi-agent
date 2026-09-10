import { DatabaseSync } from "node:sqlite";
import type { MemoryJobRepository } from "../../modules/memory/index.js";
import type { AgentEvent } from "../../modules/observability/index.js";
import type { MemoryJob, MemoryPhase } from "../../modules/memory/index.js";
import type { SessionMemorySource } from "../../modules/memory/index.js";
const LEASE_MS = 60_000;
export class SqliteMemoryJobRepository implements MemoryJobRepository {
  private readonly db: DatabaseSync;
  public constructor(path: string) { this.db = new DatabaseSync(path); this.db.exec("PRAGMA busy_timeout=5000"); }
  public close(): void { this.db.close(); }
  private transaction<T>(fn: () => T): T { this.db.exec("BEGIN IMMEDIATE"); try { const result=fn();this.db.exec("COMMIT");return result; } catch(error) {this.db.exec("ROLLBACK");throw error;} }
  public recover(): void { this.db.prepare("UPDATE memory_jobs SET worker_id=NULL,lease_until=NULL WHERE phase NOT IN ('COMPLETED','SKIPPED')").run(); }
  public claim(workerId: string, now = new Date()): MemoryJob | undefined {
    return this.transaction(() => {
      const row = this.db.prepare(`SELECT j.* FROM memory_jobs j JOIN sessions s ON s.id=j.session_id
        WHERE j.phase IN ('PENDING','EXTRACTED') AND j.next_attempt_at<=? AND (j.lease_until IS NULL OR j.lease_until<=?) AND s.cleanup_done=1
          AND NOT EXISTS(SELECT 1 FROM turns WHERE session_id=j.session_id AND status IN ('QUEUED','RUNNING'))
          AND NOT EXISTS(SELECT 1 FROM memory_jobs older WHERE older.owner_id=j.owner_id AND older.phase IN ('PENDING','EXTRACTED')
            AND (older.ended_at<j.ended_at OR (older.ended_at=j.ended_at AND older.rowid<j.rowid)))
        ORDER BY j.ended_at,j.rowid LIMIT 1`).get(now.toISOString(),now.toISOString());
      if (!row) return undefined;
      this.db.prepare("UPDATE memory_jobs SET worker_id=?,lease_until=?,attempts=attempts+1,error=NULL WHERE id=?").run(workerId,new Date(now.getTime()+LEASE_MS).toISOString(),String(row.id));
      return decode({...row,worker_id:workerId,attempts:Number(row.attempts)+1});
    });
  }
  public renew(job: MemoryJob): boolean {
    return Number(this.db.prepare("UPDATE memory_jobs SET lease_until=? WHERE id=? AND worker_id=? AND lease_until>? AND phase IN ('PENDING','EXTRACTED')").run(new Date(Date.now()+LEASE_MS).toISOString(),job.id,job.workerId??"",new Date().toISOString()).changes)===1;
  }
  public commit(job: MemoryJob, phase: MemoryPhase, publish: () => void, shouldMerge = true): void {
    this.transaction(()=>{
      if(!this.db.prepare("SELECT 1 FROM memory_jobs WHERE id=? AND worker_id=? AND lease_until>? AND phase IN ('PENDING','EXTRACTED')").get(job.id,job.workerId??"",new Date().toISOString()))throw new Error("Memory job lease lost");
      publish(); // Synchronous atomic file replacement under the same writer lock as the checkpoint.
      const done=phase==='COMPLETED'||phase==='SKIPPED';
      this.db.prepare("UPDATE memory_jobs SET phase=?,should_merge=?,worker_id=?,lease_until=?,error=NULL WHERE id=?").run(phase,shouldMerge?1:0,done?null:job.workerId??null,done?null:new Date(Date.now()+LEASE_MS).toISOString(),job.id);
    });
  }
  public fail(job: MemoryJob, error: string): void {
    this.db.prepare("UPDATE memory_jobs SET worker_id=NULL,lease_until=NULL,next_attempt_at=?,error=? WHERE id=? AND worker_id=?").run(new Date(Date.now()+Math.min(3_600_000,5000*2**Math.min(job.attempts,9))).toISOString(),error.slice(0,1000),job.id,job.workerId??"");
  }
  public source(job: MemoryJob): SessionMemorySource {
    const rows=this.db.prepare(`SELECT t.id,t.status,t.source,t.input_text,t.final_response,t.error_code,i.text,i.files_json FROM turns t JOIN inbox i ON i.id=t.inbox_id
      WHERE t.session_id=? ORDER BY t.rowid DESC LIMIT 301`).all(job.sessionId);
    let truncated=rows.length>300;
    const turns=rows.slice(0,300).reverse().filter(row=>row.source !== 'user_message' || !/^\/(new|status|permissions|task)\b|^(确认授权|开启全部权限|恢复基本权限)/u.test(String(row.text).trim())).map(row=>{
      if (String(row.text).length>8000 || String(row.final_response??'').length>12000) truncated=true;
      let files=this.db.prepare("SELECT id,name,status FROM user_files WHERE owner_id=? AND message_id=(SELECT i.channel_message_id FROM inbox i JOIN turns t ON t.inbox_id=i.id WHERE t.id=?)").all(job.ownerId,String(row.id));
      if(!files.length && row.files_json) {
        const refs=JSON.parse(String(row.files_json)) as Array<{name?:unknown}>;
        files=refs.flatMap(ref=>typeof ref.name==='string'?[{name:ref.name,status:'not_saved'}]:[]);
      }
      const tools=this.db.prepare("SELECT substr(event_data_json,1,4000) AS preview,length(event_data_json) AS length FROM steps WHERE turn_id=? AND event_type='tool_execution_end' ORDER BY ordinal LIMIT 10").all(String(row.id)).map(e=>({ preview: String(e.preview), truncated: Number(e.length)>4000 }));
      return {inputSource:String(row.source),...(row.source !== "user_message" ? {executionInput:String(row.input_text??"").slice(0,8000)} : {}),turnId:String(row.id),user:row.source === "user_message" ? String(row.text).slice(0,8000) : "",assistant:String(row.final_response??'').slice(0,12000),status:String(row.status),responseGenerated:row.final_response!==null,...(row.error_code?{errorCode:String(row.error_code)}:{}),files,tools};
    });
    const result={sessionId:job.sessionId,endedAt:job.endedAt,reason:job.reason,turns,truncated};
    while(JSON.stringify(result).length>160_000 && result.turns.length>1){result.turns.shift();result.truncated=true;}
    return result;
  }
  public appendEvent(id: string, event: AgentEvent): void {
    this.db.prepare("INSERT INTO memory_job_events(job_id,ordinal,event_type,event_at,event_data_json) VALUES(?,(SELECT coalesce(max(ordinal),-1)+1 FROM memory_job_events WHERE job_id=?),?,?,?)").run(id,id,event.type,event.at.toISOString(),JSON.stringify(event.data??{}));
  }
  public list(): MemoryJob[] { return this.db.prepare("SELECT * FROM memory_jobs ORDER BY ended_at DESC LIMIT 100").all().map(decode); }
  public details(id: string): { job: MemoryJob; events: unknown[] } | undefined {
    const row=this.db.prepare("SELECT * FROM memory_jobs WHERE id=?").get(id);if(!row)return undefined;
    return {job:decode(row),events:this.db.prepare("SELECT * FROM memory_job_events WHERE job_id=? ORDER BY ordinal").all(id).map(e=>({...e,eventData:JSON.parse(String(e.event_data_json)) as unknown}))};
  }
}
function decode(row: Record<string,unknown>): MemoryJob {
  return {id:String(row.id),sessionId:String(row.session_id),ownerId:String(row.owner_id),detailId:String(row.detail_id),endedAt:String(row.ended_at),reason:String(row.reason),phase:row.phase as MemoryPhase,shouldMerge:row.should_merge===1,attempts:Number(row.attempts),...(typeof row.worker_id==='string'?{workerId:row.worker_id}:{}),...(typeof row.error==='string'?{error:row.error}:{})};
}

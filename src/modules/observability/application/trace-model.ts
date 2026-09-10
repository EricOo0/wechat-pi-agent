export interface TraceEvent {
  event_type?: string;
  event_at?: string | Date;
  ordinal?: number;
  eventData?: Record<string, unknown>;
}
export interface TraceSpan {
  id: string;
  parentId?: string;
  name: string;
  kind: string;
  status: "succeeded" | "failed" | "running" | "incomplete";
  start: number | null;
  end: number | null;
  input: unknown;
  output: unknown;
  usage?: unknown;
  events: TraceEvent[];
}

/** Correlate actual model rounds and tool IDs. Never reconstruct missing historical content. */
export function buildTraceSpans(events: TraceEvent[], turnStatus: string): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const calls = new Map<string, TraceSpan>();
  const models = new Map<string, TraceSpan>();
  const toolOrigins = new Map<string, string>();
  const files = new Map<string, TraceSpan>();
  let activeModel: string | undefined;
  const active = turnStatus === "RUNNING";
  const make = (id: string, name: string, kind: string, at: number | null): TraceSpan => {
    const span: TraceSpan = { id, name, kind, status: active ? "running" : "incomplete", start: at, end: null, input: null, output: null, events: [] };
    spans.push(span); return span;
  };
  for (const event of [...events].sort((a,b)=>(a.ordinal??0)-(b.ordinal??0))) {
    const kind = event.event_type ?? "unknown";
    const data = event.eventData ?? {};
    const time = event.event_at == null ? NaN : new Date(event.event_at).getTime();
    const at = Number.isFinite(time) ? time : null;
    if (kind === "agent_start" || kind === "agent_end") {
      for (const span of calls.values()) if (span.end === null) span.status = "incomplete";
      calls.clear();
    }
    if (kind.startsWith("model_") && typeof data.modelCallId === "string") {
      const id = data.modelCallId;
      let span = models.get(id);
      if (!span) { span = make(`model:${id}`, `模型 · ${(typeof data.model === "string" ? data.model : "未记录模型名")}`, "model", kind === "model_start" ? at : null); models.set(id,span); }
      span.events.push(event);
      if (kind === "model_start") { activeModel = span.id; span.input = { context: data.context }; }
      if (kind === "model_request") span.input = { ...(span.input as Record<string,unknown> ?? {}), providerRequest: data.request, attempt: data.attempt };
      if (kind === "model_end") {
        span.end = at; span.output = data.output; span.usage = data.usage;
        span.status = data.status === "failed" ? "failed" : data.status === "incomplete" ? "incomplete" : "succeeded";
        if (activeModel === span.id) activeModel = undefined;
        const output = data.output as {content?: unknown} | undefined;
        if (Array.isArray(output?.content)) for (const block of output.content as Array<Record<string,unknown>>) {
          if (block.type === "toolCall" && typeof block.id === "string") toolOrigins.set(block.id, span.id);
        }
      }
      continue;
    }
    if (kind.startsWith("tool_execution_")) {
      const callId = typeof data.toolCallId === "string" ? data.toolCallId : null;
      let span = callId === null ? undefined : calls.get(callId);
      if (!span || (kind === "tool_execution_start" && span.end !== null)) {
        span = make(`${callId ?? "unmatched"}:${spans.length}`, typeof data.toolName === "string" ? data.toolName : "tool", "tool", null);
        const parent = callId ? toolOrigins.get(callId) : undefined;
        if (parent) span.parentId = parent;
        if (callId !== null) calls.set(callId,span);
      }
      span.events.push(event);
      if (kind === "tool_execution_start") { span.start = at; span.input = data.args ?? null; }
      if (kind === "tool_execution_end") { span.end = at; span.output = data.result ?? null; span.status = data.isError === true ? "failed" : "succeeded"; }
      continue;
    }
    if (kind === "model_management") {
      const span = make(`management:${spans.length}`, "模型管理", "event", at);
      span.end = at; span.status = data.status === "failed" ? "failed" : "succeeded"; span.input = data.command; span.output = data.response; span.events.push(event); continue;
    }
    if (kind === "image_selected" || kind === "image_delivery") {
      const id = typeof data.eventId === "string" ? data.eventId : `image:${spans.length}`;
      let span = files.get(id);
      if (!span) { span = make(id, kind === "image_selected" ? "登记回复图片（未发送）" : data.stage === "upload" ? "上传回复图片" : "发送回复图片", "image", at); files.set(id, span); }
      span.output = data; span.events.push(event);
      span.status = data.status === "started" ? "running" : data.status === "failed" ? "failed" : "succeeded";
      if (data.status !== "started") span.end = at;
      continue;
    }
    if (kind.startsWith("file_")) {
      const labels: Record<string,string> = { file_save: "保存文件", file_upload: "上传文件", file_selected: "选择文件", file_input: "附加文件输入", file_error: "文件处理失败" };
      const key = `${kind}:${typeof data.eventId === "string" ? data.eventId : typeof data.fileId === "string" ? data.fileId : String(event.ordinal)}`;
      let span = files.get(key);
      if (!span || data.status === "started") {
        span = make(`file:${spans.length}`, `${labels[kind] ?? kind}${typeof data.name === "string" ? " · "+data.name : ""}`, "file", at);
        const parent = typeof data.toolCallId === "string" ? calls.get(data.toolCallId)?.id : activeModel;
        if (parent) span.parentId = parent;
        span.input = data; files.set(key,span);
      }
      span.events.push(event);
      if (data.status !== "started") { span.end = at; span.output = data; span.status = data.status === "failed" ? "failed" : "succeeded"; }
      continue;
    }
    if (kind.startsWith("memory_")) {
      const labels:Record<string,string>={memory_load:"加载用户记忆",memory_detail:"保存会话明细",memory_overview:"更新记忆总览"};
      const span=make(`memory:${spans.length}`,labels[kind]??kind,"memory",at);
      span.end=at;span.input=kind==='memory_overview'?{previousRevision:data.previousRevision,previous:data.previous}:data;span.output=typeof data.revision==='string'?{revision:data.revision,content:data.content}:data.content??null;span.events.push(event);
      span.status=data.status==='failed'?'failed':'succeeded';continue;
    }
    if (["context_update","context_replay","skill_load","auto_retry_start","auto_retry_end"].includes(kind) || kind.includes("compaction")) {
      const name = kind === "context_update" ? "立即更新会话上下文" : kind === "context_replay" ? "恢复会话上下文" : kind === "skill_load" ? (typeof data.name === "string" ? data.name : typeof data.requestedName === "string" ? data.requestedName : "Skill") : kind;
      const span = make(`event:${spans.length}`,name,kind.startsWith("context_") ? "context" : kind === "skill_load" ? "skill" : "event",at);
      span.end = at; span.input = data.input ?? data; span.output = data.output ?? null; span.events.push(event);
      span.status = data.status === "failed" || data.success === false ? "failed" : "succeeded";
    }
  }
  return spans;
}

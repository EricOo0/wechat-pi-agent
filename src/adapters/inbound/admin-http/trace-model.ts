export interface TraceEvent {
  event_type?: string;
  event_at?: string | Date;
  ordinal?: number;
  eventData?: Record<string, unknown>;
}

export interface TraceSpan {
  id: string;
  name: string;
  kind: string;
  status: "succeeded" | "failed" | "running" | "incomplete";
  start: number | null;
  end: number | null;
  input: unknown;
  output: unknown;
  events: TraceEvent[];
}

/** Events are observations, not spans: pair by invocation ID, never by tool name. */
export function buildTraceSpans(events: TraceEvent[], turnStatus: string): TraceSpan[] {
  const spans: TraceSpan[] = [];
  const calls = new Map<string, TraceSpan>();
  const files = new Map<string, TraceSpan>();
  const active = turnStatus === "RUNNING";
  for (const event of [...events].sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))) {
    const kind = event.event_type ?? "unknown";
    const data = event.eventData ?? {};
    const time = event.event_at == null ? NaN : new Date(event.event_at).getTime();
    const at = Number.isFinite(time) ? time : null;
    if (kind === "agent_start" || kind === "agent_end") {
      for (const span of calls.values()) { if (span.end === null) span.status = "incomplete"; }
      calls.clear();
    }
    if (kind.startsWith("file_")) {
      const labels: Record<string, string> = { file_save: "保存文件", file_upload: "上传文件", file_selected: "选择文件", file_input: "附加模型输入", file_error: "文件处理失败" };
      const key = `${kind}:${(typeof data.eventId === "string" ? data.eventId : typeof data.fileId === "string" ? data.fileId : String(event.ordinal))}`;
      let span = files.get(key);
      if (!span || data.status === "started") {
        span = { id: `file:${spans.length}`, name: `${labels[kind] ?? kind}${typeof data.name === "string" ? " · " + data.name : ""}`, kind: "file", status: active ? "running" : "incomplete", start: at, end: null, input: data, output: null, events: [] };
        spans.push(span); files.set(key, span);
      }
      span.events.push(event);
      if (data.status !== "started") { span.end = at; span.output = data; span.status = data.status === "failed" ? "failed" : "succeeded"; }
      continue;
    }
    if (kind.startsWith("tool_execution_")) {
      const callId = typeof data.toolCallId === "string" ? data.toolCallId : null;
      let span = callId === null ? undefined : calls.get(callId);
      // Preserve separate attempts if an ID is reused after a completed call.
      if (!span || (kind === "tool_execution_start" && span.end !== null)) {
        span = { id: `${callId ?? "unmatched"}:${spans.length}`, name: typeof data.toolName === "string" ? data.toolName : "tool", kind: "tool", status: active ? "running" : "incomplete", start: null, end: null, input: null, output: null, events: [] };
        spans.push(span);
        if (callId !== null) calls.set(callId, span);
      }
      span.events.push(event);
      if (kind === "tool_execution_start") { span.start = at; span.input = data.args ?? null; }
      if (kind === "tool_execution_end") { span.end = at; span.output = data.result ?? null; span.status = data.isError === true ? "failed" : "succeeded"; }
      continue;
    }
    if (kind === "skill_load" || kind === "auto_retry_start" || kind === "auto_retry_end" || kind.includes("compaction")) {
      spans.push({ id: `event:${spans.length}`, name: kind === "skill_load" ? (typeof data.name === "string" ? data.name : typeof data.requestedName === "string" ? data.requestedName : "Skill") : kind, kind: kind === "skill_load" ? "skill" : "event", status: data.status === "failed" || data.success === false ? "failed" : "succeeded", start: at, end: at, input: data, output: null, events: [event] });
    }
  }
  return spans;
}

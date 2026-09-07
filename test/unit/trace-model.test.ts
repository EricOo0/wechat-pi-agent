import { describe, expect, it } from "vitest";
import { buildTraceSpans, type TraceEvent } from "../../src/adapters/inbound/admin-http/trace-model.js";
const event = (type: string, id: string, ordinal: number, extra: Record<string, unknown> = {}): TraceEvent => ({ event_type: `tool_execution_${type}`, ordinal, event_at: new Date(ordinal * 100), eventData: { toolCallId: id, toolName: "read", ...extra } });
describe("trace span reconstruction", () => {
  it("pairs overlapping calls by ID and retains updates and errors", () => {
    const spans = buildTraceSpans([event("start", "a", 0, { args: { path: "/a" } }), event("start", "b", 1), event("update", "a", 2), event("end", "b", 3, { isError: true, result: "denied" }), event("end", "a", 4, { result: "ok" })], "SUCCEEDED");
    expect(spans).toHaveLength(2);
    expect(spans[0]).toMatchObject({ start: 0, end: 400, status: "succeeded", input: { path: "/a" }, output: "ok" });
    expect(spans[0]?.events).toHaveLength(3);
    expect(spans[1]).toMatchObject({ start: 100, end: 300, status: "failed", output: "denied" });
  });
  it("distinguishes active, incomplete and missing-start observations", () => {
    expect(buildTraceSpans([event("start", "a", 1)], "RUNNING")[0]?.status).toBe("running");
    expect(buildTraceSpans([event("start", "a", 1)], "FAILED")[0]).toMatchObject({ status: "incomplete", end: null });
    expect(buildTraceSpans([event("end", "a", 2)], "SUCCEEDED")[0]).toMatchObject({ start: null, end: 200 });
  });
  it("does not merge repeated attempts or calls without IDs", () => {
    const spans = buildTraceSpans([event("start", "a", 1), event("end", "a", 2), event("start", "a", 3), event("start", "", 4, { toolCallId: null }), event("end", "", 5, { toolCallId: null })], "FAILED");
    expect(spans).toHaveLength(4);
  });
  it("retains skill failures without inventing model spans", () => {
    expect(buildTraceSpans([{ event_type: "message_start" }, { event_type: "skill_load", eventData: { status: "failed", requestedName: "missing" } }], "FAILED")).toEqual([expect.objectContaining({ name: "missing", kind: "skill", status: "failed" })]);
  });
});

it('pairs file stages and keeps file selection visible', () => {
  const spans = buildTraceSpans([
    { event_type: 'file_upload', ordinal: 0, event_at: '2026-09-07T00:00:00Z', eventData: { eventId: 'attempt', fileId: 'f', status: 'started' } },
    { event_type: 'file_selected', ordinal: 1, event_at: '2026-09-07T00:00:01Z', eventData: { fileId: 'f', toolCallId: 'tool', status: 'succeeded' } },
    { event_type: 'file_upload', ordinal: 2, event_at: '2026-09-07T00:00:02Z', eventData: { eventId: 'attempt', fileId: 'f', status: 'failed', errorCode: 'FILE_UPLOAD_FAILED' } },
  ], 'COMPLETED');
  expect(spans).toHaveLength(2);
  expect(spans[0]).toMatchObject({ kind: 'file', status: 'failed', end: Date.parse('2026-09-07T00:00:02Z') });
  expect(spans[0]?.events).toHaveLength(2);
  expect(spans[1]?.status).toBe('succeeded');
});

it('builds model/tool parentage from actual returned toolCall IDs and retains request and reasoning',()=>{
 const spans=buildTraceSpans([
  {event_type:'model_start',ordinal:0,event_at:new Date(0),eventData:{modelCallId:'round-1',model:'gpt-test',context:{messages:[{role:'user',content:'hello'}]}}},
  {event_type:'model_request',ordinal:1,eventData:{modelCallId:'round-1',attempt:1,request:{input:['actual input']}}},
  {event_type:'model_end',ordinal:2,event_at:new Date(100),eventData:{modelCallId:'round-1',status:'succeeded',usage:{totalTokens:42},output:{content:[{type:'thinking',thinking:'returned summary'},{type:'toolCall',id:'call-A',name:'read',arguments:{path:'/a'}}]}}},
  event('start','call-A',3,{args:{path:'/a'}}),event('end','call-A',4,{result:{content:[{type:'text',text:'full result'}]}}),
  {event_type:'model_start',ordinal:5,eventData:{modelCallId:'round-2',model:'gpt-test',context:{messages:[{role:'toolResult',content:'full result'}]}}},
 ],'RUNNING');
 expect(spans).toHaveLength(3);expect(spans[0]).toMatchObject({kind:'model',status:'succeeded',usage:{totalTokens:42},input:{providerRequest:{input:['actual input']}}});
 expect(spans[1]?.parentId).toBe(spans[0]?.id);expect(spans[2]).toMatchObject({kind:'model',status:'running'});
});

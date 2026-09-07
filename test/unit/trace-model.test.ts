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

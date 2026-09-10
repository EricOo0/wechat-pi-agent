import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Script } from "node:vm";
import pino from "pino";
import { afterEach, describe, expect, it } from "vitest";
import { AdminServer } from "../../src/entrypoints/admin-http/server.js";
import { RuntimeHealth } from "../../src/modules/observability/application/runtime-health.js";
import { DryRunChannel } from "../../src/adapters/dry-run/dry-run-channel.js";
import { PrometheusTelemetry } from "../../src/adapters/telemetry/metrics.js";
import { DryRunAgent } from "../../src/adapters/dry-run/dry-run-agent.js";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((operation) => operation()));
});

describe("Admin trace UI", () => {
  it("serves the trace page, list API, and full System Prompt snapshot", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wechat-admin-trace-"));
    const control = new SqliteControlPlane(join(directory, "app.db"));
    control.migrate();
    control.ingestBatch({
      accountId: "bot",
      previousCursor: "",
      nextCursor: "cursor",
      messages: [{
        id: "message",
        accountId: "bot",
        channelMessageId: "remote",
        peerId: "user",
        senderId: "user",
        text: "hello trace",
        receivedAt: new Date(),
      }],
    });
    const claimed = control.claimNextTurn("worker", 30_000);
    if (claimed === undefined) throw new Error("turn was not claimed");
    control.recordAgentInvocation(claimed.turn.id, {
      provider: "openai-codex",
      modelId: "gpt-test",
      systemPrompt: "actual system prompt",
      skills: [],
      tools: ["read"],
    });
    control.appendAgentEvent(claimed.turn.id, { type: "skill_load", at: new Date(), data: { mode: "explicit", status: "failed", requestedName: "missing", reason: "not_found" } });
    control.appendAgentEvent(claimed.turn.id, { type: "skill_load", at: new Date(), data: { mode: "model", status: "loaded", name: "demo", filePath: "/skills/demo/SKILL.md", source: "project-bundled", toolCallId: "read-1" } });
    control.appendAgentEvent(claimed.turn.id, { type: "tool_execution_start", at: new Date(1000), data: { toolCallId: "call-a", toolName: "read", args: { path: "/notes.md" } } });
    control.appendAgentEvent(claimed.turn.id, { type: "tool_execution_end", at: new Date(1200), data: { toolCallId: "call-a", toolName: "read", isError: false, result: { content: [{ type: "text", text: "notes" }] } } });
    const server = new AdminServer({
      host: "127.0.0.1",
      port: 0,
      control,
      channel: new DryRunChannel(),
      agent: new DryRunAgent(),
      health: new RuntimeHealth(),
      telemetry: new PrometheusTelemetry(false),
      logger: pino({ enabled: false }),
    });
    await server.start();
    cleanup.push(async () => { await server.close(); control.close(); await rm(directory, { recursive: true, force: true }); });
    const port = server.getPort();
    if (port === undefined) throw new Error("admin port unavailable");

    const page = await fetch(`http://127.0.0.1:${port}/admin`);
    expect(page.status).toBe(200);
    const html = await page.text();
    expect(html).toContain("System Prompt");
    expect(html).toContain("请求 JSON");
    expect(html).toContain("Reasoning · 接口返回");
    const script = /<script>([\s\S]*)<\/script>/u.exec(html)?.[1];
    if (script === undefined) throw new Error("admin page script not found");
    expect(() => new Script(script)).not.toThrow();

    const list = await fetch(`http://127.0.0.1:${port}/debug/traces?limit=100`).then(async (response) => response.json()) as Array<{ turnId: string }>;
    expect(list).toEqual([expect.objectContaining({ turnId: claimed.turn.id, sessionId: claimed.session.id, queuedAt: claimed.turn.queuedAt.toISOString() })]);

    const details = await fetch(`http://127.0.0.1:${port}/debug/traces/${claimed.turn.id}`).then(async (response) => response.json()) as { spans: Array<{ name: string; start: number; end: number; events: unknown[] }>; trace: { systemPrompt: string }; details: { steps: Array<{ status: string; eventData: Record<string, unknown> }> } };
    expect(details.spans).toContainEqual(expect.objectContaining({ name: "read", start: 1000, end: 1200 }));
    expect(details.trace.systemPrompt).toBe("actual system prompt");
    expect(details.details.steps[0]?.status).toBe("FAILED");
    expect(details.details.steps[0]?.eventData).toMatchObject({ mode: "explicit", reason: "not_found" });
    expect(details.details.steps[1]?.eventData).toMatchObject({ mode: "model", status: "loaded", toolCallId: "read-1", source: "project-bundled" });
  });
});

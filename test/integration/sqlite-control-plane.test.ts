import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { InboundBatch } from "../../src/modules/messaging/domain/inbound-message.js";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";

function batch(previousCursor = "", nextCursor = "cursor-1"): InboundBatch {
  return {
    accountId: "account-1",
    previousCursor,
    nextCursor,
    messages: [
      {
        id: "inbox-1",
        accountId: "account-1",
        channelMessageId: "channel-message-1",
        peerId: "peer-1",
        senderId: "sender-1",
        sequence: 7,
        contextToken: "context-1",
        text: "hello",
        receivedAt: new Date("2025-01-02T03:04:05.000Z"),
        raw: { nested: true },
      },
    ],
  };
}

describe("SqliteControlPlane", () => {
  let directory: string;
  let controlPlane: SqliteControlPlane;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), "sqlite-control-plane-"));
    controlPlane = new SqliteControlPlane(join(directory, "control-plane.db"));
    controlPlane.migrate();
  });

  afterEach(() => {
    controlPlane.close();
    rmSync(directory, { recursive: true, force: true });
  });

  it("atomically deduplicates inbox messages and advances the cursor", () => {
    expect(controlPlane.healthCheck()).toEqual({ ready: true });
    const input = batch();
    input.messages[0]!.images = [{ path: "/data/inbound-media/image.png", mimeType: "image/png", bytes: 128 }];
    expect(controlPlane.ingestBatch(input)).toEqual({ inserted: 1, rejected: 0 });
    expect(controlPlane.getCursor("account-1")).toBe("cursor-1");

    expect(controlPlane.ingestBatch(batch())).toEqual({ inserted: 0, rejected: 1 });
    expect(controlPlane.getCursor("account-1")).toBe("cursor-1");

    const claimed = controlPlane.claimNextTurn("turn-worker", 30_000);
    expect(claimed?.message).toMatchObject({
      id: "inbox-1",
      sequence: 7,
      contextToken: "context-1",
      raw: { nested: true },
      images: [{ path: "/data/inbound-media/image.png", mimeType: "image/png", bytes: 128 }],
    });
    expect(claimed?.message.receivedAt).toEqual(new Date("2025-01-02T03:04:05.000Z"));
    expect(controlPlane.claimNextTurn("other-worker", 30_000)).toBeUndefined();
  });

  it("moves a completed turn through outbox retry to success", () => {
    controlPlane.ingestBatch(batch());
    const claimedTurn = controlPlane.claimNextTurn("turn-worker", 30_000);
    expect(claimedTurn).toBeDefined();
    if (claimedTurn === undefined) throw new Error("turn was not claimed");

    controlPlane.appendAgentEvent(claimedTurn.turn.id, {
      type: "agent.completed",
      at: new Date("2025-01-02T03:05:00.000Z"),
      data: { tokens: 12 },
    });
    controlPlane.completeTurn({
      turnId: claimedTurn.turn.id,
      finalResponse: "firstsecond",
      chunks: ["first", "second"],
      piSessionId: "pi-session-1",
      piSessionFile: "/tmp/pi-session-1.jsonl",
    });

    const first = controlPlane.claimNextOutbox("sender", 30_000);
    expect(first?.attemptNo).toBe(1);
    expect(first?.message).toMatchObject({ text: "first", chunkIndex: 0, attemptCount: 1 });
    if (first === undefined) throw new Error("outbox was not claimed");
    controlPlane.markOutboxFailed(first.message.id, new Error("temporary"), new Date(0), 3);

    const retry = controlPlane.claimNextOutbox("sender", 30_000);
    expect(retry?.message.id).toBe(first.message.id);
    expect(retry?.attemptNo).toBe(2);
    if (retry === undefined) throw new Error("outbox retry was not claimed");
    controlPlane.markOutboxSent(retry.message.id, "remote-1");

    const second = controlPlane.claimNextOutbox("sender", 30_000);
    expect(second?.message.text).toBe("second");
    if (second === undefined) throw new Error("second outbox was not claimed");
    controlPlane.markOutboxSent(second.message.id);

    const details = controlPlane.getTurnDetails(claimedTurn.turn.id) as {
      turn: { status: string };
      session: { piSessionId?: string; piSessionFile?: string };
      steps: readonly unknown[];
      outbox: readonly { status: string }[];
    };
    expect(details.turn.status).toBe("SUCCEEDED");
    expect(details.session).toMatchObject({
      piSessionId: "pi-session-1",
      piSessionFile: "/tmp/pi-session-1.jsonl",
    });
    expect(details.steps).toHaveLength(1);
    expect(details.outbox.map((record) => record.status)).toEqual(["SENT", "SENT"]);
    expect(controlPlane.getRecentErrors(10)).toHaveLength(1);
  });

  it("stores a complete per-turn agent invocation trace", () => {
    controlPlane.ingestBatch(batch());
    const claimed = controlPlane.claimNextTurn("turn-worker", 30_000);
    if (claimed === undefined) throw new Error("turn was not claimed");
    controlPlane.recordAgentInvocation(claimed.turn.id, {
      provider: "openai-codex",
      modelId: "gpt-test",
      systemPrompt: "base prompt\n<available_skills>demo</available_skills>",
      skills: [{ name: "demo", description: "Demo skill", filePath: "/skills/demo/SKILL.md" }],
      tools: ["read", "http_get"],
    });
    controlPlane.completeTurn({ turnId: claimed.turn.id, finalResponse: "done", chunks: [] });

    expect(controlPlane.getAgentTrace(claimed.turn.id)).toMatchObject({
      turnId: claimed.turn.id,
      provider: "openai-codex",
      modelId: "gpt-test",
      systemPrompt: expect.stringContaining("available_skills") as string,
      userPrompt: "hello",
      finalResponse: "done",
      status: "SUCCEEDED",
      skills: [{ name: "demo", description: "Demo skill", filePath: "/skills/demo/SKILL.md" }],
      tools: ["read", "http_get"],
    });
    expect(controlPlane.getRecentAgentTraces(100)).toHaveLength(1);
  });

  it("recovers expired turn and outbox leases", () => {
    controlPlane.ingestBatch(batch());
    const firstClaim = controlPlane.claimNextTurn("crashed-turn-worker", 10);
    expect(firstClaim).toBeDefined();
    const turnRecovery = controlPlane.recoverInterrupted(new Date(Date.now() + 60_000));
    expect(turnRecovery).toEqual({ turns: 1, outbox: 0 });

    const recoveredTurn = controlPlane.claimNextTurn("replacement-turn-worker", 30_000);
    expect(recoveredTurn?.turn.id).toBe(firstClaim?.turn.id);
    if (recoveredTurn === undefined) throw new Error("recovered turn was not claimed");
    controlPlane.completeTurn({ turnId: recoveredTurn.turn.id, finalResponse: "done", chunks: ["done"] });

    const firstOutboxClaim = controlPlane.claimNextOutbox("crashed-sender", 10);
    expect(firstOutboxClaim).toBeDefined();
    const outboxRecovery = controlPlane.recoverInterrupted(new Date(Date.now() + 60_000));
    expect(outboxRecovery).toEqual({ turns: 0, outbox: 1 });

    const recoveredOutbox = controlPlane.claimNextOutbox("replacement-sender", 30_000);
    expect(recoveredOutbox?.message.id).toBe(firstOutboxClaim?.message.id);
    expect(recoveredOutbox?.attemptNo).toBe(2);
  });
});

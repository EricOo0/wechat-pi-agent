import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ReplyChunker } from "../../src/modules/messaging/domain/reply-chunker.js";
import { DeliverReply } from "../../src/modules/messaging/application/workflows/deliver-reply.js";
import { RunNextTurn } from "../../src/modules/turns/application/workflows/run-next-turn.js";
import { DryRunChannel } from "../../src/adapters/dry-run/dry-run-channel.js";
import { DryRunAgent } from "../../src/adapters/dry-run/dry-run-agent.js";
import { SqliteControlPlane } from "../../src/adapters/sqlite/sqlite-control-plane.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("dry-run end-to-end", () => {
  it("persists an inbound message, runs the agent, and dispatches an outbox reply", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wechat-pi-e2e-"));
    directories.push(directory);
    const control = new SqliteControlPlane(join(directory, "app.db"));
    control.migrate();
    control.ingestBatch({
      accountId: "bot",
      previousCursor: "",
      nextCursor: "cursor-1",
      messages: [{
        id: "msg-1",
        accountId: "bot",
        channelMessageId: "remote-1",
        peerId: "user",
        senderId: "user",
        contextToken: "context",
        text: "hello",
        receivedAt: new Date("2026-01-01T00:00:00.000Z"),
      }],
    });

    const channel = new DryRunChannel();
    const runTurn = new RunNextTurn(control, new DryRunAgent(), channel, new ReplyChunker(), { ownerId: "test" });
    const turn = await runTurn.execute();
    expect(turn).toMatchObject({ status: "completed", finalResponse: "[dry-run] hello" });

    const deliver = new DeliverReply(control, channel, { ownerId: "test" });
    await expect(deliver.execute()).resolves.toMatchObject({ status: "sent" });
    expect(channel.sent).toHaveLength(1);
    expect(channel.sent[0]).toMatchObject({ text: "[dry-run] hello", clientId: expect.stringMatching(/^out_/) as string });

    if (turn.status !== "completed") throw new Error("turn did not complete");
    expect(control.getTurnDetails(turn.turnId)).toMatchObject({ turn: { status: "SUCCEEDED" } });
    control.close();
  });
});

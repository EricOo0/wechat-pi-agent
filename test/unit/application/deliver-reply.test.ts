import { describe, expect, it, vi } from "vitest";
import type { Channel } from "../../../src/application/interfaces/channel.js";
import { DeliverReply } from "../../../src/application/use-cases/deliver-reply.js";
import { claimedOutbox, controlPlane, now } from "./helpers.js";

function channel(sendText: Channel["sendText"]): Channel {
  return { getUpdates: vi.fn(), sendText, checkReady: vi.fn(() => Promise.resolve({ ready: true })) };
}

describe("DeliverReply", () => {
  it("claims, sends over the network, then marks the outbox sent", async () => {
    const markOutboxSent = vi.fn();
    const sendText = vi.fn<Channel["sendText"]>(() => Promise.resolve({ remoteRequestId: "remote-1" }));
    const control = controlPlane({
      claimNextOutbox: vi.fn(() => claimedOutbox()),
      markOutboxSent,
    });
    const useCase = new DeliverReply(control, channel(sendText), { ownerId: "worker" });

    await expect(useCase.execute()).resolves.toEqual({
      status: "sent",
      outboxId: "outbox-1",
      remoteRequestId: "remote-1",
    });
    expect(markOutboxSent).toHaveBeenCalledWith("outbox-1", "remote-1");
  });

  it("schedules exponential retry after a send failure", async () => {
    const markOutboxFailed = vi.fn();
    const error = new Error("network down");
    const control = controlPlane({
      claimNextOutbox: vi.fn(() => claimedOutbox(3)),
      markOutboxFailed,
    });
    const useCase = new DeliverReply(
      control,
      channel(vi.fn<Channel["sendText"]>(() => Promise.reject(error))),
      { ownerId: "worker", maxAttempts: 4 },
      { now: () => now },
    );

    const result = await useCase.execute();
    expect(result.status).toBe("retry_scheduled");
    expect(markOutboxFailed).toHaveBeenCalledWith(
      "outbox-1",
      error,
      new Date(now.getTime() + 10_000),
      4,
    );
  });
});

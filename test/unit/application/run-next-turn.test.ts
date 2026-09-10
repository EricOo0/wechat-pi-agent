import { describe, expect, it, vi } from "vitest";
import type { Agent, AgentRunRequest } from "../../../src/runtime/agent/ports/agent.js";
import type { Channel } from "../../../src/modules/messaging/ports/channel.js";
import { ReplyChunker } from "../../../src/modules/messaging/domain/reply-chunker.js";
import { RunNextTurn } from "../../../src/modules/turns/application/workflows/run-next-turn.js";
import { claimedTurn, controlPlane, now } from "./helpers.js";

function channel(setTyping: Channel["setTyping"] = vi.fn(() => Promise.resolve())): Channel {
  return {
    getUpdates: vi.fn(),
    sendText: vi.fn(),
    setTyping,
    checkReady: vi.fn(() => Promise.resolve({ ready: true })),
  };
}

describe("RunNextTurn", () => {
  it("claims, toggles typing, records events, and completes after agent I/O", async () => {
    const appendAgentEvent = vi.fn();
    const recordAgentInvocation = vi.fn();
    const completeTurn = vi.fn();
    const event = { type: "llm", at: now };
    const invocation = { systemPrompt: "actual prompt", provider: "openai-codex", modelId: "gpt-test", skills: [], tools: ["read"] };
    const runTurn = vi.fn((request: AgentRunRequest) => {
      request.onInvocation?.(invocation);
      request.onEvent?.(event);
      return Promise.resolve({ text: "hello world", piSessionId: "pi-1" });
    });
    const agent: Agent = {
      recordContext: () => Promise.resolve(),
      checkReady: vi.fn(() => Promise.resolve({ ready: true })),
      runTurn,
    };
    const typing = vi.fn<NonNullable<Channel["setTyping"]>>(() => Promise.resolve());
    const claim = claimedTurn();
    claim.message.images = [{ path: "/tmp/image.png", mimeType: "image/png", bytes: 8 }];
    const useCase = new RunNextTurn(
      controlPlane({
        claimNextTurn: vi.fn(() => claim),
        appendAgentEvent,
        recordAgentInvocation,
        completeTurn,
      }),
      agent,
      channel(typing),
      new ReplyChunker(6),
      { ownerId: "worker" },
    );

    await expect(useCase.execute()).resolves.toEqual({
      status: "completed",
      turnId: "turn-1",
      finalResponse: "hello world",
      chunks: ["hello ", "world"],
    });
    expect(typing.mock.calls.map((call) => call[2])).toEqual([true, false]);
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ images: claim.message.images }));
    expect(recordAgentInvocation).toHaveBeenCalledWith("turn-1", invocation);
    expect(appendAgentEvent).toHaveBeenCalledWith("turn-1", event);
    expect(completeTurn).toHaveBeenCalledWith(expect.objectContaining({
      turnId: "turn-1",
      piSessionId: "pi-1",
    }));
  });

  it("fails the claimed turn and always clears typing when the agent rejects", async () => {
    const failTurn = vi.fn();
    const typing = vi.fn<NonNullable<Channel["setTyping"]>>(() => Promise.resolve());
    const agent: Agent = {
      recordContext: () => Promise.resolve(),
      checkReady: vi.fn(() => Promise.resolve({ ready: true })),
      runTurn: vi.fn(() => Promise.reject(new Error("provider unavailable"))),
    };
    const useCase = new RunNextTurn(
      controlPlane({ claimNextTurn: vi.fn(() => claimedTurn()), failTurn }),
      agent,
      channel(typing),
      new ReplyChunker(),
      { ownerId: "worker" },
    );

    const result = await useCase.execute();
    expect(result.status).toBe("failed");
    expect(failTurn).toHaveBeenCalledWith({
      turnId: "turn-1",
      errorCode: "AGENT_RUN_FAILED",
      errorMessage: "provider unavailable",
    });
    expect(typing.mock.calls.map((call) => call[2])).toEqual([true, false]);
  });

  it("handles /new without invoking the agent", async () => {
    const commandClaim = claimedTurn();
    commandClaim.message.text = "/new";
    const archiveActiveSession = vi.fn();
    const completeTurn = vi.fn();
    const runTurn = vi.fn(() => Promise.reject(new Error("must not run")));
    const agent: Agent = {
      recordContext: () => Promise.resolve(),
      checkReady: vi.fn(() => Promise.resolve({ ready: true })),
      runTurn,
    };
    const useCase = new RunNextTurn(
      controlPlane({
        claimNextTurn: vi.fn(() => commandClaim),
        archiveActiveSession,
        completeTurn,
      }),
      agent,
      channel(),
      new ReplyChunker(),
      { ownerId: "worker" },
    );

    await expect(useCase.execute()).resolves.toMatchObject({ status: "completed" });
    expect(runTurn).not.toHaveBeenCalled();
    expect(archiveActiveSession).toHaveBeenCalledWith("account-1", "peer-1");
    expect(completeTurn).toHaveBeenCalledWith(expect.objectContaining({ turnId: "turn-1" }));
  });
  it("does not send recognized management commands to the model when the feature is disabled", async () => {
    const claim = claimedTurn(); claim.message.text = "/provider";
    const runTurn = vi.fn(() => Promise.resolve({ text: "should not run" }));
    const agent: Agent = { recordContext: () => Promise.resolve(), checkReady: () => Promise.resolve({ ready: true }), runTurn };
    const useCase = new RunNextTurn(controlPlane({ claimNextTurn: () => claim }), agent, channel(), new ReplyChunker(), { ownerId: "worker" });
    const result = await useCase.execute();
    expect(result).toMatchObject({ status: "completed", finalResponse: expect.stringContaining("MODEL_MANAGEMENT_ENABLED=true") as string });
    expect(runTurn).not.toHaveBeenCalled();
  });

  it("passes unmatched command syntax through unchanged", async () => {
    const claim = claimedTurn(); claim.message.text = "/model this is an explanation";
    const runTurn = vi.fn(() => Promise.resolve({ text: "understood" }));
    const agent: Agent = { recordContext: () => Promise.resolve(), checkReady: () => Promise.resolve({ ready: true }), runTurn };
    const useCase = new RunNextTurn(controlPlane({ claimNextTurn: () => claim }), agent, channel(), new ReplyChunker(), { ownerId: "worker" });
    await useCase.execute();
    expect(runTurn).toHaveBeenCalledWith(expect.objectContaining({ prompt: claim.message.text }));
  });

});

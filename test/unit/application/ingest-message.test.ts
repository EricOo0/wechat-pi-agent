import { describe, expect, it, vi } from "vitest";
import { IngestMessage } from "../../../src/application/use-cases/ingest-message.js";
import { ExactSenderPolicy } from "../../../src/domain/policy/sender-policy.js";
import { batch, controlPlane, inbound } from "./helpers.js";

describe("IngestMessage", () => {
  it("filters denied senders before persisting and counts all rejections", () => {
    const ingestBatch = vi.fn(() => ({ inserted: 1, rejected: 1 }));
    const control = controlPlane({ ingestBatch });
    const useCase = new IngestMessage(control, new ExactSenderPolicy("allowed"));

    const result = useCase.execute(batch([
      inbound({ id: "one", senderId: "allowed" }),
      inbound({ id: "two", senderId: "denied" }),
    ]));

    expect(ingestBatch).toHaveBeenCalledWith(expect.objectContaining({
      messages: [expect.objectContaining({ id: "one" })],
      nextCursor: "11",
    }));
    expect(result).toEqual({ inserted: 1, rejected: 2 });
  });
});

import { describe, expect, it } from "vitest";
import { ReplyChunker } from "../../../src/application/services/reply-chunker.js";

describe("ReplyChunker", () => {
  it("prefers natural boundaries and preserves the exact text", () => {
    const chunks = new ReplyChunker(8).chunk("hello world\nagain");
    expect(chunks).toEqual(["hello ", "world\n", "again"]);
    expect(chunks.join("")).toBe("hello world\nagain");
  });

  it("counts unicode code points rather than UTF-16 units", () => {
    expect(new ReplyChunker(2).chunk("😀😀😀")).toEqual(["😀😀", "😀"]);
  });

  it("returns no outbound chunks for an empty reply", () => {
    expect(new ReplyChunker().chunk("")).toEqual([]);
  });
});

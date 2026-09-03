import { describe, expect, it } from "vitest";
import { CommandRouter } from "../../../src/application/services/command-router.js";

describe("CommandRouter", () => {
  const router = new CommandRouter();

  it("parses /new and /status case-insensitively", () => {
    expect(router.route(" /NEW ")).toEqual({ type: "new" });
    expect(router.route("/status@my-bot")).toEqual({ type: "status" });
  });

  it("does not consume arguments or unknown commands", () => {
    expect(router.route("/new later")).toEqual({ type: "message", text: "/new later" });
    expect(router.route("/help")).toEqual({ type: "message", text: "/help" });
  });
});

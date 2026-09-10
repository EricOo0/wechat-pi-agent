import { expect, it } from "vitest";
import { assertTaskTransition, canRequestCompletion, remainingReact, taskTerminal } from "../../../src/modules/tasks/index.js";

it("does not let execution self-complete or revive a cancelled task", () => {
  expect(() => assertTaskTransition("RUNNING", "COMPLETED")).toThrow();
  expect(() => assertTaskTransition("RUNNING", "REVIEWING")).not.toThrow();
  expect(() => assertTaskTransition("REVIEWING", "COMPLETED")).not.toThrow();
  expect(() => assertTaskTransition("CANCELLED", "QUEUED")).toThrow();
  expect(taskTerminal("WAITING")).toBe(false);
});

it("allows a final completion application independently of execution budget", () => {
  expect(remainingReact({ reactLimit: 30, reactUsed: 30 })).toBe(0);
  expect(canRequestCompletion({ status: "RUNNING", revision: 2 }, 2)).toBe(true);
  expect(canRequestCompletion({ status: "RUNNING", revision: 2 }, 1)).toBe(false);
  expect(canRequestCompletion({ status: "CANCELLING", revision: 2 }, 2)).toBe(false);
});

it("requires cancellation and pause to settle before reporting their final states", () => {
  expect(() => assertTaskTransition("RUNNING", "CANCELLED")).toThrow();
  expect(() => assertTaskTransition("RUNNING", "CANCELLING")).not.toThrow();
  expect(() => assertTaskTransition("CANCELLING", "CANCELLED")).not.toThrow();
  expect(() => assertTaskTransition("PAUSING", "QUEUED")).toThrow();
  expect(() => remainingReact({ reactLimit: 30, reactUsed: 31 })).toThrow();
});

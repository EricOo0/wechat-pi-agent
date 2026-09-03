import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadSystemPrompt } from "../../../src/adapters/outbound/pi/system-prompt.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("loadSystemPrompt", () => {
  it("loads the standalone WeChat assistant prompt", async () => {
    const prompt = await loadSystemPrompt(resolve("src/prompts/wechat-assistant.md"));

    expect(prompt).toContain("WeChat Private Assistant");
    expect(prompt).toContain("You may use only the tools explicitly exposed");
    expect(prompt).toContain("Security and instruction hierarchy");
  });

  it("rejects an empty prompt file", async () => {
    const directory = await mkdtemp(join(tmpdir(), "wechat-prompt-"));
    directories.push(directory);
    const path = join(directory, "empty.md");
    await writeFile(path, "  \n");

    await expect(loadSystemPrompt(path)).rejects.toThrow(/System prompt is empty/);
  });
});

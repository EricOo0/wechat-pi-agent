import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createHttpTool } from "../../../src/adapters/outbound/pi/tools/http-tool.js";
import { createSandboxTools } from "../../../src/adapters/outbound/pi/tools/sandbox-tools.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("sandbox agent tools", () => {
  it("reads skills, writes inside the sandbox, and blocks traversal", async () => {
    const root = await mkdtemp(join(tmpdir(), "wechat-tools-"));
    directories.push(root);
    const sandbox = join(root, "sandbox");
    const skill = join(root, "skill");
    await mkdir(skill);
    await writeFile(join(skill, "SKILL.md"), "skill instructions");
    const tools = await createSandboxTools({ sandboxRoot: sandbox, skillRoots: [skill] });
    const read = tools.find((tool) => tool.name === "read")!;
    const write = tools.find((tool) => tool.name === "sandbox_write")!;

    await write.execute("write-1", { path: "notes/result.txt", content: "hello" }, undefined, undefined, {} as never);
    expect(await readFile(join(sandbox, "notes/result.txt"), "utf8")).toBe("hello");

    const skillResult = await read.execute("read-1", { path: join(skill, "SKILL.md") }, undefined, undefined, {} as never);
    expect(skillResult.content[0]).toMatchObject({ type: "text", text: "skill instructions" });

    await expect(write.execute("write-2", { path: "../escape.txt", content: "no" }, undefined, undefined, {} as never))
      .rejects.toThrow(/outside the sandbox root/);
  });
});

describe("public HTTPS tool", () => {
  it("blocks private network destinations", async () => {
    const tool = createHttpTool({ allowedHosts: [] });

    await expect(tool.execute("http-1", { url: "https://127.0.0.1/private" }, undefined, undefined, {} as never))
      .rejects.toThrow(/non-public network/);
  });

  it("enforces a configured hostname allowlist", async () => {
    const tool = createHttpTool({ allowedHosts: ["api.example.com"] });

    await expect(tool.execute("http-2", { url: "https://example.org/" }, undefined, undefined, {} as never))
      .rejects.toThrow(/not in the HTTP allowlist/);
  });
});

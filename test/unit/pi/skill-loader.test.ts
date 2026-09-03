import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DefaultResourceLoader } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("Pi local Skill loading", () => {
  it("discovers SKILL.md from the configured Pi agent directory", async () => {
    const root = await mkdtemp(join(tmpdir(), "wechat-skills-"));
    directories.push(root);
    const skillDirectory = join(root, "skills", "summarizer");
    await mkdir(skillDirectory, { recursive: true });
    await writeFile(join(skillDirectory, "SKILL.md"), "---\nname: summarizer\ndescription: Summarize long text.\n---\n\n# Summarizer\n");
    const loader = new DefaultResourceLoader({
      cwd: root,
      agentDir: root,
      systemPrompt: "System prompt",
      noExtensions: true,
      noSkills: false,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });

    await loader.reload();

    expect(loader.getSkills().skills).toContainEqual(
      expect.objectContaining({ name: "summarizer", baseDir: skillDirectory }),
    );
  });
});

import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SettingsManager } from "@earendil-works/pi-coding-agent";
import { afterEach, describe, expect, it } from "vitest";
import { loadSkillCatalog, SkillLoadTracker } from "../../../src/adapters/outbound/pi/skill-catalog.js";
import type { AgentEvent } from "../../../src/domain/execution/step.js";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))); });
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), "skill-catalog-")); roots.push(cwd);
  const agentDir = join(cwd, "agent");
  const add = async (dir: string, body = "Follow these instructions.") => {
    await mkdir(dir, { recursive: true });
    const path = join(dir, "SKILL.md");
    await writeFile(path, `---\nname: catalog-test-unique\ndescription: Test skill.\n---\n${body}`);
    return path;
  };
  return { cwd, agentDir, add };
}

describe("bundled skill catalog and load tracing", () => {
  it("places bundled skills above project auto and global skills, below explicit project paths", async () => {
    const { cwd, agentDir, add } = await fixture();
    const bundled = await add(join(cwd, "skills", "demo"));
    await add(join(cwd, ".pi", "skills", "demo"));
    await add(join(agentDir, "skills", "demo"));
    let catalog = await loadSkillCatalog(cwd, agentDir, SettingsManager.create(cwd, agentDir), true);
    expect(catalog.skills.find((skill) => skill.name === "catalog-test-unique")).toMatchObject({ filePath: bundled, sourceInfo: { source: "project-bundled" } });
    expect(catalog.diagnostics.some((entry) => entry.type === "collision" && entry.collision?.winnerPath === bundled)).toBe(true);
    const explicit = await add(join(cwd, "custom", "demo"));
    await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ skills: [explicit] }));
    catalog = await loadSkillCatalog(cwd, agentDir, SettingsManager.create(cwd, agentDir), true);
    expect(catalog.skills.find((skill) => skill.name === "catalog-test-unique")?.filePath).toBe(explicit);
    expect(catalog.diagnostics.some((entry) => entry.collision?.winnerPath === explicit && entry.collision.loserPath === bundled)).toBe(true);
  });

  it("disables bundled skills with the existing toggle", async () => {
    const { cwd, agentDir, add } = await fixture();
    await add(join(cwd, "skills", "demo"));
    expect(await loadSkillCatalog(cwd, agentDir, SettingsManager.create(cwd, agentDir), false)).toEqual({ skills: [], diagnostics: [] });
  });

  it("expands explicit commands and records unknown and unreadable skills without model fallback", async () => {
    const { cwd, agentDir, add } = await fixture();
    const path = await add(join(cwd, "skills", "demo"));
    const { skills } = await loadSkillCatalog(cwd, agentDir, SettingsManager.create(cwd, agentDir), true);
    const events: AgentEvent[] = [];
    const tracker = new SkillLoadTracker(skills, cwd, (event) => events.push(event));
    const result = await tracker.expand("  /skill:catalog-test-unique\nSummarize this.");
    expect(result.prompt).toContain("Follow these instructions.");
    expect(result.prompt).toContain("Summarize this.");
    expect(result.prompt).not.toContain("description: Test skill");
    expect(events[0]?.data).toMatchObject({ mode: "explicit", status: "loaded", filePath: path, source: "project-bundled" });
    expect((await tracker.expand("/skill:missing args")).error).toContain("找不到 Skill");
    expect(events.at(-1)?.data).toMatchObject({ status: "failed", reason: "not_found" });
    await rm(path);
    expect((await tracker.expand("/skill:catalog-test-unique")).error).toContain("无法读取");
    expect(events.at(-1)?.data).toMatchObject({ status: "failed", reason: "read_failed" });
  });

  it("records only registered entry reads on completion, correlates failures and ignores reference reads", async () => {
    const { cwd, agentDir, add } = await fixture();
    const path = await add(join(cwd, "skills", "demo"));
    const { skills } = await loadSkillCatalog(cwd, agentDir, SettingsManager.create(cwd, agentDir), true);
    const events: AgentEvent[] = [];
    const tracker = new SkillLoadTracker(skills, cwd, (event) => events.push(event));
    expect(await tracker.expand("Please summarize this")).toEqual({ prompt: "Please summarize this" });
    tracker.observe({ type: "tool_execution_start", toolName: "read", toolCallId: "a", args: { path } });
    tracker.observe({ type: "tool_execution_start", toolName: "read", toolCallId: "b", args: { path: "skills/demo/SKILL.md" } });
    tracker.observe({ type: "tool_execution_start", toolName: "read", toolCallId: "c", args: { path: join(cwd, "skills/demo/references/doc.md") } });
    expect(events).toHaveLength(0);
    tracker.observe({ type: "tool_execution_end", toolName: "read", toolCallId: "b", isError: true });
    tracker.observe({ type: "tool_execution_end", toolName: "read", toolCallId: "a", isError: false });
    tracker.observe({ type: "tool_execution_end", toolName: "read", toolCallId: "c", isError: false });
    tracker.observe({ type: "tool_execution_end", toolName: "read", toolCallId: "a", isError: false });
    expect(events.map((event) => event.data)).toEqual([
      expect.objectContaining({ mode: "model", toolCallId: "b", status: "failed" }),
      expect.objectContaining({ mode: "model", toolCallId: "a", status: "loaded" }),
    ]);
  });
});

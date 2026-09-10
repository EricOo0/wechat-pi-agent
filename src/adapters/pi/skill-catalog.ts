import { realpathSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { DefaultPackageManager, loadSkills, stripFrontmatter, type SettingsManager, type Skill } from "@earendil-works/pi-coding-agent";
import type { AgentEvent } from "../../modules/observability/index.js";

import { skillPathsWithBundled } from "../../modules/skills/index.js";
export { skillPathsWithBundled } from "../../modules/skills/index.js";

export async function loadSkillCatalog(cwd: string, agentDir: string, settingsManager: SettingsManager, enabled: boolean) {
  if (!enabled) return { skills: [], diagnostics: [] };
  const resources = await new DefaultPackageManager({ cwd, agentDir, settingsManager }).resolve();
  const bundled = join(cwd, "skills");
  const result = loadSkills({ cwd, agentDir, skillPaths: skillPathsWithBundled(resources.skills, bundled), includeDefaults: false });
  for (const skill of result.skills) {
    const resource = resources.skills.find((entry) => skill.filePath === entry.path || skill.filePath.startsWith(`${entry.path}/`));
    // A path explicitly configured in Pi retains its explicit origin.
    const explicitProject = resource?.metadata.scope === "project" && resource.metadata.source === "local" && resource.metadata.origin !== "package";
    if (skill.filePath.startsWith(`${bundled}/`) && !explicitProject) {
      skill.sourceInfo = { path: skill.filePath, source: "project-bundled", scope: "project", origin: "top-level", baseDir: bundled };
    } else if (resource) {
      skill.sourceInfo = { path: skill.filePath, ...resource.metadata };
    }
  }
  return result;
}

export function skillIdentity(skill: Skill): { name: string; filePath: string; source: string; scope: string; origin: string } {
  return { name: skill.name, filePath: skill.filePath, source: skill.sourceInfo.source, scope: skill.sourceInfo.scope, origin: skill.sourceInfo.origin };
}

export class SkillLoadTracker {
  private readonly reads = new Map<string, Skill>();
  private readonly byPath = new Map<string, Skill>();
  public constructor(private readonly skills: Skill[], private readonly workspace: string, private readonly emit: (event: AgentEvent) => void) {
    for (const skill of skills) this.byPath.set(canonical(skill.filePath), skill);
  }

  public async expand(prompt: string): Promise<{ prompt: string; error?: string }> {
    const input = prompt.trimStart();
    if (!input.startsWith("/skill:")) return { prompt };
    const match = /^\/skill:([^\s]+)(?:\s+([\s\S]*))?$/.exec(input);
    const name = match?.[1] ?? "";
    const skill = this.skills.find((entry) => entry.name === name);
    if (!skill) {
      this.record({ mode: "explicit", requestedName: name, status: "failed", reason: "not_found" });
      return { prompt, error: `找不到 Skill：${name || "（未指定名称）"}。请使用 /skill:名称 参数，并确认该 Skill 已启用。` };
    }
    let body: string;
    try {
      body = stripFrontmatter(await readFile(skill.filePath, "utf8")).trim();
    } catch {
      this.record({ mode: "explicit", requestedName: name, ...skillIdentity(skill), status: "failed", reason: "read_failed" });
      return { prompt, error: `无法读取 Skill：${name}。请检查文件是否存在且可读。` };
    }
    const expanded = `<skill name="${skill.name}" location="${skill.filePath}">\nReferences are relative to ${skill.baseDir}.\n\n${body}\n</skill>`;
    this.record({ mode: "explicit", requestedName: name, ...skillIdentity(skill), status: "loaded" });
    return { prompt: match?.[2] ? `${expanded}\n\n${match[2].trim()}` : expanded };
  }

  public observe(event: { type: string; toolName?: string; toolCallId?: string; args?: unknown; isError?: boolean }): void {
    if (event.toolName !== "read" || !event.toolCallId) return;
    if (event.type === "tool_execution_start") {
      const path = (event.args as { path?: unknown } | undefined)?.path;
      if (typeof path !== "string") return;
      const skill = this.byPath.get(canonical(resolve(this.workspace, path)));
      if (skill) this.reads.set(event.toolCallId, skill);
    } else if (event.type === "tool_execution_end") {
      const skill = this.reads.get(event.toolCallId);
      if (!skill) return;
      this.reads.delete(event.toolCallId);
      this.record({ mode: "model", ...skillIdentity(skill), toolCallId: event.toolCallId, status: event.isError ? "failed" : "loaded", ...(event.isError ? { reason: "read_failed" } : {}) });
    }
  }

  private record(data: Record<string, unknown>): void { this.emit({ type: "skill_load", at: new Date(), data }); }
}

function canonical(path: string): string {
  try { return realpathSync(path); } catch { return resolve(path); }
}

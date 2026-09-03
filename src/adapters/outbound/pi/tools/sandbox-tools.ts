import { constants } from "node:fs";
import { lstat, mkdir, open, readdir, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { defineTool } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const MAX_READ_BYTES = 512 * 1024;
const MAX_WRITE_BYTES = 256 * 1024;
const MAX_LIST_ENTRIES = 200;

export interface SandboxToolOptions {
  sandboxRoot: string;
  skillRoots: string[];
}

export async function createSandboxTools(options: SandboxToolOptions) {
  await mkdir(options.sandboxRoot, { recursive: true, mode: 0o700 });
  const sandboxRoot = await realpath(options.sandboxRoot);
  const skillRoots = await Promise.all(options.skillRoots.map((root) => realpath(root)));
  const readRoots = [...new Set([sandboxRoot, ...skillRoots])];

  const readTool = defineTool({
    name: "read",
    label: "Read sandbox or skill file",
    description: "Read a UTF-8 text file. Relative paths resolve inside the tool sandbox. Absolute paths are allowed only inside the sandbox or a loaded Pi Skill directory.",
    promptSnippet: "Read text files from the isolated workspace or loaded Skill directories",
    promptGuidelines: ["Use read to load a matching Skill's SKILL.md before following it."],
    parameters: Type.Object({ path: Type.String({ description: "Relative sandbox path or an absolute path shown in the available-skills list" }) }),
    async execute(_toolCallId, params) {
      const target = await resolveReadablePath(params.path, sandboxRoot, readRoots);
      const metadata = await stat(target);
      if (!metadata.isFile()) throw new Error("Path is not a file");
      if (metadata.size > MAX_READ_BYTES) throw new Error(`File exceeds ${MAX_READ_BYTES} byte read limit`);
      const handle = await open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
      try {
        const data = await handle.readFile();
        if (data.includes(0)) throw new Error("Binary files are not supported");
        return { content: [{ type: "text" as const, text: data.toString("utf8") }], details: { path: target, bytes: data.length } };
      } finally {
        await handle.close();
      }
    },
  });

  const listTool = defineTool({
    name: "list_files",
    label: "List sandbox or skill directory",
    description: "List one directory level inside the isolated workspace or a loaded Pi Skill directory.",
    promptSnippet: "List files in the isolated workspace or loaded Skill directories",
    parameters: Type.Object({ path: Type.Optional(Type.String({ description: "Directory path; defaults to the sandbox root" })) }),
    async execute(_toolCallId, params) {
      const target = await resolveReadablePath(params.path ?? ".", sandboxRoot, readRoots);
      const metadata = await stat(target);
      if (!metadata.isDirectory()) throw new Error("Path is not a directory");
      const entries = (await readdir(target, { withFileTypes: true }))
        .slice(0, MAX_LIST_ENTRIES)
        .map((entry) => `${entry.isDirectory() ? "d" : entry.isSymbolicLink() ? "l" : "f"} ${entry.name}`);
      return { content: [{ type: "text" as const, text: entries.join("\n") || "(empty directory)" }], details: { path: target, count: entries.length } };
    },
  });

  const writeTool = defineTool({
    name: "sandbox_write",
    label: "Write sandbox file",
    description: "Create or replace a UTF-8 text file inside the isolated tool sandbox. Absolute paths and symlinks are rejected.",
    promptSnippet: "Write a UTF-8 text file inside the isolated workspace",
    promptGuidelines: ["Only write files when the user explicitly asks for a persistent artifact or modification."],
    parameters: Type.Object({
      path: Type.String({ description: "Relative path inside the isolated workspace" }),
      content: Type.String({ description: "Complete UTF-8 file content" }),
    }),
    executionMode: "sequential",
    async execute(_toolCallId, params) {
      if (Buffer.byteLength(params.content, "utf8") > MAX_WRITE_BYTES) {
        throw new Error(`Content exceeds ${MAX_WRITE_BYTES} byte write limit`);
      }
      const target = resolveSandboxWritePath(params.path, sandboxRoot);
      await ensureSafeParent(target, sandboxRoot);
      try {
        const existing = await lstat(target);
        if (existing.isSymbolicLink() || !existing.isFile()) throw new Error("Target must be a regular file");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      const handle = await open(target, constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
      try {
        await handle.writeFile(params.content, "utf8");
      } finally {
        await handle.close();
      }
      return {
        content: [{ type: "text" as const, text: `Wrote ${Buffer.byteLength(params.content, "utf8")} bytes to ${relative(sandboxRoot, target)}` }],
        details: { path: target },
      };
    },
  });

  return [readTool, listTool, writeTool];
}

async function resolveReadablePath(input: string, sandboxRoot: string, allowedRoots: string[]): Promise<string> {
  const candidate = isAbsolute(input) ? resolve(input) : resolve(sandboxRoot, input);
  const target = await realpath(candidate);
  if (!allowedRoots.some((root) => isWithin(target, root))) throw new Error("Path is outside the allowed read roots");
  return target;
}

function resolveSandboxWritePath(input: string, sandboxRoot: string): string {
  if (isAbsolute(input)) throw new Error("Write path must be relative to the sandbox root");
  const target = resolve(sandboxRoot, input);
  if (!isWithin(target, sandboxRoot) || target === sandboxRoot) throw new Error("Write path is outside the sandbox root");
  return target;
}

async function ensureSafeParent(target: string, sandboxRoot: string): Promise<void> {
  const parentRelative = relative(sandboxRoot, resolve(target, ".."));
  let current = sandboxRoot;
  for (const segment of parentRelative.split(sep).filter(Boolean)) {
    current = resolve(current, segment);
    try {
      const metadata = await lstat(current);
      if (metadata.isSymbolicLink() || !metadata.isDirectory()) throw new Error("Write parent contains a symlink or non-directory");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await mkdir(current, { mode: 0o700 });
    }
  }
}

function isWithin(target: string, root: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith(`..${sep}`) && path !== ".." && !isAbsolute(path));
}

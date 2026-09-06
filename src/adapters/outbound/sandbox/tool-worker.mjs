import { realpath, readFile, writeFile, readdir, mkdir, stat } from "node:fs/promises";
import { resolve, dirname, sep } from "node:path";
import { spawn } from "node:child_process";

const MAX = 512000;
const within = (path, root) => path === root || path.startsWith(root.endsWith(sep) ? root : root + sep);
async function canonical(path) {
  try { return await realpath(path); }
  catch (error) {
    if (error.code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(await canonical(parent), path.slice(parent.length + (parent.endsWith(sep) ? 0 : 1)));
  }
}
async function pathFor(policy, path, write = false) {
  const target = await canonical(resolve(policy.workspaceRoot, path));
  if (policy.mode === "full-access") return target;
  // Denied targets cannot be realpathed from inside Seatbelt. Trusted configuration
  // supplies absolute paths; the OS independently enforces canonical path denials.
  const denies = [...policy.deniedPaths, ...(write ? policy.protectedWritePaths ?? [] : [])].map((path) => resolve(path));
  const roots = await Promise.all((write ? policy.writeRoots : policy.readRoots).map(canonical));
  if (denies.some((root) => within(target, root)) || !roots.some((root) => within(target, root))) throw new Error("File permission denied");
  return target;
}
async function run(command, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let text = "";
    let overflow = false;
    const collect = (chunk) => { text += chunk.toString(); if (Buffer.byteLength(text) > MAX) { overflow = true; child.kill("SIGKILL"); } };
    child.stdout.on("data", collect); child.stderr.on("data", collect);
    child.on("error", reject);
    child.on("close", (code) => overflow ? reject(new Error("Tool output exceeded limit")) : resolve({ text, details: { exitCode: code } }));
  });
}
try {
  let input = "";
  for await (const chunk of process.stdin) { input += chunk; if (input.length > 2000000) throw new Error("Input exceeded limit"); }
  const { policy, operation: op } = JSON.parse(input);
  let result;
  switch (op.kind) {
    case "read": {
      const path = await pathFor(policy, op.path);
      if ((await stat(path)).size > MAX) throw new Error("File exceeds read limit");
      result = { text: await readFile(path, "utf8") }; break;
    }
    case "list": result = { text: (await readdir(await pathFor(policy, op.path))).slice(0, 1000).join("\n") }; break;
    case "write": {
      if (Buffer.byteLength(op.content) > MAX) throw new Error("Write exceeds limit");
      const path = await pathFor(policy, op.path, true);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, op.content, "utf8"); result = { text: `Written ${path}` }; break;
    }
    case "bash":
      if (policy.mode !== "full-access" && !policy.shell) throw new Error("Shell permission required");
      result = await run("/bin/bash", ["--noprofile", "--norc", "-c", op.command]); break;
    case "http": {
      const url = new URL(op.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Only HTTPS URLs without credentials are allowed");
      if (policy.mode !== "full-access" && !policy.allowedDomains.some((domain) => domain === "*" || domain === url.hostname || (domain.startsWith("*.") && url.hostname.endsWith(domain.slice(1))))) throw new Error("Network permission required");
      // curl obeys the sandbox proxy; no redirects, so target approval cannot silently change.
      result = await run("/usr/bin/curl", ["--disable", "--silent", "--show-error", "--fail", "--max-time", "30", "--max-filesize", String(MAX), "--proto", "=https", "--", url.href]);
      if (result.details.exitCode !== 0) throw new Error(result.text || "HTTP request failed");
      break;
    }
    default: throw new Error("Unknown tool operation");
  }
  process.stdout.write(JSON.stringify(result));
} catch (error) { process.stdout.write(JSON.stringify({ error: String(error) })); }

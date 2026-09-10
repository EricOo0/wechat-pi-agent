import { spawn } from "node:child_process";
import { realpath, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { SandboxManager, SandboxRuntimeConfigSchema } from "@anthropic-ai/sandbox-runtime";

const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
try {
  let input = "";
  for await (const chunk of process.stdin) {
    input += chunk;
    if (input.length > 2000000) throw new Error("Tool input exceeded limit");
  }
  const { policy, operation, toolTmp: allocatedToolTmp } = JSON.parse(input);
  const toolTmp = await realpath(allocatedToolTmp);
  const brokerTmp = await realpath(process.env.TMPDIR);
  await mkdir(policy.workspaceRoot, { recursive: true });
  const worker = await realpath(fileURLToPath(new URL("./tool-worker.mjs", import.meta.url)));
  // sandbox-runtime supplies its own TMPDIR in the wrapper; set the worker value inside it.
  let command = `/usr/bin/env ${quote(`TMPDIR=${toolTmp}`)} ${quote(process.execPath)} ${quote(worker)}`;
  if (policy.mode !== "full-access") {
    if (process.platform !== "darwin" && process.platform !== "linux") throw new Error("Sandbox platform unsupported");
    const dependencies = await SandboxManager.checkDependenciesAsync();
    if (dependencies.errors.length) throw new Error(`Sandbox unavailable: ${dependencies.errors.join(", ")}`);
    const runtime = await realpath(process.execPath);
    const allNetwork = policy.allowedDomains.includes("*");
    await SandboxManager.initialize(SandboxRuntimeConfigSchema.parse({
      filesystem: {
        denyRead: ["/**", ...policy.deniedPaths, brokerTmp],
        allowRead: ["/usr", "/bin", "/sbin", "/System", "/Library/Apple", "/opt/homebrew/Cellar", "/opt/homebrew/opt", "/usr/local/lib", "/dev", "/private/etc", "/etc", runtime, dirname(runtime), worker, toolTmp, ...policy.readRoots],
        allowWrite: [...policy.writeRoots, toolTmp],
        denyWrite: [
          ...policy.deniedPaths, ...(policy.protectedWritePaths ?? []), worker, runtime, brokerTmp,
          // A later trusted supervisor loads this runtime and its shared libraries.
          // Restricted tools must never be able to replace those dependencies.
          "/opt/homebrew", "/usr/local", "/usr", "/bin", "/sbin", "/System", "/Library",
          dirname(runtime), ...(dirname(dirname(runtime)) === "/" ? [] : [dirname(dirname(runtime))]),
        ],
      },
      network: { allowedDomains: policy.allowedDomains.filter((domain) => domain !== "*"), deniedDomains: (policy.deniedNetworkPorts ?? []).map((port) => `*:${port}`), strictAllowlist: !allNetwork, allowLocalBinding: false, allowAllUnixSockets: false },
      allowPty: false,
    }), allNetwork ? () => Promise.resolve(true) : undefined, false);
    command = await SandboxManager.wrapWithSandbox(command, "/bin/bash");
    if (!SandboxManager.isSandboxingEnabled()) throw new Error("Sandbox failed to initialize");
  }
  const child = spawn("/bin/bash", ["--noprofile", "--norc", "-c", command], {
    cwd: policy.workspaceRoot, env: { ...process.env, TMPDIR: toolTmp }, stdio: ["pipe", "pipe", "pipe"],
  });
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  child.stdin.on("error", () => {});
  child.stdin.end(JSON.stringify({ policy, operation }));
  const code = await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) => resolve(code ?? 1));
  });
  await SandboxManager.reset();
  process.exit(code);
} catch (error) {
  process.stderr.write(String(error));
  await SandboxManager.reset().catch(() => {});
  process.exit(1);
}

import { spawn, type ChildProcess } from "node:child_process";
import { mkdtempSync, realpathSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { SandboxExecutor } from "../../modules/execution/index.js";
import type { ExecutionPolicy, ToolOperation, ToolOutput } from "../../modules/permissions/index.js";

/** Each supervisor owns its own sandbox-runtime proxy/configuration state. */
export class LocalSandboxExecutor implements SandboxExecutor {
  private readonly running = new Map<ChildProcess, { subject: string; cancel: () => void }>();
  private closed = false;

  execute(policy: ExecutionPolicy, operation: ToolOperation, signal?: AbortSignal): Promise<ToolOutput> {
    if (this.closed) return Promise.reject(new Error("Sandbox executor is closed"));
    if (signal?.aborted) return Promise.reject(new Error("Tool execution cancelled"));
    if (operation.kind === "bash" && policy.mode !== "full-access" && !policy.shell) {
      return Promise.reject(new Error("Shell permission is required"));
    }
    const env = policy.mode === "full-access" ? { ...process.env } : {
      PATH: "/usr/bin:/bin:/usr/sbin:/sbin:/opt/homebrew/bin:/usr/local/bin",
      HOME: policy.workspaceRoot, TMPDIR: policy.workspaceRoot, LANG: "en_US.UTF-8", OPENSSL_CONF: "/dev/null",
    };
    // Never inherit loader hooks into a trusted supervisor, including Full Access.
    delete (env as NodeJS.ProcessEnv).NODE_OPTIONS;
    return new Promise((resolve, reject) => {
      const brokerTmp = realpathSync(mkdtempSync("/tmp/pi-srt-"));
      let toolTmp: string;
      try { toolTmp = realpathSync(mkdtempSync("/tmp/pi-tool-")); }
      catch (error) { rmSync(brokerTmp, { recursive: true, force: true }); reject(error instanceof Error ? error : new Error(String(error))); return; }
      const cleanup = () => {
        for (const path of [brokerTmp, toolTmp]) {
          try { rmSync(path, { recursive: true, force: true }); } catch { /* process may still release temporary files */ }
        }
      };
      let child: ChildProcess;
      try { child = spawn(process.execPath, [fileURLToPath(new URL("./supervisor.mjs", import.meta.url))], {
        env: { ...env, TMPDIR: brokerTmp }, detached: true, stdio: ["pipe", "pipe", "pipe"],
      }); } catch (error) { cleanup(); reject(error instanceof Error ? error : new Error(String(error))); return; }
      let output = "";
      let errorOutput = "";
      let failure: Error | undefined;
      const kill = () => {
        if (child.pid) { try { process.kill(-child.pid, "SIGKILL"); } catch { /* already exited */ } }
      };
      const cancel = () => { failure = new Error("Tool execution cancelled or permission revoked"); kill(); };
      const timeout = operation.kind === "bash" ? Math.min(Math.max((operation.timeout ?? 60) * 1000, 1000), 120000) : 60000;
      const timer = setTimeout(() => { failure = new Error("Tool execution timed out"); kill(); }, timeout);
      this.running.set(child, { subject: policy.subjectKey, cancel });
      signal?.addEventListener("abort", cancel, { once: true });
      child.stdout!.on("data", (chunk: Buffer) => {
        output += chunk.toString();
        if (Buffer.byteLength(output) > (operation.kind === "read-binary" ? 14_000_000 : 1_100_000)) { failure = new Error("Tool output exceeded limit"); kill(); }
      });
      child.stderr!.on("data", (chunk: Buffer) => { errorOutput = (errorOutput + chunk.toString()).slice(-4096); });
      child.on("error", (error) => { failure = error; });
      child.stdin!.on("error", () => { /* close reports startup failure */ });
      child.on("close", (code) => {
        kill(); // Also reap background descendants after successful shell exit.
        clearTimeout(timer);
        signal?.removeEventListener("abort", cancel);
        this.running.delete(child);
        cleanup();
        if (failure) { reject(failure); return; }
        if (code !== 0) { reject(new Error(`Sandbox execution failed: ${errorOutput || output || String(code)}`)); return; }
        try {
          const value = JSON.parse(output) as { text?: unknown; details?: Record<string, unknown>; error?: string };
          if (value.error) throw new Error(value.error);
          if (typeof value.text !== "string") throw new Error("Invalid worker response");
          resolve({ text: value.text, ...(value.details ? { details: value.details } : {}) });
        } catch (error) { reject(error instanceof Error ? error : new Error("Invalid worker response")); }
      });
      child.stdin!.end(JSON.stringify({ policy, operation, toolTmp }));
    });
  }

  revoke(subjectKey: string): void {
    for (const run of this.running.values()) if (run.subject === subjectKey) run.cancel();
  }
  close(): void {
    this.closed = true;
    for (const run of this.running.values()) run.cancel();
  }
}

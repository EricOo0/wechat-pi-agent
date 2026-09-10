import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { LocalSandboxExecutor } from "../src/adapters/sandbox/local-sandbox-executor.js";
import type { ExecutionPolicy } from "../src/modules/permissions/domain/permissions.js";

describe.skipIf(process.platform !== "darwin")("Seatbelt tool executor", () => {
  let executor: LocalSandboxExecutor;
  let root: string;
  let outside: string;
  let policy: ExecutionPolicy;
  beforeEach(async () => {
    executor = new LocalSandboxExecutor();
    root = await realpath(await mkdtemp("/tmp/pi-seatbelt-"));
    outside = await realpath(await mkdtemp("/tmp/pi-seatbelt-outside-"));
    policy = { subjectKey: "one", revision: 1, mode: "restricted", shell: true, workspaceRoot: root, readRoots: [root], writeRoots: [root], deniedPaths: [], allowedDomains: [] };
  });
  afterEach(async () => { executor.close(); await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); });

  it("allows workspace tools but rejects outside reads, writes and symlinks", async () => {
    await executor.execute(policy, { kind: "write", path: "ok", content: "hello" });
    expect((await executor.execute(policy, { kind: "read", path: "ok" })).text).toBe("hello");
    await writeFile(`${outside}/secret`, "private");
    await expect(executor.execute(policy, { kind: "read", path: `${outside}/secret` })).rejects.toThrow();
    await expect(executor.execute(policy, { kind: "write", path: `${outside}/new`, content: "no" })).rejects.toThrow();
    const result = await executor.execute(policy, { kind: "bash", command: `ln -s '${outside}' link; cat link/secret; echo no > '${outside}/new'` });
    expect(result.details?.exitCode).not.toBe(0);
    expect(result.text).toMatch(/not permitted|Permission denied/);
  });
  it("does not leak environment secrets and blocks direct network egress", async () => {
    process.env.PI_EXECUTOR_TEST_SECRET = "must-not-leak";
    try {
      const result = await executor.execute(policy, { kind: "bash", command: 'echo "${PI_EXECUTOR_TEST_SECRET-unset}"; /usr/bin/curl --noproxy "*" --connect-timeout 2 http://127.0.0.1:1' });
      expect(result.text).toContain("unset");
      expect(result.text).not.toContain("must-not-leak");
      expect(result.details?.exitCode).not.toBe(0);
    } finally { delete process.env.PI_EXECUTOR_TEST_SECRET; }
  });
  it("denies protected local ports through the proxy despite wildcard network access", async () => {
    let hits = 0;
    const server = createServer((_request, response) => { hits++; response.end("control secret"); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("Missing test port");
    try {
      const allowed = await executor.execute({ ...policy, allowedDomains: ["*"] }, { kind: "bash", command: `/usr/bin/curl --disable --fail --silent --show-error --noproxy '' --proxy "$HTTP_PROXY" 'http://127.0.0.1:${address.port}/'` });
      expect(allowed.text).toBe("control secret");
      expect(hits).toBe(1);
      hits = 0;
      const guarded = { ...policy, allowedDomains: ["*"], deniedNetworkPorts: [address.port] };
      const result = await executor.execute(guarded, { kind: "bash", command: `/usr/bin/curl --disable --fail --silent --show-error --noproxy '' --proxy "$HTTP_PROXY" 'http://127.0.0.1:${address.port}/'; /usr/bin/curl --disable --fail --silent --show-error --noproxy '' --proxy "$HTTP_PROXY" 'http://localhost:${address.port}/'` });
      expect(result.details?.exitCode).not.toBe(0);
      expect(result.text).not.toContain("control secret");
      expect(hits).toBe(0);
    } finally { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); }
  });
  it("supports explicit Full Access outside workspace and denies shell otherwise", async () => {
    await executor.execute({ ...policy, mode: "full-access", shell: false }, { kind: "bash", command: `echo yes > '${outside}/full'` });
    expect(await readFile(`${outside}/full`, "utf8")).toBe("yes\n");
    await expect(executor.execute({ ...policy, shell: false }, { kind: "bash", command: "true" })).rejects.toThrow("Shell permission");
  });
  it("keeps concurrent users' policies isolated", async () => {
    await writeFile(`${outside}/secret`, "private");
    const other = { ...policy, subjectKey: "two", workspaceRoot: outside, readRoots: [outside], writeRoots: [outside] };
    const [denied, allowed] = await Promise.all([
      executor.execute(policy, { kind: "bash", command: `cat '${outside}/secret'` }),
      executor.execute(other, { kind: "read", path: "secret" }),
    ]);
    expect(denied.details?.exitCode).not.toBe(0);
    expect(allowed.text).toBe("private");
  });
  it("keeps nested control paths denied when their ancestor is granted", async () => {
    await writeFile(`${root}/secret`, "private");
    const locked = { ...policy, deniedPaths: [`${root}/secret`] };
    const result = await executor.execute(locked, { kind: "bash", command: "cat secret; mv secret renamed; cat renamed; echo overwrite > secret" });
    expect(result.text).not.toContain("private");
    expect(result.details?.exitCode).not.toBe(0);
    expect(await readFile(`${root}/secret`, "utf8")).toBe("private");
  });
  it("revokes running commands and kills background descendants", async () => {
    const pending = executor.execute(policy, { kind: "bash", command: "sleep 30 & wait" });
    const rejection = expect(pending).rejects.toThrow(/revoked/);
    setTimeout(() => executor.revoke("one"), 500);
    await rejection;
    await expect(executor.execute(policy, { kind: "read", path: "missing" })).rejects.toThrow();
  });
  it("fails closed when sandbox configuration initialization fails", async () => {
    await expect(executor.execute({ ...policy, allowedDomains: ["https://invalid"] }, { kind: "bash", command: `echo bad > '${outside}/bad'` })).rejects.toThrow();
    await expect(readFile(`${outside}/bad`)).rejects.toThrow();
  });
});

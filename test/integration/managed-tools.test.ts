import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgentTools } from "../../src/adapters/outbound/pi/tools/index.js";
import { LocalSandboxExecutor } from "../../src/adapters/outbound/sandbox/local-sandbox-executor.js";
import { SqlitePermissionRepository } from "../../src/adapters/outbound/sqlite/sqlite-permission-repository.js";
import { PermissionService, type PermissionContext } from "../../src/application/services/permission-service.js";
import { PolicyCompiler } from "../../src/application/services/policy-compiler.js";
import type { InboundMessage } from "../../src/domain/messaging/inbound-message.js";
import { principalId, subjectKey } from "../../src/domain/policy/permissions.js";

describe.skipIf(process.platform !== "darwin")("managed Pi tools through Seatbelt", () => {
  let root: string;
  let repo: SqlitePermissionRepository;
  let executor: LocalSandboxExecutor;
  let permissions: PermissionService;
  let compiler: PolicyCompiler;
  let context: PermissionContext;
  let tools: ReturnType<typeof createAgentTools>;
  let seq: number;
  const message = (text: string): InboundMessage => ({ id: String(++seq), channelMessageId: String(seq), accountId: "bot", senderId: "owner", peerId: "peer", text, receivedAt: new Date() });
  const invoke = (name: string, params: unknown) => {
    const tool = tools.find((candidate) => candidate.name === name);
    if (!tool) throw new Error("Missing tool");
    return tool.execute(`tool-${++seq}`, params as never, undefined, undefined, {} as never);
  };
  beforeEach(() => {
    seq = 0; root = realpathSync(mkdtempSync("/tmp/pi-managed-tools-"));
    repo = new SqlitePermissionRepository(`${root}/permissions.db`); executor = new LocalSandboxExecutor();
    permissions = new PermissionService(repo, { executorId: "machine", workspaceId: "project", ownerPrincipalId: principalId("bot", "owner"), protectedPaths: [`${root}/permissions.db`], onChange: (subject) => executor.revoke(subjectKey(subject)) });
    compiler = new PolicyCompiler({ workspaceBase: `${root}/workspaces`, skillRoots: [], deniedPaths: [`${root}/permissions.db`], protectedWritePaths: [] });
    context = permissions.context(message("hello"), "session");
    tools = createAgentTools({ context: () => context, permissions, compiler, executor });
  });
  afterEach(() => { executor.close(); repo.close(); rmSync(root, { recursive: true, force: true }); });

  it("defaults to basic permissions and applies an approved Full Access grant then reset to the SAME tools", async () => {
    await invoke("sandbox_write", { path: "note.txt", content: "basic" });
    const content = await invoke("read", { path: "note.txt" });
    expect(content.content).toContainEqual({ type: "text", text: "basic" });
    await expect(invoke("bash", { command: "true" })).rejects.toThrow("Shell permission");
    await expect(invoke("sandbox_write", { path: `${root}/outside.txt`, content: "no" })).rejects.toThrow();
    const request = await invoke("permissions_request", { kind: "full-access", lifetime: "persistent" });
    expect(request.details).toMatchObject({ granted: false });
    await expect(invoke("bash", { command: "true" })).rejects.toThrow("Shell permission");
    const id = repo.listRequests(context.subject).at(-1)!.id;
    permissions.handleMessage(message(`确认授权 ${id}`), "session");
    await invoke("bash", { command: `printf full > '${root}/outside.txt'` });
    expect(readFileSync(`${root}/outside.txt`, "utf8")).toBe("full");
    permissions.handleMessage(message("恢复基本权限"), "session");
    await expect(invoke("bash", { command: "true" })).rejects.toThrow("Shell permission");
    await expect(invoke("read", { path: `${root}/outside.txt` })).rejects.toThrow();
  });

  it("permits a granted directory once without leaking the grant to a second operation", async () => {
    mkdirSync(`${root}/artifacts`);
    await invoke("permissions_request", { kind: "write", resource: `${root}/artifacts`, lifetime: "once" });
    const id = repo.listRequests(context.subject).at(-1)!.id;
    permissions.handleMessage(message(`确认授权 ${id}`), "session");
    await invoke("sandbox_write", { path: `${root}/artifacts/once.txt`, content: "one" });
    await expect(invoke("sandbox_write", { path: `${root}/artifacts/twice.txt`, content: "two" })).rejects.toThrow();
  });
});

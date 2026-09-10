import { mkdtempSync, mkdirSync, realpathSync, rmSync, symlinkSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { PolicyCompiler } from "../../../src/adapters/sandbox/policy-compiler.js";
import { basicPolicy } from "../../../src/modules/permissions/domain/permissions.js";
const dirs: string[] = [];
afterEach(() => { for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }); });
function fixture() {
  const root = realpathSync(mkdtempSync("/tmp/pi-policy-")); dirs.push(root);
  const compiler = new PolicyCompiler({ workspaceBase: `${root}/users`, skillRoots: [], deniedPaths: [], protectedWritePaths: [] });
  const snapshot = { principalId: "alice", executorId: "host", workspaceId: "project", revision: 1, policy: basicPolicy() };
  return { root, compiler, snapshot };
}
describe("policy compiler isolation", () => {
  it("isolates default user roots and rejects ancestor and sibling grants", () => {
    const { root, compiler, snapshot } = fixture();
    const alice = compiler.compile(snapshot);
    const bob = compiler.compile({ ...snapshot, principalId: "bob" });
    expect(alice.workspaceRoot).not.toBe(bob.workspaceRoot);
    for (const path of [root, `${root}/users`, bob.workspaceRoot]) {
      expect(() => compiler.compile({ ...snapshot, policy: { ...basicPolicy(), readRoots: [path] } })).toThrow(/overlaps other users/);
    }
    expect(compiler.compile({ ...snapshot, policy: { ...basicPolicy(), writeRoots: [alice.workspaceRoot] } }).writeRoots).toEqual([alice.workspaceRoot]);
    expect(compiler.compile({ ...snapshot, policy: { ...basicPolicy(), mode: "full-access", readRoots: [root] } }).mode).toBe("full-access");
  });
  it("rejects a directory grant retargeted through a symlink", () => {
    const { root, compiler, snapshot } = fixture();
    mkdirSync(`${root}/granted`); mkdirSync(`${root}/other`);
    const grant = { ...snapshot, policy: { ...basicPolicy(), readRoots: [`${root}/granted`] } };
    compiler.compile(grant);
    rmSync(`${root}/granted`, { recursive: true }); symlinkSync(`${root}/other`, `${root}/granted`);
    expect(() => compiler.compile(grant)).toThrow(/root changed/);
  });
});

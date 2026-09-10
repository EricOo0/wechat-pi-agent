import { mkdirSync, realpathSync } from "node:fs";
import { join, relative, isAbsolute, sep } from "node:path";
import { subjectKey, type ExecutionPolicy, type PermissionSnapshot, type PermissionSubject } from "../../modules/permissions/index.js";

export interface PolicyCompilerOptions {
  workspaceBase: string;
  skillRoots: string[];
  deniedPaths: string[];
  protectedWritePaths: string[];
  deniedNetworkPorts?: number[];
}

export class PolicyCompiler {
  private readonly base: string;
  public constructor(private readonly options: PolicyCompilerOptions) {
    mkdirSync(options.workspaceBase, { recursive: true, mode: 0o700 });
    this.base = realpathSync(options.workspaceBase);
  }

  public workspace(subject: PermissionSubject): string {
    const root = join(this.base, subjectKey(subject));
    mkdirSync(root, { recursive: true, mode: 0o700 });
    if (realpathSync(root) !== root) throw new Error("User workspace was replaced by a symlink");
    return root;
  }

  public compile(snapshot: PermissionSnapshot): ExecutionPolicy {
    const workspaceRoot = this.workspace(snapshot);
    const roots = [...snapshot.policy.readRoots, ...snapshot.policy.writeRoots, ...this.options.skillRoots];
    if (snapshot.policy.mode !== "full-access") {
      for (const root of [...snapshot.policy.readRoots, ...snapshot.policy.writeRoots]) {
        if ((within(root, this.base) || within(this.base, root)) && !within(root, workspaceRoot)) throw new Error("Permission root overlaps other users' workspaces");
      }
      for (const root of roots) {
        if (realpathSync(root) !== root) throw new Error(`Permission root changed: ${root}`);
      }
    }
    return {
      subjectKey: subjectKey(snapshot), revision: snapshot.revision, mode: snapshot.policy.mode,
      shell: snapshot.policy.shell, workspaceRoot,
      readRoots: [...new Set([workspaceRoot, ...roots])],
      writeRoots: [...new Set([workspaceRoot, ...snapshot.policy.writeRoots])],
      deniedPaths: this.options.deniedPaths,
      protectedWritePaths: [...this.options.protectedWritePaths, ...this.options.skillRoots],
      allowedDomains: snapshot.policy.allowedDomains,
      deniedNetworkPorts: this.options.deniedNetworkPorts ?? [],
    };
  }
}

function within(path: string, root: string): boolean {
  const suffix = relative(root, path);
  return suffix === "" || (suffix !== ".." && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
}

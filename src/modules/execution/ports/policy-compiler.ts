import type { PermissionSubject, PermissionSnapshot, ExecutionPolicy } from "../../permissions/index.js";
export interface ExecutionPolicyCompiler {
  workspace(subject: PermissionSubject): string;
  compile(snapshot: PermissionSnapshot): ExecutionPolicy;
}

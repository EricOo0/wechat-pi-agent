import { createHash } from "node:crypto";
import { z } from "zod";

export interface PermissionSubject {
  principalId: string;
  executorId: string;
  workspaceId: string;
}

export function principalId(accountId: string, senderId: string): string {
  return createHash("sha256").update(JSON.stringify(["weixin", accountId, senderId])).digest("hex");
}

export function subjectKey(subject: PermissionSubject): string {
  return createHash("sha256").update(JSON.stringify([subject.principalId, subject.executorId, subject.workspaceId])).digest("hex");
}

const paths = z.array(z.string().min(1).max(4096)).max(32);
export const permissionPolicySchema = z.object({
  mode: z.enum(["restricted", "full-access"]),
  shell: z.boolean(),
  readRoots: paths,
  writeRoots: paths,
  allowedDomains: z.array(z.string().min(1).max(253)).max(64),
}).strict();
export type PermissionPolicy = z.infer<typeof permissionPolicySchema>;

export const permissionChangeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("full-access") }).strict(),
  z.object({ kind: z.literal("shell") }).strict(),
  z.object({ kind: z.literal("read"), resource: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal("write"), resource: z.string().min(1).max(4096) }).strict(),
  z.object({ kind: z.literal("network"), resource: z.string().min(1).max(253) }).strict(),
]);
export type PermissionChange = z.infer<typeof permissionChangeSchema>;

export interface PermissionSnapshot extends PermissionSubject {
  revision: number;
  policy: PermissionPolicy;
}

export function basicPolicy(): PermissionPolicy {
  return { mode: "restricted", shell: false, readRoots: [], writeRoots: [], allowedDomains: [] };
}

export interface ExecutionPolicy {
  subjectKey: string;
  revision: number;
  mode: "restricted" | "full-access";
  shell: boolean;
  workspaceRoot: string;
  readRoots: string[];
  writeRoots: string[];
  deniedPaths: string[];
  protectedWritePaths?: string[];
  deniedNetworkPorts?: number[];
  allowedDomains: string[];
}

export type ToolOperation =
  | { kind: "read"; path: string }
  | { kind: "list"; path: string }
  | { kind: "write"; path: string; content: string }
  | { kind: "http"; url: string }
  | { kind: "bash"; command: string; timeout?: number };

export interface ToolOutput {
  text: string;
  details?: Record<string, unknown>;
}

import type { PermissionChange, PermissionSnapshot, PermissionSubject } from "../domain/permissions.js";

export type PermissionLifetime = "persistent" | "session" | "once";
export interface PermissionRequest {
  id: string;
  subject: PermissionSubject;
  peerId: string;
  sessionId: string;
  sourceMessageId: string;
  blockedTurnId?: string;
  approvedByMessageId?: string;
  continuationCancelled?: boolean;
  change: PermissionChange;
  lifetime: PermissionLifetime;
  baseRevision: number;
  status: "pending" | "approved" | "rejected" | "revoked" | "consumed";
  expiresAt: number;
}

export interface PermissionRepository {
  transaction<T>(work: () => T): T;
  get(subject: PermissionSubject): PermissionSnapshot;
  save(snapshot: PermissionSnapshot): void;
  putRequest(request: PermissionRequest): void;
  findRequest(id: string): PermissionRequest | undefined;
  listRequests(subject: PermissionSubject): PermissionRequest[];
  receipt(messageKey: string): string | undefined;
  saveReceipt(messageKey: string, response: string): void;
  recordEvent(subject: PermissionSubject, sourceMessageId: string, action: string, data: unknown): void;
  close(): void;
}

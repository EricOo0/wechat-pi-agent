import { randomUUID } from "node:crypto";

export type IdPrefix = "ses" | "trn" | "stp" | "msg" | "out" | "evt" | "run";

export function newId(prefix: IdPrefix): string {
  return `${prefix}_${randomUUID()}`;
}

export function stableId(prefix: IdPrefix, seed: string): string {
  const normalized = seed.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 96);
  return `${prefix}_${normalized}`;
}

import { CommandRouter } from "../../messaging/index.js";
export type TaskCommand = { action: "status" | "list" | "pause" | "cancel" | "resume" } | { action: "budget"; amount: number };
export function parseTaskCommand(text: string): TaskCommand | undefined {
  const m = /^\/task\s+(status|list|pause|cancel|resume)\s*$/i.exec(text.trim());
  if (m) return { action: m[1]!.toLowerCase() as "status" | "list" | "pause" | "cancel" | "resume" };
  const budget = /^\/task\s+budget\s+(\d+)\s*$/i.exec(text.trim());
  if (budget) { const amount = Number(budget[1]); if (Number.isSafeInteger(amount) && amount > 0) return { action: "budget", amount }; }
  return undefined;
}
export function isTaskInput(text: string, hasAttachments = false): boolean {
  if (/^\/task(?:\s|$)/i.test(text.trim())) return hasAttachments;
  if (/^\/permissions(?:\s|$)/iu.test(text.trim()) || /^(?:确认授权\s+\S+|开启全部权限|打开全部权限|查看权限|恢复基本权限|撤销全部权限)$/u.test(text.trim())) return false;
  const routed = new CommandRouter().route(text);
  return routed.type === "message" || (routed.type === "management" && hasAttachments);
}

import type { Task, TaskInput, TaskEvent, TaskExecutionSummary, TaskReview } from "../domain/task.js";
export interface TaskStore {
  get(id: string, owner: string): Task | undefined;
  latest(conversationId: string, owner: string): Task | undefined;
  list(owner: string): Task[];
  inputs(id: string, owner: string): TaskInput[];
  events(id: string, owner: string): TaskEvent[];
  runs(id: string, owner: string): TaskExecutionSummary[];
  evidence(id: string, owner: string): unknown[];
  begin(id: string, owner: string, revision: number, turnId?: string): Task | undefined;
  reserveRound(id: string, owner: string, revision: number): void;
  recordReview(id: string, owner: string, requestId: string, result: TaskReview): void;
  beginReview(id: string, owner: string, revision: number, requestId: string): boolean;
  control(conversationId: string, owner: string, messageId: string, action: "pause" | "cancel" | "resume" | "budget", amount?: number): string;
  controlReceipt(messageId: string): string | undefined;
}

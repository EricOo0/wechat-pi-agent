export const INITIAL_REACT_LIMIT = 30;

export type TaskStatus = "QUEUED" | "RUNNING" | "REVIEWING" | "WAITING" | "PAUSING" | "PAUSED" | "CANCELLING" | "COMPLETED" | "FAILED" | "CANCELLED";
export type TaskDisposition = "continue" | "waiting" | "request_completion";
export type ReviewDecision = "approved" | "revise" | "waiting";

export interface Task {
  id: string;
  ownerId: string;
  conversationId: string;
  goal: string;
  revision: number;
  status: TaskStatus;
  progress: string;
  evidence: string[];
  waitQuestion?: string;
  reactLimit: number;
  reactUsed: number;
  reviewCount: number;
  stopReason?: string;
  createdAt: string;
  updatedAt: string;
}

export interface TaskOutcome {
  disposition: TaskDisposition;
  progress: string;
  remaining: string;
  evidence: string[];
  question?: string;
  result?: string;
}

export interface TaskReview {
  decision: ReviewDecision;
  reason: string;
  gaps: string[];
  nextAction?: string;
  question?: string;
  finalResult?: string;
}

const transitions: Record<TaskStatus, readonly TaskStatus[]> = {
  QUEUED: ["RUNNING", "PAUSED", "CANCELLED"],
  RUNNING: ["QUEUED", "REVIEWING", "WAITING", "PAUSING", "PAUSED", "CANCELLING", "FAILED"],
  REVIEWING: ["COMPLETED", "QUEUED", "WAITING", "PAUSING", "PAUSED", "CANCELLING", "FAILED"],
  WAITING: ["QUEUED", "PAUSED", "CANCELLED"],
  PAUSING: ["PAUSED", "CANCELLING"],
  PAUSED: ["QUEUED", "CANCELLED"],
  CANCELLING: ["CANCELLED"],
  COMPLETED: [], FAILED: [], CANCELLED: [],
};

export function assertTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!transitions[from].includes(to)) throw new Error(`Invalid task transition: ${from} -> ${to}`);
}

export function taskTerminal(status: TaskStatus): boolean {
  return status === "COMPLETED" || status === "FAILED" || status === "CANCELLED";
}

/** Call before scheduling or reserving an execution round, never for Review. */
export function remainingReact(task: Pick<Task, "reactLimit" | "reactUsed">): number {
  if (!Number.isSafeInteger(task.reactLimit) || !Number.isSafeInteger(task.reactUsed)
      || task.reactLimit < 0 || task.reactUsed < 0 || task.reactUsed > task.reactLimit) throw new Error("Invalid task budget");
  return task.reactLimit - task.reactUsed;
}

/** A completion application on round 30 is still eligible for independent Review. */
export function canRequestCompletion(task: Pick<Task, "status" | "revision">, revision: number): boolean {
  return task.status === "RUNNING" && task.revision === revision;
}

export class TaskControlError extends Error {
  public constructor(public readonly code: "TASK_BUDGET" | "TASK_STALE" | "TASK_PROTOCOL", message: string) { super(message); }
}
export interface TaskSettlement {
  turnId?: string;
  taskId: string;
  ownerId: string;
  revision: number;
  status: TaskStatus;
  progress: string;
  evidence: string[];
  question?: string;
  reason?: string;
  nextPrompt?: string;
}
export interface TaskInput { turnId: string; text: string; at: string; replyTo?: string }
export interface TaskEvent { type: string; at: string; data: unknown }

export interface TaskExecutionSummary { turnId: string; source: string; status: string; revision: number; queuedAt: string }

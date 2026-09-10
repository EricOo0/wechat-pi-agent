import type { AgentEvent } from "../../observability/index.js";
import type { Task, TaskInput, TaskOutcome, TaskReview } from "../domain/task.js";
export interface TaskReviewRequest { id: string; task: Task; inputs: TaskInput[]; outcome: TaskOutcome; evidence: unknown[]; attachments?: readonly { id: string; mimeType: string; width: number; height: number; bytes: number; createdAt: string }[]; signal: AbortSignal; emit(event: AgentEvent): void }
export interface TaskReviewer { review(request: TaskReviewRequest): Promise<TaskReview> }

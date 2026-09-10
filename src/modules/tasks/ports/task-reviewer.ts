import type { AgentEvent } from "../../observability/index.js";
import type { Task, TaskInput, TaskOutcome, TaskReview } from "../domain/task.js";
export interface TaskReviewRequest { id: string; task: Task; inputs: TaskInput[]; outcome: TaskOutcome; evidence: unknown[]; signal: AbortSignal; emit(event: AgentEvent): void }
export interface TaskReviewer { review(request: TaskReviewRequest): Promise<TaskReview> }

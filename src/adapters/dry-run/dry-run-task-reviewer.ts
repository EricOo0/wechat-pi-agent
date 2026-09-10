import type { TaskReviewer, TaskReviewRequest, TaskReview } from "../../modules/tasks/index.js";
export class DryRunTaskReviewer implements TaskReviewer {
  public review(request: TaskReviewRequest): Promise<TaskReview> {
    request.signal.throwIfAborted();
    return Promise.resolve({ decision: 'approved', reason: 'Deterministic dry-run fixture, not real model validation', gaps: [], finalResult: request.outcome.result ?? '' });
  }
}

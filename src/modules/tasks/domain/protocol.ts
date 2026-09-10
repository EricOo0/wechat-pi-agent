import { z } from "zod";
import { TaskControlError, type TaskOutcome, type TaskReview } from "./task.js";
const outcome = z.object({ disposition: z.enum(["continue", "waiting", "request_completion"]), progress: z.string().max(12000), remaining: z.string().max(12000), evidence: z.array(z.string().max(4000)).max(30), question: z.string().max(12000).optional(), result: z.string().max(60000).optional() }).strict();
const review = z.object({ decision: z.enum(["approved", "revise", "waiting"]), reason: z.string().max(12000), gaps: z.array(z.string().max(4000)).max(30), nextAction: z.string().max(12000).optional(), question: z.string().max(12000).optional(), finalResult: z.string().max(60000).optional() }).strict();
function parse(text: string): unknown {
  try { return JSON.parse(text.trim().replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "")); }
  catch { throw new TaskControlError("TASK_PROTOCOL", "任务结果不是有效 JSON"); }
}
export function parseTaskOutcome(text: string): TaskOutcome {
  const result = outcome.safeParse(parse(text));
  if (!result.success || (result.data.disposition === "waiting" && !result.data.question?.trim()) || (result.data.disposition === "request_completion" && !result.data.result?.trim())) throw new TaskControlError("TASK_PROTOCOL", "任务结果缺少必要字段");
  const data = result.data;
  return { disposition: data.disposition, progress: data.progress, remaining: data.remaining, evidence: data.evidence, ...(data.question === undefined ? {} : { question: data.question }), ...(data.result === undefined ? {} : { result: data.result }) };
}
export function parseTaskReview(text: string): TaskReview {
  const result = review.safeParse(parse(text));
  if (!result.success || (result.data.decision === "waiting" && !result.data.question?.trim()) || (result.data.decision === "revise" && !result.data.gaps.length)) throw new TaskControlError("TASK_PROTOCOL", "任务核对结果缺少必要字段");
  const data = result.data;
  return { decision: data.decision, reason: data.reason, gaps: data.gaps, ...(data.question === undefined ? {} : { question: data.question }), ...(data.nextAction === undefined ? {} : { nextAction: data.nextAction }), ...(data.finalResult === undefined ? {} : { finalResult: data.finalResult }) };
}

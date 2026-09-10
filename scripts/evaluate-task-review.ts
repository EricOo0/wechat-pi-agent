/** Explicit real-model evaluation using synthetic scenarios; no user messages or media are sent. */
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";
import { TASK_REVIEW_PROTOCOL, parseTaskReview } from "../src/modules/tasks/index.js";
const scenarios = JSON.parse(await readFile(new URL("../test/fixtures/task-review-cases.json", import.meta.url), "utf8")) as Array<{id:string;goal:string;result:string;progress:string;attachments:boolean;evidence:unknown[];expected:string[];emptyFinalResult?:boolean}>;
const runtime = await ModelRuntime.create({ allowModelNetwork: false, refreshOnCreate: false, modelsPath: null });
const model = runtime.getModel("openai-codex", "gpt-5.6-sol");
if (!model) throw new Error("Evaluation model unavailable");
const results = [];
for (const scenario of scenarios) {
  const payload = { task: { goal: scenario.goal }, inputs: [{text:scenario.goal}], completion: {disposition:"request_completion",progress:scenario.progress,result:scenario.result}, evidence:scenario.evidence,
    attachments: scenario.attachments ? [{id:"synthetic-image",mimeType:"image/png",width:1280,height:720,bytes:4096}] : [] };
  const response = await runtime.streamSimple(model, { systemPrompt:TASK_REVIEW_PROTOCOL, messages:[{role:"user",content:JSON.stringify(payload),timestamp:Date.now()}],tools:[] }, { reasoning:"low",maxRetries:0,maxTokens:1000,signal:AbortSignal.timeout(90_000) }).result();
  if (response.stopReason === "error" || response.stopReason === "aborted") throw new Error(`Evaluation failed for ${scenario.id}`);
  const review = parseTaskReview(response.content.filter(p=>p.type==="text").map(p=>p.text).join(""));
  const passed = scenario.expected.includes(review.decision) && (!scenario.emptyFinalResult || !review.finalResult?.trim());
  results.push({id:scenario.id,expected:scenario.expected,passed,review});
  process.stdout.write(`${scenario.id}: ${review.decision} ${passed ? "PASS" : "FAIL"}\n`);
}
const result = {date:new Date().toISOString(),provider:model.provider,model:model.id,promptSha256:createHash("sha256").update(TASK_REVIEW_PROTOCOL).digest("hex"),passed:results.every(r=>r.passed),results};
if (process.argv[2]) await writeFile(process.argv[2],JSON.stringify(result,null,2)+"\n");
if (!result.passed) process.exitCode=1;

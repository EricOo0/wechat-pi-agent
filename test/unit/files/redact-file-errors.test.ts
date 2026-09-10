import { describe, expect, it } from 'vitest';
import { createAssistantMessageEventStream, type AssistantMessage } from '@earendil-works/pi-ai';
import { redactFileErrors } from '../../../src/modules/artifacts/application/redact-file-errors.js';
describe('file provider error redaction',()=>{
 it('scrubs signed URLs before stream events and final results reach history',async()=>{
  const stream=createAssistantMessageEventStream();
  const error={role:'assistant',content:[],errorMessage:'Download failed: https://test.oaiusercontent.com/a?sig=SECRET&se=tomorrow',stopReason:'error'} as unknown as AssistantMessage;
  stream.push({type:'error',reason:'error',error});stream.end();
  const events=[];for await(const event of redactFileErrors(stream))events.push(event);
  expect(JSON.stringify(events)).not.toContain('SECRET');expect((await stream.result()).errorMessage).toContain('[signed URL redacted]');
 });
});

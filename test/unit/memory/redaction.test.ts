import { expect, it } from 'vitest';
import { redactMemorySecrets } from '../../../src/adapters/pi/pi-memory-generator.js';
it('removes credential-like values and signed URLs while preserving memory facts',()=>{
 const input='用户偏好简洁。 apiKey="exampleSecret123" context_token="contextSecret123" Bearer bearerSecret123 https://example.com/file?sig=secret sk-1234567890abcdefgh';
 const result=redactMemorySecrets(input);expect(result).toContain('用户偏好简洁');
 for(const secret of ['exampleSecret123','contextSecret123','bearerSecret123','sig=secret','sk-1234567890abcdefgh'])expect(result).not.toContain(secret);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createStructuredAgentAdapter } from '../src/adapters/agents/index.mjs';

test('structured adapter bounds input and output and records execution evidence', async () => {
  const adapter = createStructuredAgentAdapter({
    id: 'fake-one', capabilities: { structuredRequirement: true },
    async invoke(request) {
      assert.equal(request.timeoutMs, 1000);
      return { stdout: '{"schemaVersion":2}', stderr: '', exitCode: 0, durationMs: 12, usage: { inputTokens: 8, outputTokens: 4 } };
    },
  });
  const result = await adapter.generateStructured({ prompt: 'Return JSON', maxInputBytes: 128, maxOutputBytes: 128, timeoutMs: 1000 });
  assert.deepEqual(result.candidate, { schemaVersion: 2 });
  assert.equal(result.processEvidence.agentId, 'fake-one');
  assert.equal(result.processEvidence.status, 'succeeded');
  assert.equal(result.processEvidence.semanticApproval, false);
  await assert.rejects(() => adapter.generateStructured({ prompt: 'x'.repeat(129), maxInputBytes: 128, maxOutputBytes: 128, timeoutMs: 1000 }), /input.*limit/i);
});

test('structured adapter rejects malformed and oversized output even after exit zero', async () => {
  const malformed = createStructuredAgentAdapter({ id: 'bad-json', capabilities: {}, invoke: async () => ({ stdout: '{', stderr: '', exitCode: 0 }) });
  await assert.rejects(() => malformed.generateStructured({ prompt: 'x', maxOutputBytes: 8 }), /valid JSON/i);
  const oversized = createStructuredAgentAdapter({ id: 'too-large', capabilities: {}, invoke: async () => ({ stdout: '123456789', stderr: '', exitCode: 0 }) });
  await assert.rejects(() => oversized.generateStructured({ prompt: 'x', maxOutputBytes: 8 }), /output.*limit/i);
  const failed = createStructuredAgentAdapter({ id: 'failed', capabilities: {}, invoke: async () => ({ stdout: '{}', stderr: 'boom', exitCode: 2 }) });
  await assert.rejects(() => failed.generateStructured({ prompt: 'x' }), /exited with code 2/i);
});

test('structured adapter validates declaration and cannot claim approval authority', () => {
  assert.throws(() => createStructuredAgentAdapter({ id: '../bad', capabilities: {}, invoke() {} }), /agent id/i);
  assert.throws(() => createStructuredAgentAdapter({ id: 'fake', capabilities: { approveRequirement: true }, invoke() {} }), /capability/i);
  assert.throws(() => createStructuredAgentAdapter({ id: 'fake', capabilities: {}, invoke: null }), /invoke/i);
});

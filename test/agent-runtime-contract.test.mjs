import assert from 'node:assert/strict';
import test from 'node:test';
import {
  negotiateAgentAdapter,
  normalizeAgentCapabilities,
  runAgentTurn,
} from '../src/modules/delivery-core/index.mjs';
import { createAgentRuntimeAdapter } from '../src/adapters/agents/index.mjs';

const required = { structuredRequirement: true, architectureProposal: false, boundedPatch: true, usageEvidence: false, cancellation: false, resume: false };

test('capabilities are exact, frozen, and negotiated without agent-id branches', () => {
  const capabilities = normalizeAgentCapabilities({ structuredRequirement: true, boundedPatch: true });
  assert.equal(capabilities.structuredRequirement, true);
  assert.equal(capabilities.resume, false);
  assert.ok(Object.isFrozen(capabilities));
  assert.throws(() => normalizeAgentCapabilities({ magic: true }), /unknown.*capability/i);
  assert.throws(() => normalizeAgentCapabilities({ resume: 'yes' }), /resume.*boolean/i);
  const result = negotiateAgentAdapter({ required, available: [
    { id: 'first', capabilities: { structuredRequirement: true } },
    { id: 'second', capabilities: { structuredRequirement: true, boundedPatch: true } },
  ] });
  assert.equal(result.status, 'compatible');
  assert.equal(result.selected.id, 'second');
  assert.deepEqual(result.gaps, []);
  const unavailable = negotiateAgentAdapter({ required, available: [{ id: 'first', capabilities: {} }] });
  assert.equal(unavailable.status, 'unavailable');
  assert.ok(unavailable.gaps.includes('boundedPatch'));
});

function adapter(id, invoke, capabilities = required) {
  return createAgentRuntimeAdapter({
    id, capabilities,
    prepareTurn(request) { return { prompt: request.prompt.trim(), requestDigest: request.semanticDigest }; },
    invoke,
    async cancel(turnId) { return { turnId, cancelled: true }; },
  });
}

test('compatible adapters preserve the same semantic request while recording identity', async () => {
  const invoke = async (turn) => ({ exitCode: 0, stdout: JSON.stringify({ proposal: { files: [] }, findings: [] }), stderr: '', durationMs: 3, usage: { inputTokens: 10, outputTokens: 4, cost: 0.01 }, observedDigest: turn.requestDigest });
  const request = { prompt: ' implement ', semanticDigest: 'a'.repeat(64) };
  const one = await runAgentTurn(adapter('agent-one', invoke), request, { timeoutMs: 1000, maxInputBytes: 1000, maxOutputBytes: 1000, maxInputTokens: 20, maxOutputTokens: 20, maxCost: 1 });
  const two = await runAgentTurn(adapter('agent-two', invoke), request, { timeoutMs: 1000, maxInputBytes: 1000, maxOutputBytes: 1000, maxInputTokens: 20, maxOutputTokens: 20, maxCost: 1 });
  assert.equal(one.requestDigest, two.requestDigest);
  assert.equal(one.processEvidence.agentId, 'agent-one');
  assert.equal(two.processEvidence.agentId, 'agent-two');
  assert.equal(one.status, 'succeeded');
});

test('runtime bounds timeout, cancellation, response shape, usage, and semantic validity', async () => {
  const never = adapter('slow', () => new Promise(() => {}), { ...required, cancellation: true });
  const timed = await runAgentTurn(never, { prompt: 'x', semanticDigest: 'a'.repeat(64) }, { timeoutMs: 20, maxInputBytes: 10, maxOutputBytes: 10 });
  assert.equal(timed.status, 'timed-out');
  assert.equal(timed.processEvidence.cancelled, true);

  const malformed = adapter('malformed', async () => ({ exitCode: 0, stdout: '{', stderr: '' }));
  assert.equal((await runAgentTurn(malformed, { prompt: 'x', semanticDigest: 'a'.repeat(64) }, { timeoutMs: 100 })).status, 'invalid-output');
  const invalid = adapter('invalid', async () => ({ exitCode: 0, stdout: JSON.stringify({ proposal: 'not-an-object', findings: [] }), stderr: '' }));
  assert.equal((await runAgentTurn(invalid, { prompt: 'x', semanticDigest: 'a'.repeat(64) }, { timeoutMs: 100 })).status, 'invalid-output');
  const expensive = adapter('expensive', async () => ({ exitCode: 0, stdout: JSON.stringify({ proposal: {}, findings: [] }), stderr: '', usage: { inputTokens: 101, outputTokens: 1, cost: 0.01 } }));
  assert.equal((await runAgentTurn(expensive, { prompt: 'x', semanticDigest: 'a'.repeat(64) }, { timeoutMs: 100, maxInputTokens: 100 })).status, 'budget-exceeded');
  const failed = adapter('failed', async () => ({ exitCode: 2, stdout: '{}', stderr: 'boom' }));
  assert.equal((await runAgentTurn(failed, { prompt: 'x', semanticDigest: 'a'.repeat(64) }, { timeoutMs: 100 })).status, 'failed');
});

test('runtime adapter declaration is strict and cancellation is capability-bound', () => {
  assert.throws(() => createAgentRuntimeAdapter({ id: 'bad/id', capabilities: {}, prepareTurn() {}, invoke() {} }), /agent runtime id/i);
  assert.throws(() => createAgentRuntimeAdapter({ id: 'agent', capabilities: { cancellation: true }, prepareTurn() {}, invoke() {} }), /cancel/i);
  assert.throws(() => createAgentRuntimeAdapter({ id: 'agent', capabilities: {}, prepareTurn: null, invoke() {} }), /prepareTurn/i);
});

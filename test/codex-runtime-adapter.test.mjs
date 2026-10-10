import assert from 'node:assert/strict';
import test from 'node:test';
import { createCodexCliAdapter, probeCodexCli } from '../src/adapters/agents/index.mjs';
import { AGENT_RUNTIME_CAPABILITIES, negotiateAgentAdapter, runAgentTurn } from '../src/modules/delivery-core/index.mjs';

const SCHEMA = JSON.stringify({ type: 'object', required: ['proposal', 'findings'] });
const VALID_MESSAGE = JSON.stringify({ proposal: { requirement: { id: 'requirement.probe' } }, findings: [] });
const AUTHORITY = { allowedPaths: ['apps/api/src/application'], allowedCommands: [], allowNetwork: false, allowExternalEffects: false, maxChangedFiles: 4, maxChangedBytes: 4096 };

function fakeArtifactStore() {
  const files = new Map();
  return {
    files,
    write(path, content) { files.set(path, content); return { path, bytes: Buffer.byteLength(content) }; },
    read(path) { if (!files.has(path)) throw new Error(`missing artifact ${path}`); return files.get(path); },
  };
}

function fakeRunner({ version = 'codex-cli 0.98.0', versionExit = 0, lastMessage = VALID_MESSAGE, stdout = '', changedPaths = [], exitCode = 0 } = {}) {
  const calls = [];
  return {
    calls,
    async run(spec) {
      calls.push(spec);
      if (spec.argv[1] === '--version') return { exitCode: versionExit, stdout: version, stderr: '', durationMs: 5, changedPaths: [] };
      if (spec.artifactPaths?.lastMessage) spec.artifactStore?.write(spec.artifactPaths.lastMessage, lastMessage);
      return { exitCode, stdout, stderr: '', durationMs: 10, changedPaths };
    },
    async cancel(turnId) { return { cancelled: true, turnId }; },
  };
}

function turnRequest(overrides = {}) {
  return { phase: 'requirement', semanticDigest: 'a'.repeat(64), idempotencyKey: 'key-1', prompt: 'Draft the requirement.', authority: AUTHORITY, responseSchema: SCHEMA, ...overrides };
}

function adapterFor(runner, store = fakeArtifactStore(), overrides = {}) {
  return createCodexCliAdapter({ detectedVersion: '0.98.0', processRunner: runner, artifactStore: store, ...overrides });
}

test('capabilities are declared only after an executable handshake, including independent review', async () => {
  assert.ok(AGENT_RUNTIME_CAPABILITIES.includes('independentReview'));
  const missing = await probeCodexCli({ processRunner: fakeRunner({ versionExit: 127, version: '' }) });
  assert.equal(missing.available, false);
  assert.equal(missing.version, null);
  const probe = await probeCodexCli({ processRunner: fakeRunner() });
  assert.equal(probe.available, true);
  assert.equal(probe.version, '0.98.0');

  const unhandshaken = createCodexCliAdapter({ processRunner: fakeRunner(), artifactStore: fakeArtifactStore() });
  assert.deepEqual(unhandshaken.capabilities, Object.fromEntries(AGENT_RUNTIME_CAPABILITIES.map((capability) => [capability, false])));
  const declared = adapterFor(fakeRunner());
  assert.equal(declared.capabilities.boundedPatch, true);
  assert.equal(declared.capabilities.independentReview, true);
  assert.equal(negotiateAgentAdapter({ required: { independentReview: true }, available: [declared] }).status, 'compatible');
});

test('argv is exact, the phase selects the sandbox, and the prompt travels on stdin', async () => {
  for (const [phase, sandbox] of [['requirement', 'read-only'], ['architecture', 'read-only'], ['independent-review', 'read-only'], ['patch', 'workspace-write']]) {
    const store = fakeArtifactStore();
    const adapter = adapterFor(fakeRunner(), store);
    const turn = await adapter.prepareTurn(turnRequest({ phase }));
    assert.deepEqual(turn.argv.slice(0, 2), ['codex', 'exec']);
    for (const flag of ['--json', '--output-schema', '--output-last-message', '--ignore-user-config', '--strict-config', '-C']) assert.ok(turn.argv.includes(flag), `${phase}:${flag}`);
    assert.equal(turn.argv[turn.argv.indexOf('--sandbox') + 1], sandbox, phase);
    assert.ok(turn.stdout === undefined);
    assert.equal(turn.stdin, turnRequest({ phase }).prompt);
    assert.ok(turn.artifactPaths.schema.endsWith('response-schema.json'));
    assert.ok(store.files.has(turn.artifactPaths.schema));
    assert.equal(store.files.get(turn.artifactPaths.schema), SCHEMA);
    assert.match(turn.requestDigest, /^[a-f0-9]{64}$/);
  }
});

test('dangerous flags and unknown phases are rejected', async () => {
  assert.throws(() => createCodexCliAdapter({ command: 'codex --dangerously-bypass-approvals-and-sandbox', detectedVersion: '0.98.0', processRunner: fakeRunner(), artifactStore: fakeArtifactStore() }), /dangerous/i);
  const adapter = adapterFor(fakeRunner());
  await assert.rejects(() => adapter.prepareTurn(turnRequest({ extraArgs: ['--dangerously-bypass-approvals-and-sandbox'] })), /dangerous/i);
  await assert.rejects(() => adapter.prepareTurn(turnRequest({ phase: 'unknown-phase' })), /phase/i);
  await assert.rejects(() => adapter.prepareTurn(turnRequest({ responseSchema: '' })), /responseSchema/i);
});

test('a valid turn parses usage from recognized JSONL events only', async () => {
  const stdout = ['{"type":"item.completed"}', 'this line is not json', '{"type":"token_count","usage":{"input_tokens":120,"output_tokens":30}}'].join('\n');
  const executed = await runAgentTurn(adapterFor(fakeRunner({ stdout })), turnRequest({ phase: 'patch' }), { timeoutMs: 5000, maxOutputBytes: 65536 });
  assert.equal(executed.status, 'succeeded');
  assert.deepEqual(executed.usage, { inputTokens: 120, outputTokens: 30, cost: 'unverified' });
  assert.equal(executed.processEvidence.exitCode, 0);
  assert.deepEqual(executed.findings, []);
});

test('malformed JSONL and a missing usage event keep usage unverified', async () => {
  const executed = await runAgentTurn(adapterFor(fakeRunner({ stdout: 'not json\n{"type":"other"}' })), turnRequest(), { timeoutMs: 5000, maxOutputBytes: 65536 });
  assert.equal(executed.status, 'succeeded');
  assert.deepEqual(executed.usage, { inputTokens: 'unverified', outputTokens: 'unverified', cost: 'unverified' });
});

test('a final message that violates the turn schema fails closed', async () => {
  const executed = await runAgentTurn(adapterFor(fakeRunner({ lastMessage: '{"proposal":{}}' })), turnRequest(), { timeoutMs: 5000, maxOutputBytes: 65536 });
  assert.equal(executed.status, 'invalid-output');
  assert.match(executed.findings.join(' '), /schema|findings/i);
});

test('changes outside the approved authority are rejected even after an exit-0 process', async () => {
  const executed = await runAgentTurn(adapterFor(fakeRunner({ changedPaths: ['apps/web/src/main.tsx', 'apps/api/src/application/board-service.ts'] })), turnRequest({ phase: 'patch' }), { timeoutMs: 5000, maxOutputBytes: 65536 });
  assert.equal(executed.status, 'rejected');
  assert.match(executed.findings.join(' '), /apps\/web\/src\/main\.tsx/);
  assert.equal(executed.processEvidence.exitCode, 0);
});

test('cancellation terminates only the owned turn', async () => {
  const runner = fakeRunner();
  const adapter = adapterFor(runner);
  const cancelled = await adapter.cancel('turn.owned');
  assert.deepEqual(cancelled, { cancelled: true, turnId: 'turn.owned' });
});

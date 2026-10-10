import assert from 'node:assert/strict';
import test from 'node:test';
import { executeHttpGate } from '../src/adapters/http/index.mjs';
import { executeBrowserGate, executeCommandGate, executeDatabaseGate } from '../src/adapters/process/index.mjs';

const digest = 'a'.repeat(64);
const SECRET = 'super-secret-value';

function gate(overrides = {}) {
  return { id: 'unit-tests', purpose: 'unit', timeoutMs: 5000, maxOutputBytes: 2048, artifactBudgetBytes: 4096, ...overrides };
}

function context(overrides = {}) {
  const recorded = [];
  const artifacts = {
    record({ gateId, path, content, bytes }) {
      const size = bytes ?? Buffer.byteLength(content ?? '');
      recorded.push({ gateId, path, content, bytes: size });
      return { path, digest, bytes: size };
    },
  };
  const value = {
    root: process.cwd(),
    capabilities: { commands: true, http: true, database: true, browser: true },
    artifacts,
    secrets: [SECRET],
    ...overrides,
  };
  return { recorded, value };
}

const passed = (result) => result.status === 'passed';

test('a command gate passes on exit zero and records redacted logs', async () => {
  const { recorded, value } = context({
    commands: {
      plan: { 'unit-tests': { argv: ['node', '--test'] } },
      async run() { return { exitCode: 0, stdout: `ok ${SECRET}`, stderr: '', durationMs: 12 }; },
    },
  });
  const result = await executeCommandGate(value, gate());
  assert.ok(passed(result));
  assert.equal(result.gateId, 'unit-tests');
  assert.ok(Object.isFrozen(result));
  assert.deepEqual(result.artifacts.map((entry) => entry.path), ['verification/unit-tests/stdout.log', 'verification/unit-tests/stderr.log']);
  assert.ok(recorded.every((entry) => !entry.content.includes(SECRET)));
  assert.ok(recorded.some((entry) => entry.content.includes('[redacted]')));
  assert.ok(!JSON.stringify(result).includes(SECRET));
  assert.equal(result.cleanup.status, 'clean');
  assert.equal(result.failure, null);
});

test('command gates classify exit, timeout, overflow, and missing executables', async () => {
  const run = (result) => context({ commands: { plan: { 'unit-tests': { argv: ['node', '--test'] } }, async run() { return result; } } }).value;
  const failed = await executeCommandGate(run({ exitCode: 1, stdout: 'boom', stderr: '', durationMs: 3 }), gate());
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.classification, 'functional');
  const timedOut = await executeCommandGate(run({ exitCode: null, timedOut: true, stdout: '', stderr: '', durationMs: 5000 }), gate());
  assert.equal(timedOut.status, 'failed');
  assert.equal(timedOut.failure.classification, 'infrastructure');
  const overflow = await executeCommandGate(run({ exitCode: 0, outputOverflow: true, stdout: 'x'.repeat(4096), stderr: '', durationMs: 3 }), gate());
  assert.equal(overflow.status, 'failed');
  assert.equal(overflow.failure.classification, 'infrastructure');
  const missing = await executeCommandGate(context({ commands: { plan: { 'unit-tests': { argv: ['node'] } }, async run() { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); } } }).value, gate());
  assert.equal(missing.status, 'blocked');
  assert.equal(missing.failure.classification, 'capability');
  const absentPlan = await executeCommandGate(context({ commands: { plan: {}, async run() { throw new Error('not reached'); } } }).value, gate());
  assert.equal(absentPlan.status, 'blocked');
  assert.match(absentPlan.failure.message, /runner plan/i);
});

test('artifact escapes, oversized artifacts, and failed cleanup fail closed', async () => {
  const escaping = context({
    commands: { plan: { 'unit-tests': { argv: ['node'] } }, async run() { return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1 }; } },
    artifacts: { record({ bytes }) { return { path: '../escape.log', digest, bytes: bytes ?? 2 }; } },
  }).value;
  const escaped = await executeCommandGate(escaping, gate());
  assert.equal(escaped.status, 'failed');
  assert.equal(escaped.failure.classification, 'artifact');

  const oversized = context({
    commands: { plan: { 'unit-tests': { argv: ['node'] } }, async run() { return { exitCode: 0, stdout: 'x'.repeat(4096), stderr: '', durationMs: 1 }; } },
  }).value;
  const tooBig = await executeCommandGate(oversized, gate({ artifactBudgetBytes: 16 }));
  assert.equal(tooBig.status, 'failed');
  assert.equal(tooBig.failure.classification, 'artifact');

  const dirty = context({
    commands: { plan: { 'unit-tests': { argv: ['node'] } }, async run() { return { exitCode: 0, stdout: 'ok', stderr: '', durationMs: 1, cleanup: { status: 'failed', reason: 'temporary schema left behind' } }; } },
  }).value;
  const cleanupFailed = await executeCommandGate(dirty, gate());
  assert.equal(cleanupFailed.status, 'blocked');
  assert.equal(cleanupFailed.failure.classification, 'infrastructure');
  assert.deepEqual(cleanupFailed.cleanup, { status: 'failed', reason: 'temporary schema left behind' });
});

test('an http gate verifies readiness and rejects contract mismatch', async () => {
  const plan = {
    'api-integration': {
      readiness: [{ name: 'ready', path: '/health', expectStatus: 200 }],
      contracts: [{ name: 'members', method: 'GET', path: '/members', expectStatus: 200, expectBodyIncludes: ['memberId'] }],
    },
  };
  const ok = context({ endpoints: plan, http: { async request() { return { status: 200, body: '{"memberId":"m1"}', headers: {}, durationMs: 4 }; } } }).value;
  const passedResult = await executeHttpGate(ok, gate({ id: 'api-integration', purpose: 'integration' }));
  assert.ok(passed(passedResult));

  const mismatch = context({ endpoints: plan, http: { async request(spec) { return spec.path === '/health' ? { status: 200, body: 'ok', durationMs: 2 } : { status: 500, body: '{"error":"boom"}', durationMs: 3 }; } } }).value;
  const failed = await executeHttpGate(mismatch, gate({ id: 'api-integration', purpose: 'integration' }));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.classification, 'contract');

  const offline = context({ endpoints: plan, http: { async request() { throw Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }); } } }).value;
  const blocked = await executeHttpGate(offline, gate({ id: 'api-integration', purpose: 'integration' }));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.failure.classification, 'capability');
});

test('a database gate runs migration and concurrency probes', async () => {
  const plan = { 'migration-safety': ['clean-migration', 'previous-schema-migration', 'concurrency-probe'] };
  const ok = context({ database: { plan, async run({ probe }) { return { status: 'passed', detail: `${probe} ok` }; } } }).value;
  assert.ok(passed(await executeDatabaseGate(ok, gate({ id: 'migration-safety', purpose: 'migration' }))));

  const concurrency = context({ database: { plan, async run({ probe }) { return probe === 'concurrency-probe' ? { status: 'failed', detail: 'lost update detected' } : { status: 'passed', detail: 'ok' }; } } }).value;
  const failed = await executeDatabaseGate(concurrency, gate({ id: 'migration-safety', purpose: 'migration' }));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.classification, 'data');

  const unavailable = context({ database: { plan, async run() { throw Object.assign(new Error('psql missing'), { code: 'ENOENT' }); } } }).value;
  const blocked = await executeDatabaseGate(unavailable, gate({ id: 'migration-safety', purpose: 'migration' }));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.failure.classification, 'capability');
});

test('a browser gate reports accessibility failure and cleanup failure', async () => {
  const plan = { 'browser-e2e': ['primary-flow', 'accessibility'] };
  const ok = context({ browser: { plan, async run() { return { status: 'passed', detail: 'ok' }; } } }).value;
  assert.ok(passed(await executeBrowserGate(ok, gate({ id: 'browser-e2e', purpose: 'e2e' }))));

  const a11y = context({ browser: { plan, async run({ scenario }) { return scenario === 'accessibility' ? { status: 'failed', detail: 'contrast below threshold' } : { status: 'passed', detail: 'ok' }; } } }).value;
  const failed = await executeBrowserGate(a11y, gate({ id: 'browser-e2e', purpose: 'e2e' }));
  assert.equal(failed.status, 'failed');
  assert.equal(failed.failure.classification, 'accessibility');

  const dirty = context({ browser: { plan, async run() { return { status: 'passed', detail: 'ok', cleanup: { status: 'failed', reason: 'browser profile left behind' } }; } } }).value;
  const blocked = await executeBrowserGate(dirty, gate({ id: 'browser-e2e', purpose: 'e2e' }));
  assert.equal(blocked.status, 'blocked');
  assert.equal(blocked.failure.classification, 'infrastructure');
  assert.equal(blocked.cleanup.status, 'failed');
});

test('every driver blocks when its declared capability is absent', async () => {
  const offline = context({ capabilities: {} }).value;
  for (const [run, id, purpose] of [[executeCommandGate, 'unit-tests', 'unit'], [executeHttpGate, 'api-integration', 'integration'], [executeDatabaseGate, 'migration-safety', 'migration'], [executeBrowserGate, 'browser-e2e', 'e2e']]) {
    const result = await run(offline, gate({ id, purpose }));
    assert.equal(result.status, 'blocked', id);
    assert.equal(result.failure.classification, 'capability', id);
  }
});

test('drivers reject malformed gates before touching a capability', async () => {
  const { value, recorded } = context({ capabilities: {} });
  await assert.rejects(() => executeCommandGate(value, { id: 'unit-tests' }), /purpose|timeoutMs/i);
  await assert.rejects(() => executeHttpGate(value, gate({ id: 'bad id' })), /id/i);
  assert.deepEqual(recorded, []);
});

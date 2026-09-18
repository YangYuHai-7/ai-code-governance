import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import {
  recordTestCaseResults,
  renderTestReport,
  selectTestCasePacket,
  validateTestCaseManifest,
} from '../src/testing.mjs';
import { sha256, stableJson } from '../src/shared/index.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-testing-${name}-`));
}

function manifest() {
  const dimensions = [
    'smoke', 'functional', 'boundary', 'extreme', 'negative_input', 'state_transition',
    'authorization_isolation', 'contract', 'persistence', 'concurrency_idempotency',
    'resilience_recovery', 'compatibility', 'performance_capacity',
    'accessibility_usability', 'deployment_rollback',
  ];
  const baseCase = {
    priority: 'P1', layer: 'acceptance', tags: ['regression'], sourceIds: ['REQ-1'],
    ctx: { actor: 'owner', environment: 'local', data: ['workspace'] },
    pre: ['The service is running.'],
    steps: [{ do: 'observe', target: 'status', see: ['The expected state is visible.'] }],
    final: ['State remains consistent.'], evidence: ['Capture durable output.'], cleanup: [],
    automation: { kind: 'agent', runPolicy: 'auto', driver: 'browser' },
  };
  return {
    schemaVersion: 2,
    scope: 'ACCOUNT',
    baselineVersion: '1.0',
    locale: 'en',
    repositories: ['.'],
    evidenceDir: 'reports/testing/evidence/ACCOUNT',
    shared: {
      actors: { owner: { role: 'owner', goal: 'verify behavior', authority: 'test account', familiarity: 'regular user', platform: 'browser', accessibility: 'standard input' } },
      environments: { local: { platform: 'local browser', entry: 'http://localhost', requirements: ['Test service is available.'] } },
      data: { workspace: { description: 'Isolated test workspace.', secretEnv: [] } },
    },
    coverageDimensions: Object.fromEntries(dimensions.map((dimension) => [dimension, {
      status: dimension === 'smoke' ? 'COVERED' : 'GAP',
      caseIds: dimension === 'smoke' ? ['ACCOUNT-TC-001'] : [],
      rationale: dimension === 'smoke' ? 'Primary path is covered.' : 'Not assessed yet.',
    }])),
    cases: [
      { ...baseCase, id: 'ACCOUNT-TC-001', title: 'Primary path', tags: ['smoke', 'regression'] },
      { ...baseCase, id: 'ACCOUNT-TC-002', title: 'Secondary path', priority: 'P2' },
    ],
  };
}

test('schema-v2 selection emits a digest-bound minimal AI packet', () => {
  const input = manifest();
  assert.equal(validateTestCaseManifest(input), input);
  const packet = selectTestCasePacket(input, { cases: 'ACCOUNT-TC-001' });
  assert.equal(packet.selectedCount, 1);
  assert.deepEqual(packet.cases.map((entry) => entry.id), ['ACCOUNT-TC-001']);
  assert.deepEqual(Object.keys(packet.shared.actors), ['owner']);
  assert.equal(packet.manifestSha256, sha256(stableJson(input)));
  const { packetDigest, ...base } = packet;
  assert.equal(packetDigest, sha256(stableJson(base)));
});

test('evidence-bound recording fills NOT_RUN, hashes evidence, and replays idempotently', (context) => {
  const root = fixture('ledger');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'reports', 'testing', 'evidence'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports', 'testing', 'evidence', 'case-001.txt'), 'observed pass\n');
  const input = manifest();
  const packet = selectTestCasePacket(input, { cases: 'ACCOUNT-TC-001' });
  const external = {
    sessionId: 'run-001', scope: input.scope, baselineVersion: input.baselineVersion,
    manifestSha256: packet.manifestSha256, packetDigest: packet.packetDigest,
    operator: 'AI test runner', method: 'browser',
    startedAt: '2026-09-18T00:00:00.000Z', finishedAt: '2026-09-18T00:01:00.000Z',
    results: [{ id: 'ACCOUNT-TC-001', status: 'PASS', actual: 'Expected state observed.', durationSeconds: 60, evidence: ['reports/testing/evidence/case-001.txt'], classification: 'automated' }],
  };
  const options = { manifest: input, packet, external, ledgerPath: 'reports/testing/account-results.json' };
  const first = recordTestCaseResults(root, options);
  assert.equal(first.status, 'recorded');
  assert.equal(first.session.results[0].evidence[0].sha256, sha256('observed pass\n'));
  assert.equal(first.session.results[1].status, 'NOT_RUN');
  const replay = recordTestCaseResults(root, options);
  assert.equal(replay.status, 'already-recorded');
  assert.equal(replay.session.sessionDigest, first.session.sessionDigest);
  assert.match(renderTestReport(input, first.session, 'zh-CN'), /AI 模拟真人结果与真实用户结果必须分别记录/);

  const changed = structuredClone(external);
  changed.results[0].actual = 'Different result under the same session.';
  assert.throws(() => recordTestCaseResults(root, { ...options, external: changed }), /different content/);
});

test('PASS and FAIL cannot be recorded without durable evidence', (context) => {
  const root = fixture('missing-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const input = manifest();
  const packet = selectTestCasePacket(input, { cases: 'ACCOUNT-TC-001' });
  assert.throws(() => recordTestCaseResults(root, {
    manifest: input,
    packet,
    ledgerPath: 'reports/testing/results.json',
    external: {
      sessionId: 'run-002', scope: input.scope, baselineVersion: input.baselineVersion,
      manifestSha256: packet.manifestSha256, packetDigest: packet.packetDigest,
      operator: 'runner', method: 'browser', startedAt: 'start', finishedAt: 'finish',
      results: [{ id: 'ACCOUNT-TC-001', status: 'FAIL', actual: 'Mismatch.', durationSeconds: 1, evidence: [], classification: 'automated' }],
    },
  }), /requires durable evidence/);
});

test('test-case init honors the configured portable formats and output directory', (context) => {
  const root = fixture('cli-init');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cli = path.resolve('bin/aicg.js');
  const result = spawnSync(process.execPath, [cli, 'test-case', 'init', root, '--scope', 'DEMO', '--format', 'markdown-plus-json', '--output', 'qa/cases', '--yes'], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.ok(fs.existsSync(path.join(root, 'qa', 'cases', 'DEMO-execution.json')));
  assert.ok(fs.existsSync(path.join(root, 'qa', 'cases', 'DEMO-test-cases.md')));
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'qa', 'cases', 'DEMO-execution.json'), 'utf8')).schemaVersion, 2);
});

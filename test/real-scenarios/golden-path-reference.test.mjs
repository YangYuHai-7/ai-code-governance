import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  REFERENCE_PROBES,
  applyReferenceProbe,
  digestReferenceTree,
  preflightReferenceEvaluation,
  runReferenceEvaluation,
} from '../../scripts/golden-path-reference-evaluation.mjs';
import { loadGoldenPathPack } from '../../src/modules/stack-packs/index.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const fixtureRoot = path.join(testRoot, '..', '..', 'test-support/evaluations/golden-path/reference-work-tracker');
const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');
const PROJECT = 'project';

const REQUIRED_PROBES = [
  'contract-drift', 'cross-layer-import', 'cross-tenant-access', 'domain-framework-import',
  'failed-migration', 'interrupted-resume-drift', 'lost-update', 'missing-acceptance-test',
  'omitted-gate', 'private-feature-import', 'stale-evidence', 'transaction-leak',
  'unauthorized-path', 'unsafe-dto-actor',
];

function readyEnvironment() {
  return {
    runtime: { node: '24.18.0' },
    packageManager: { name: 'npm', version: '11.0.0' },
    postgres: { version: '18.6' },
    browser: { name: 'chromium' },
    ports: [3000, 5432],
    diskFreeBytes: 8 * 1024 ** 3,
    executables: ['node', 'npm'],
  };
}

function passingDrivers(overrides = {}) {
  const driver = async (_context, gate) => ({ gateId: gate.id, status: 'passed', artifacts: [], cleanup: { status: 'clean', reason: null }, failure: null });
  return { command: driver, http: driver, database: driver, browser: driver, ...overrides };
}

function temporaryRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-reference-'));
}

test('the probe catalog covers every required negative probe and declares real targets and gates', () => {
  assert.deepEqual(REFERENCE_PROBES.map((probe) => probe.id).sort(), [...REQUIRED_PROBES].sort());
  const gateIds = new Set(pack.qualityMatrix.gates.map((gate) => gate.id));
  for (const probe of REFERENCE_PROBES) {
    assert.ok(probe.description.length > 10, probe.id);
    assert.ok(probe.affectedGates.length > 0, probe.id);
    for (const gate of probe.affectedGates) assert.ok(gateIds.has(gate), `${probe.id}:${gate}`);
    assert.ok(probe.targets.length > 0, probe.id);
    for (const target of probe.targets) {
      let ancestor = path.dirname(path.join(fixtureRoot, target));
      while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) ancestor = path.dirname(ancestor);
      assert.ok(ancestor.startsWith(fixtureRoot), `${probe.id}:${target}`);
    }
  }
  assert.ok(REFERENCE_PROBES.some((probe) => probe.scope === 'outside-project'));
});

test('every probe mutates only its declared targets inside an isolated copy', () => {
  const baseline = digestReferenceTree(fixtureRoot);
  for (const probe of REFERENCE_PROBES) {
    const workRoot = temporaryRoot();
    try {
      const result = applyReferenceProbe({ fixtureRoot, workRoot, faultId: probe.id });
      assert.equal(result.probeId, probe.id);
      assert.ok(result.changedPaths.length > 0, probe.id);
      for (const changed of result.changedPaths) {
        assert.ok(result.declaredTargets.includes(changed), `${probe.id} changed undeclared path ${changed}`);
      }
      assert.equal(digestReferenceTree(fixtureRoot), baseline, probe.id);
      assert.notEqual(result.digestAfter, result.digestBefore, probe.id);
    } finally {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  }
});

test('environment preflight reports missing capabilities as blocked, never skipped', () => {
  const blocked = preflightReferenceEvaluation({ runtime: {}, packageManager: {}, postgres: null, browser: null, ports: [], diskFreeBytes: 0, executables: [] });
  assert.equal(blocked.status, 'blocked');
  for (const name of ['node', 'package-manager', 'postgresql', 'browser', 'ports', 'disk', 'executables']) {
    assert.equal(blocked.checks.find((check) => check.name === name).status, 'blocked', name);
  }
  const ready = preflightReferenceEvaluation(readyEnvironment());
  assert.equal(ready.status, 'passed');
  assert.ok(ready.checks.every((check) => check.status === 'passed'));
});

test('the harness runs the full matrix and detects the named probe through its affected gates', async () => {
  const workRoot = temporaryRoot();
  const run = await runReferenceEvaluation({ fixtureRoot, workRoot, environment: readyEnvironment(), drivers: passingDrivers(), policy: { sessionId: 'session.reference' } });
  assert.equal(run.status, 'passed');
  assert.ok(run.requiredGateIds.length >= 10);
  assert.equal(fs.existsSync(workRoot), false, 'the isolated copy is cleaned up');

  const faultRoot = temporaryRoot();
  const failed = await runReferenceEvaluation({ fixtureRoot, workRoot: faultRoot, environment: readyEnvironment(), faultId: 'cross-tenant-access', drivers: passingDrivers(), policy: { sessionId: 'session.reference.fault' } });
  assert.equal(failed.status, 'failed');
  assert.equal(failed.results.find((result) => result.gateId === 'security-probes').status, 'failed');
  assert.equal(failed.results.find((result) => result.gateId === 'unit-tests').status, 'passed');
  assert.equal(fs.existsSync(faultRoot), false);
});

test('a missing external capability blocks the run instead of reporting success', async () => {
  const workRoot = temporaryRoot();
  const run = await runReferenceEvaluation({
    fixtureRoot, workRoot, drivers: passingDrivers(),
    environment: { runtime: { node: '24.18.0' }, packageManager: { name: 'npm', version: '11.0.0' }, postgres: null, browser: null, ports: [], diskFreeBytes: 8 * 1024 ** 3, executables: ['node', 'npm'] },
    policy: { sessionId: 'session.reference.blocked' },
  });
  assert.equal(run.status, 'blocked');
  assert.ok(run.results.every((result) => result.status === 'blocked'));
  assert.equal(fs.existsSync(workRoot), false);
});

test('the harness refuses an unknown probe instead of running unmutated', async () => {
  const workRoot = temporaryRoot();
  try {
    await assert.rejects(() => runReferenceEvaluation({ fixtureRoot, workRoot, environment: readyEnvironment(), faultId: 'not-a-probe', drivers: passingDrivers(), policy: { sessionId: 'session.reference.unknown' } }), /probe/i);
  } finally {
    fs.rmSync(workRoot, { recursive: true, force: true });
  }
  assert.ok(fs.existsSync(path.join(fixtureRoot, PROJECT)));
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  activateRiskProfiles,
  canonicalContractDigest,
  evaluateQualityMatrixRun,
  planQualityMatrix,
  qualityMatrixRunDigest,
  riskProfileSetDigest,
  validateQualityMatrixRun,
} from '../src/modules/delivery-core/index.mjs';
import { loadGoldenPathPack, resolvePackCompatibility, validateGoldenPathPack } from '../src/modules/stack-packs/index.mjs';
import { architectureFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');

function exactFacts() {
  return {
    runtime: { node: '24.18.0' },
    packageManager: { name: 'npm', version: '11.0.0', lockfile: 'package-lock.json' },
    packages: {
      react: '19.3.0', 'react-dom': '19.3.0', vite: '8.3.0', '@mantine/core': '9.6.0',
      '@nestjs/core': '12.0.0', '@nestjs/platform-fastify': '12.0.0', fastify: '5.12.5', 'drizzle-orm': '0.44.6',
    },
    database: { engine: 'postgresql', version: '18.6', extensions: [] },
  };
}

function riskSet() {
  const requirement = requirementFixture();
  return activateRiskProfiles({
    requirement,
    architecture: architectureFixture(canonicalContractDigest('requirement', requirement)),
    repositoryFacts: { paths: ['drizzle/migrations/0001_init.sql'], packages: [] },
    pack,
  });
}

function planInput(overrides = {}) {
  const risk = overrides.riskProfileSet ?? riskSet();
  return {
    packId: pack.id,
    qualityMatrix: pack.qualityMatrix,
    compatibility: resolvePackCompatibility({ pack, repositoryFacts: exactFacts() }),
    riskProfileSet: risk,
    changedPaths: ['apps/web/src/features/profile/ProfileForm.tsx'],
    digests: {
      requirement: risk.requirementDigest,
      architecture: 'b'.repeat(64),
      repository: 'c'.repeat(64),
      pack: risk.packDigest,
      risk: riskProfileSetDigest(risk),
      environment: 'e'.repeat(64),
    },
    ...overrides,
  };
}

function passingResults(plan, overrides = {}) {
  return plan.requiredGateIds.map((gateId) => ({
    gateId, status: 'passed', cleanup: { status: 'clean' }, durationMs: 12, ...(overrides[gateId] ?? {}),
  }));
}

function evaluate(plan, overrides = {}) {
  return evaluateQualityMatrixRun({ plan, results: passingResults(plan, overrides.results), artifacts: overrides.artifacts ?? [], environment: overrides.environment ?? plan.digests.environment });
}

test('planning is deterministic, keeps Pack gate order, and scopes risk-activated gates', () => {
  const input = planInput();
  const first = planQualityMatrix(input), second = planQualityMatrix(input);
  assert.deepEqual(first, second);
  assert.equal(first.schemaVersion, 1);
  assert.deepEqual(first.gates.map((gate) => gate.id), pack.qualityMatrix.gates.map((gate) => gate.id));
  const byId = new Map(first.gates.map((gate) => [gate.id, gate]));
  assert.equal(byId.get('reproducible-build').applicability, 'required');
  assert.equal(byId.get('migration-safety').applicability, 'required');
  assert.equal(byId.get('security-probes').applicability, 'not-applicable');
  assert.equal(byId.get('performance-budget').applicability, 'not-applicable');
  for (const gate of first.gates) {
    if (gate.applicability === 'not-applicable') assert.ok(gate.reason.length > 0, gate.id);
    else assert.equal(gate.reason, null, gate.id);
  }
  assert.deepEqual(first.requiredGateIds, [...first.gates.filter((gate) => gate.applicability === 'required').map((gate) => gate.id)].sort());
  assert.ok(first.requiredGateIds.includes('migration-safety'));
  assert.ok(!first.requiredGateIds.includes('security-probes'));
  assert.match(first.id, /^quality-run\./);
  assert.deepEqual(first.digests, input.digests);
  assert.ok(Object.isFrozen(first));
});

test('planning fails closed on incompatible environments and unbound digests', () => {
  const incompatible = resolvePackCompatibility({ pack, repositoryFacts: { ...exactFacts(), runtime: { node: '24.14.0' } } });
  assert.throws(() => planQualityMatrix(planInput({ compatibility: incompatible })), /compatible/i);
  const risk = riskSet();
  assert.throws(() => planQualityMatrix(planInput({ digests: { ...planInput().digests, requirement: 'f'.repeat(64) } })), /requirement/i);
  assert.throws(() => planQualityMatrix(planInput({ digests: { ...planInput().digests, risk: 'f'.repeat(64) } })), /risk digest/i);
  assert.throws(() => planQualityMatrix(planInput({ digests: { ...planInput().digests, pack: 'f'.repeat(64) } })), /pack/i);
  assert.throws(() => planQualityMatrix(planInput({ riskProfileSet: { ...risk, requiredGateIds: [...risk.requiredGateIds, 'ghost-gate'] } })), /ghost-gate/);
  assert.throws(() => planQualityMatrix(planInput({ changedPaths: ['../outside.ts'] })), /path/i);
});

test('path-activated gates require a matching changed path', () => {
  const build = pack.qualityMatrix.gates.find((gate) => gate.id === 'reproducible-build');
  const matrix = { schemaVersion: 1, id: 'quality.path-scoped', gates: [{ ...build }, { ...build, id: 'web-flow-tests', applicability: 'path-activated' }] };
  const syntheticPack = validateGoldenPathPack({ ...pack, qualityMatrix: matrix });
  const requirement = requirementFixture({ inputs: [], nfrs: [{ id: 'nfr.plain', category: 'usability', requirement: 'Remain simple' }] });
  const risk = activateRiskProfiles({ requirement, architecture: null, repositoryFacts: { paths: [], packages: [] }, pack: syntheticPack });
  const input = {
    packId: syntheticPack.id,
    qualityMatrix: matrix,
    compatibility: resolvePackCompatibility({ pack: syntheticPack, repositoryFacts: exactFacts() }),
    riskProfileSet: risk,
    digests: { requirement: risk.requirementDigest, architecture: null, repository: 'c'.repeat(64), pack: risk.packDigest, risk: riskProfileSetDigest(risk), environment: 'e'.repeat(64) },
    pathScopes: { 'web-flow-tests': ['apps/web'] },
  };
  const activated = planQualityMatrix({ ...input, changedPaths: ['apps/web/src/features/ProfileForm.tsx'] });
  assert.ok(activated.requiredGateIds.includes('web-flow-tests'));
  const inactive = planQualityMatrix({ ...input, changedPaths: ['apps/api/src/main.ts'] });
  assert.ok(!inactive.requiredGateIds.includes('web-flow-tests'));
  assert.match(inactive.gates.find((gate) => gate.id === 'web-flow-tests').reason, /changed path/i);
  assert.throws(() => planQualityMatrix({ ...input, changedPaths: ['apps/web/src/x.tsx'], pathScopes: { 'web-flow-tests': ['../outside'] } }), /path/i);
});

test('receipt evaluation requires exactly one result per required gate', () => {
  const plan = planQualityMatrix(planInput());
  const missing = passingResults(plan).slice(1);
  assert.throws(() => evaluateQualityMatrixRun({ plan, results: missing, artifacts: [], environment: plan.digests.environment }), /missing required gate/i);
  const duplicate = [...passingResults(plan), passingResults(plan)[0]];
  assert.throws(() => evaluateQualityMatrixRun({ plan, results: duplicate, artifacts: [], environment: plan.digests.environment }), /duplicate/i);
  const extra = [...passingResults(plan), { gateId: 'static-lint', status: 'passed' }];
  assert.throws(() => evaluateQualityMatrixRun({ plan, results: extra, artifacts: [], environment: plan.digests.environment }), /duplicate|not planned/i);
  assert.throws(() => evaluateQualityMatrixRun({ plan, results: passingResults(plan).map((result) => result.gateId === 'unit-tests' ? { ...result, status: 'failed' } : result), artifacts: [], environment: plan.digests.environment }), /failure classification/i);
  assert.throws(() => evaluateQualityMatrixRun({ plan, results: passingResults(plan).map((result) => result.gateId === 'unit-tests' ? { ...result, status: 'not-applicable' } : result), artifacts: [], environment: plan.digests.environment }), /reason/i);
});

test('artifact budgets, paths, and gate ownership are enforced', () => {
  const plan = planQualityMatrix(planInput());
  const budgeted = plan.gates.find((gate) => gate.id === 'static-lint');
  assert.throws(() => evaluate(plan, { artifacts: [{ gateId: 'static-lint', path: 'reports/lint.json', digest: 'a'.repeat(64), bytes: budgeted.artifactBudgetBytes + 1 }] }), /artifact budget/i);
  assert.throws(() => evaluate(plan, { artifacts: [{ gateId: 'static-lint', path: '../escape.json', digest: 'a'.repeat(64), bytes: 1 }] }), /path/i);
  assert.throws(() => evaluate(plan, { artifacts: [{ gateId: 'security-probes', path: 'reports/security.json', digest: 'a'.repeat(64), bytes: 1 }] }), /not required|not in the plan|gate/i);
  const withArtifact = evaluate(plan, { artifacts: [{ gateId: 'static-lint', path: 'reports/lint.json', digest: 'a'.repeat(64), bytes: 128 }] });
  assert.equal(withArtifact.artifactBytes, 128);
  assert.deepEqual(withArtifact.artifactDigests, [{ gateId: 'static-lint', path: 'reports/lint.json', digest: 'a'.repeat(64), bytes: 128 }]);
  assert.deepEqual(validateQualityMatrixRun(withArtifact), withArtifact);
});

test('a run status is derived from validated results and justified N/A keeps a gate satisfied', () => {
  const plan = planQualityMatrix(planInput());
  assert.equal(evaluate(plan).status, 'passed');
  assert.equal(evaluate(plan, { results: { 'unit-tests': { status: 'failed', failureClassification: 'functional' } } }).status, 'failed');
  assert.equal(evaluate(plan, { results: { 'unit-tests': { status: 'blocked', failureClassification: 'infrastructure' } } }).status, 'blocked');
  assert.equal(evaluate(plan, { results: { 'unit-tests': { status: 'stale' } } }).status, 'blocked');
  const justified = evaluate(plan, { results: { 'unit-tests': { status: 'not-applicable', reason: 'The Pack marks this gate optional for the current scope.' } } });
  assert.equal(justified.status, 'passed');
});

test('a stale environment digest is rejected instead of reusing a prior run', () => {
  const plan = planQualityMatrix(planInput());
  assert.throws(() => evaluate(plan, { environment: 'f'.repeat(64) }), /environment digest/i);
});

test('the run receipt contract is closed, versioned, and digest-bound', () => {
  const plan = planQualityMatrix(planInput());
  const run = evaluate(plan);
  assert.equal(run.schemaVersion, 1);
  assert.equal(run.planId, plan.id);
  assert.deepEqual(run.requiredGateIds, plan.requiredGateIds);
  assert.match(qualityMatrixRunDigest(run), /^[a-f0-9]{64}$/);
  assert.throws(() => validateQualityMatrixRun({ ...run, extra: true }), /extra/);
  assert.throws(() => validateQualityMatrixRun({ ...run, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateQualityMatrixRun({ ...run, status: 'passed', results: run.results.map((result) => result.gateId === 'unit-tests' ? { ...result, status: 'blocked' } : result) }), /status/);
  assert.throws(() => validateQualityMatrixRun({ ...run, artifactBytes: run.artifactBytes + 1 }), /artifactBytes/);
  assert.throws(() => validateQualityMatrixRun({ ...run, results: run.results.slice(1) }), /required gate/i);
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'assets/contracts/quality-matrix-run-v1-schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadHeldOutEvaluationSet, runHeldOutEvaluationSet } from '../src/modules/evaluation/index.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const providerRoot = path.join(testRoot, '..', 'test-support/fixtures/golden-path/held-out-provider');

function temporaryCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-held-out-'));
  fs.cpSync(providerRoot, root, { recursive: true });
  return root;
}

test('a closed provider manifest loads with verified case digests', () => {
  const set = loadHeldOutEvaluationSet(providerRoot);
  assert.equal(set.schemaVersion, 1);
  assert.equal(set.cases.length, 2);
  assert.match(set.sourceDigest, /^[a-f0-9]{64}$/);
  for (const entry of set.cases) {
    assert.match(entry.repositoryDigest, /^[a-f0-9]{64}$/);
    assert.match(entry.requirementDigest, /^[a-f0-9]{64}$/);
    assert.match(entry.inputDigest, /^[a-f0-9]{64}$/);
    assert.ok(entry.platforms.length > 0);
    assert.equal(typeof entry.structurallyDistinct, 'boolean');
  }
  assert.ok(Object.isFrozen(set));
  assert.ok(Object.isFrozen(set.cases));
});

test('declared and actual case digests must match', () => {
  const root = temporaryCopy();
  try {
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.cases[0].repositoryDigest = 'f'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(root), /digest/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('escaping paths, duplicate case ids, and unknown fields are rejected', () => {
  const escaping = temporaryCopy();
  try {
    const manifestPath = path.join(escaping, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.cases[1].repository = '../outside';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(escaping), /path/i);
  } finally { fs.rmSync(escaping, { recursive: true, force: true }); }

  const duplicated = temporaryCopy();
  try {
    const manifestPath = path.join(duplicated, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.cases[1].id = manifest.cases[0].id;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(duplicated), /duplicate/i);
  } finally { fs.rmSync(duplicated, { recursive: true, force: true }); }

  const unknown = temporaryCopy();
  try {
    const manifestPath = path.join(unknown, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.extra = true;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(unknown), /extra/);
  } finally { fs.rmSync(unknown, { recursive: true, force: true }); }
});
function runDependencies(overrides = {}) {
  const copies = [];
  const results = { 'case-alpha': { verdict: 'passed', level: 'E3-agent-executable', runId: 'run-alpha' }, 'case-beta': { verdict: 'passed', level: 'E3-agent-executable', runId: 'run-beta' } };
  return {
    copies,
    authorized: true,
    referenceDigests: { requirement: '1'.repeat(64), repository: '2'.repeat(64) },
    thresholdPolicy: { minimumStructurallyDistinctCases: 2 },
    workRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-held-out-run-')),
    async copyCase(caseEntry, destination) { copies.push({ caseId: caseEntry.id, destination }); fs.cpSync(caseEntry.absolute.repository, destination, { recursive: true }); return destination; },
    async evaluateCase({ caseEntry }) { return { ...(results[caseEntry.id] ?? { verdict: 'failed', level: 'E0-generated', runId: `run-${caseEntry.id}` }) }; },
    ...overrides,
  };
}

test('an authorized run evaluates isolated copies and leaves the provider unchanged', async () => {
  const set = loadHeldOutEvaluationSet(providerRoot);
  const dependencies = runDependencies();
  try {
    const run = await runHeldOutEvaluationSet(set, dependencies);
    assert.equal(run.status, 'passed');
    assert.deepEqual(run.gaps, []);
    assert.deepEqual(run.cases.map((entry) => entry.caseId), ['case-alpha', 'case-beta']);
    assert.equal(new Set(run.cases.map((entry) => entry.runId)).size, 2);
    assert.equal(dependencies.copies.length, 2);
    assert.equal(loadHeldOutEvaluationSet(providerRoot).sourceDigest, set.sourceDigest);
    assert.ok(Object.isFrozen(run));
  } finally { fs.rmSync(dependencies.workRoot, { recursive: true, force: true }); }
});

test('missing provider authority blocks the run instead of evaluating', async () => {
  const set = loadHeldOutEvaluationSet(providerRoot);
  const dependencies = runDependencies({ authorized: false });
  try {
    const run = await runHeldOutEvaluationSet(set, dependencies);
    assert.equal(run.status, 'blocked');
    assert.ok(run.gaps.some((gap) => gap.code === 'provider-authority'));
    assert.equal(dependencies.copies.length, 0);
  } finally { fs.rmSync(dependencies.workRoot, { recursive: true, force: true }); }
});

test('reference-digest overlap, duplicate runs, and thin coverage are reported', async () => {
  const set = loadHeldOutEvaluationSet(providerRoot);
  const overlapping = runDependencies({ referenceDigests: { requirement: '1'.repeat(64), repository: set.cases[0].repositoryDigest } });
  try {
    const run = await runHeldOutEvaluationSet(set, overlapping);
    assert.equal(run.status, 'blocked');
    assert.ok(run.gaps.some((gap) => gap.code === 'held-out-overlap'));
  } finally { fs.rmSync(overlapping.workRoot, { recursive: true, force: true }); }

  const duplicated = runDependencies({ evaluateCase: async () => ({ verdict: 'passed', level: 'E3-agent-executable', runId: 'run-shared' }) });
  try {
    const run = await runHeldOutEvaluationSet(set, duplicated);
    assert.ok(run.gaps.some((gap) => gap.code === 'duplicate-run'));
  } finally { fs.rmSync(duplicated.workRoot, { recursive: true, force: true }); }

  const thin = runDependencies({ thresholdPolicy: { minimumStructurallyDistinctCases: 3 } });
  try {
    const run = await runHeldOutEvaluationSet(set, thin);
    assert.ok(run.gaps.some((gap) => gap.code === 'insufficient-distinct-cases'));
  } finally { fs.rmSync(thin.workRoot, { recursive: true, force: true }); }
});

test('a provider that changes during evaluation is blocked and failures are retained', async () => {
  const root = temporaryCopy();
  const set = loadHeldOutEvaluationSet(root);
  const dependencies = runDependencies({
    evaluateCase: async ({ caseEntry }) => {
      if (caseEntry.id === 'case-alpha') return { verdict: 'failed', level: 'E0-generated', runId: 'run-alpha-failed' };
      fs.writeFileSync(path.join(caseEntry.absolute.repository, 'mutated.txt'), 'provider was mutated during the run\n');
      return { verdict: 'passed', level: 'E3-agent-executable', runId: 'run-beta' };
    },
  });
  try {
    const run = await runHeldOutEvaluationSet(set, dependencies);
    assert.equal(run.status, 'blocked');
    assert.ok(run.gaps.some((gap) => gap.code === 'provider-mutated'));
    assert.equal(run.cases.find((entry) => entry.caseId === 'case-alpha').verdict, 'failed');
  } finally {
    fs.rmSync(dependencies.workRoot, { recursive: true, force: true });
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('a provider inside the reference fixture is refused', () => {
  assert.throws(() => loadHeldOutEvaluationSet(providerRoot, { forbiddenRoots: [path.dirname(providerRoot)] }), /reference fixture/i);
  assert.equal(loadHeldOutEvaluationSet(providerRoot, { forbiddenRoots: [] }).cases.length, 2);
});

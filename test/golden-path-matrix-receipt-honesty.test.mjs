import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalContractDigest } from '../src/modules/delivery-core/index.mjs';
import { evaluateGoldenPathCertification, validateGoldenPathEvaluation } from '../src/modules/evaluation/index.mjs';
import { loadGoldenPathPack } from '../src/modules/stack-packs/index.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(testRoot, '..');
const fixture = 'test-support/evaluations/golden-path/reference-work-tracker';
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'test-support/evaluations/golden-path/receipts/macos-live-matrix.json'), 'utf8'));
const agentReceipt = JSON.parse(fs.readFileSync(path.join(root, 'test-support/evaluations/golden-path/receipts/macos-codex-e3.json'), 'utf8'));
const probes = JSON.parse(fs.readFileSync(path.join(root, 'test-support/evaluations/golden-path/receipts/macos-probe-detection.json'), 'utf8'));

// Real executed evidence is still not a certification: the matrix receipt proves the golden path ran
// on one host, and the certification gate must keep naming every input that is still missing.
test('a single-host matrix receipt never yields a certification verdict', () => {
  const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');
  const requirement = JSON.parse(fs.readFileSync(path.join(root, fixture, 'expected-requirement.json'), 'utf8'));
  const result = evaluateGoldenPathCertification({
    pack,
    referenceDigests: {
      pack: receipt.digests.pack,
      requirement: canonicalContractDigest('requirement', requirement),
      repository: receipt.digests.repository,
      environment: receipt.digests.environment,
    },
    platformPolicy: { claimed: ['linux', 'darwin', 'win32'], informational: ['win32'] },
    thresholdPolicy: { minimumHeldOutCases: 2 },
    evaluationReceipts: [],
    now: new Date().toISOString(),
  });
  const codes = result.gaps.map((gap) => gap.code);
  assert.equal(result.status, 'incomplete');
  assert.notEqual(result.evidenceLevel, 'E4-golden-path-certified');
  for (const code of ['missing-e3', 'missing-held-out-case', 'insufficient-held-out-cases', 'missing-qualified-human', 'missing-negative-probes', 'platform-missing:linux', 'platform-missing:win32']) {
    assert.ok(codes.includes(code), `${code} must be reported`);
  }
});

test('the retained matrix receipt proves execution, not certification', () => {
  assert.equal(receipt.plan.packId, 'react-mantine-nest-fastify-drizzle-postgresql');
  assert.equal(receipt.plan.matrixId, 'quality.react-nest-postgres');
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.gates.length, 14);
  assert.ok(receipt.gates.every((gate) => gate.status === 'passed' && Array.isArray(gate.artifacts)));
  assert.match(receipt.note, /not cross-platform, held-out, real-Agent, or qualified-human evidence/);
  assert.ok(!/\/Users\/|\/tmp\/|\/private\//.test(JSON.stringify(receipt)));
});

test('the retained historical E3 receipt clears only gaps for its matching matrix run', () => {
  const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');
  assert.equal(validateGoldenPathEvaluation(agentReceipt).verdict, 'passed');
  assert.equal(agentReceipt.level, 'E3-agent-executable');
  assert.equal(agentReceipt.matrix.runId, receipt.id);
  assert.equal(agentReceipt.matrix.requiredGateIds.length, 14);
  assert.equal(agentReceipt.matrix.resolvedGateIds.length, 14);
  assert.ok(agentReceipt.budget.elapsedMs > 0);
  assert.deepEqual(agentReceipt.failureHistory, []);
  assert.deepEqual(agentReceipt.gaps, []);

  const result = evaluateGoldenPathCertification({
    pack,
    referenceDigests: {
      pack: receipt.digests.pack,
      requirement: agentReceipt.requirementDigest,
      repository: receipt.digests.repository,
      environment: receipt.digests.environment,
    },
    referenceMatrixRunId: receipt.id,
    platformPolicy: { claimed: ['linux', 'darwin', 'win32'], informational: [] },
    thresholdPolicy: { minimumHeldOutCases: 2 },
    evaluationReceipts: [{
      id: 'evidence.reference-darwin',
      caseId: 'reference-work-tracker',
      caseClass: 'reference',
      runId: agentReceipt.matrix.runId,
      platform: receipt.environment.platform,
      qualifiedHuman: false,
      caseDigests: { requirement: agentReceipt.requirementDigest, repository: receipt.digests.repository },
      negativeProbes: probes.map((probe) => ({ id: probe.faultId, status: probe.detected ? 'passed' : 'failed' })),
      receipt: {
        level: agentReceipt.level,
        verdict: agentReceipt.verdict,
        digests: { pack: receipt.digests.pack, repository: receipt.digests.repository },
        evaluatedAt: agentReceipt.evaluatedAt,
      },
    }],
    now: agentReceipt.evaluatedAt,
  });
  const codes = result.gaps.map((gap) => gap.code);
  assert.equal(result.evidenceLevel, 'E3-agent-executable');
  assert.equal(result.status, 'incomplete');
  for (const cleared of ['missing-e3', 'missing-negative-probes', 'platform-missing:darwin']) assert.ok(!codes.includes(cleared), `${cleared} must be cleared`);
  for (const remaining of ['missing-held-out-case', 'insufficient-held-out-cases', 'missing-qualified-human', 'platform-missing:linux', 'platform-missing:win32']) assert.ok(codes.includes(remaining), `${remaining} must remain open`);
});

test('historical E3 cannot be paired with a newer reference matrix run', () => {
  const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');
  const result = evaluateGoldenPathCertification({
    pack,
    referenceDigests: {
      pack: receipt.digests.pack,
      requirement: agentReceipt.requirementDigest,
      repository: receipt.digests.repository,
      environment: receipt.digests.environment,
    },
    referenceMatrixRunId: 'quality-run-result.current-matrix',
    platformPolicy: { claimed: ['darwin'] },
    thresholdPolicy: { minimumHeldOutCases: 0 },
    evaluationReceipts: [{
      id: 'evidence.old-reference', caseId: 'reference-work-tracker', caseClass: 'reference',
      runId: agentReceipt.matrix.runId, platform: 'darwin', qualifiedHuman: false,
      caseDigests: { requirement: agentReceipt.requirementDigest, repository: receipt.digests.repository },
      negativeProbes: [],
      receipt: { level: agentReceipt.level, verdict: agentReceipt.verdict,
        digests: { pack: receipt.digests.pack, repository: receipt.digests.repository }, evaluatedAt: agentReceipt.evaluatedAt },
    }],
    now: agentReceipt.evaluatedAt,
  });
  const codes = result.gaps.map((gap) => gap.code);
  assert.equal(result.status, 'blocked');
  for (const code of ['stale-matrix-run', 'missing-e3', 'platform-missing:darwin']) assert.ok(codes.includes(code), code);
});
// A fully green release candidate is still not platform certification: the release receipt cannot
// stand in for an evaluation receipt, and claiming a platform without one keeps the platform gap.
test('a green release candidate cannot be smuggled in as evaluation evidence', () => {
  const release = JSON.parse(fs.readFileSync(path.join(root, 'docs/internal/validation/receipts/macos-release-candidate.json'), 'utf8'));
  const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');
  const requirement = JSON.parse(fs.readFileSync(path.join(root, fixture, 'expected-requirement.json'), 'utf8'));
  const referenceDigests = {
    pack: receipt.digests.pack,
    requirement: canonicalContractDigest('requirement', requirement),
    repository: receipt.digests.repository,
    environment: receipt.digests.environment,
  };
  assert.throws(
    () => evaluateGoldenPathCertification({ pack, referenceDigests, platformPolicy: { claimed: ['darwin'] }, thresholdPolicy: { minimumHeldOutCases: 1 }, evaluationReceipts: [release] }),
    /unknown field|required field/i,
  );
  const result = evaluateGoldenPathCertification({ pack, referenceDigests, platformPolicy: { claimed: ['darwin'] }, thresholdPolicy: { minimumHeldOutCases: 1 }, evaluationReceipts: [] });
  assert.equal(result.status, 'incomplete');
  assert.ok(result.gaps.some((gap) => gap.code === 'platform-missing:darwin'), 'a claimed platform without an evaluation receipt stays missing');
});

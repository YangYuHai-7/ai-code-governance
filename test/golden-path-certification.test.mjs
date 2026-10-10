import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadGoldenPathPack } from '../src/modules/stack-packs/index.mjs';
import { evaluateGoldenPathCertification, platformEvidence, publicationDecision, validateGoldenPathCertification } from '../src/modules/evaluation/index.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const PACK = 'react-mantine-nest-fastify-drizzle-postgresql';
const pack = loadGoldenPathPack(PACK);
const HASH = {
  pack: 'a'.repeat(64), requirement: 'b'.repeat(64), repository: 'c'.repeat(64), environment: 'd'.repeat(64),
};

function record(overrides = {}) {
  const { receipt, ...rest } = overrides;
  return {
    id: 'evidence.case',
    caseId: 'held-out-case-1',
    caseClass: 'held-out',
    runId: 'run-1',
    platform: 'linux',
    qualifiedHuman: false,
    caseDigests: { requirement: 'e'.repeat(64), repository: 'f'.repeat(64) },
    negativeProbes: [{ id: 'cross-tenant-access', status: 'passed' }],
    receipt: { level: 'E3-agent-executable', verdict: 'passed', digests: { pack: HASH.pack, repository: HASH.repository }, evaluatedAt: '2026-10-05T00:00:00.000Z', ...receipt },
    ...rest,
  };
}

function inputs(overrides = {}) {
  const platforms = ['linux', 'darwin', 'win32'];
  return {
    pack,
    compatibility: { status: 'compatible', packDigest: HASH.pack },
    referenceDigests: { ...HASH },
    evaluationReceipts: platforms.map((platform, index) => record({
      id: `evidence.case-${index}`, caseId: `held-out-case-${index}`, runId: `run-${index}`, platform,
      caseDigests: { requirement: String(index + 1).repeat(64), repository: String(index + 4).repeat(64) },
      qualifiedHuman: index === 0,
    })),
    platformPolicy: { claimed: platforms, informational: [] },
    thresholdPolicy: { minimumHeldOutCases: 3, requireQualifiedHuman: true, requireNegativeProbes: true },
    now: '2026-10-06T00:00:00.000Z',
    ...overrides,
  };
}

const codes = (receipt) => receipt.gaps.map((gap) => gap.code);

test('complete held-out, multi-platform, qualified-human evidence yields E4', () => {
  const receipt = evaluateGoldenPathCertification(inputs());
  assert.equal(receipt.evidenceLevel, 'E4-golden-path-certified');
  assert.equal(receipt.status, 'certified');
  assert.deepEqual(receipt.gaps, []);
  assert.equal(receipt.matrix.entries.length, 3);
  assert.equal(receipt.sourceDigests.pack, HASH.pack);
  assert.equal(validateGoldenPathCertification(receipt).status, 'certified');
});

test('missing E3 and missing held-out cases stay incomplete with named gaps', () => {
  const e2 = inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => record({ ...entry, receipt: { ...entry.receipt, level: 'E2-integrated' } })) });
  const e2Receipt = evaluateGoldenPathCertification(e2);
  assert.ok(codes(e2Receipt).includes('missing-e3'));
  assert.notEqual(e2Receipt.evidenceLevel, 'E4-golden-path-certified');
  const referenceOnly = inputs({ evaluationReceipts: [record({ caseClass: 'reference' })] });
  assert.ok(codes(evaluateGoldenPathCertification(referenceOnly)).includes('missing-held-out-case'));
});

test('held-out cases that reuse reference digests are rejected by overlap', () => {
  const overlapping = inputs({ evaluationReceipts: [record({ caseDigests: { requirement: HASH.requirement, repository: HASH.repository } })] });
  const receipt = evaluateGoldenPathCertification(overlapping);
  assert.equal(receipt.status, 'blocked');
  assert.ok(codes(receipt).includes('held-out-overlap'));
});

test('stale Pack or repository digests and duplicate run identities are blocked', () => {
  const stalePack = inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => record({ ...entry, receipt: { ...entry.receipt, digests: { ...entry.receipt.digests, pack: '9'.repeat(64) } } })) });
  assert.ok(codes(evaluateGoldenPathCertification(stalePack)).includes('stale-pack'));
  const staleRepository = inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => record({ ...entry, receipt: { ...entry.receipt, digests: { ...entry.receipt.digests, repository: '9'.repeat(64) } } })) });
  const repositoryReceipt = evaluateGoldenPathCertification(staleRepository);
  assert.ok(codes(repositoryReceipt).includes('stale-repository'));
  assert.equal(repositoryReceipt.status, 'blocked');
  const duplicated = inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => record({ ...entry, runId: 'run-shared' })) });
  assert.ok(codes(evaluateGoldenPathCertification(duplicated)).includes('duplicate-run'));
});

test('unclaimed, claimed-but-failing, and informational platforms are separated', () => {
  const missing = inputs({ evaluationReceipts: inputs().evaluationReceipts.filter((entry) => entry.platform !== 'win32') });
  assert.ok(codes(evaluateGoldenPathCertification(missing)).includes('platform-missing:win32'));
  const failing = inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => (entry.platform === 'win32' ? record({ ...entry, receipt: { ...entry.receipt, verdict: 'failed' } }) : entry)) });
  assert.ok(codes(evaluateGoldenPathCertification(failing)).includes('platform-failed:win32'));
  const informational = inputs({ platformPolicy: { claimed: ['linux', 'darwin'], informational: [{ platform: 'win32', status: 'informational' }] } });
  assert.deepEqual(codes(evaluateGoldenPathCertification(informational)), []);
});

test('qualified-human acceptance, negative probes, and regressions are enforced', () => {
  const noHuman = inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => record({ ...entry, qualifiedHuman: false })) });
  assert.ok(codes(evaluateGoldenPathCertification(noHuman)).includes('missing-qualified-human'));
  const failedProbe = inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => record({ ...entry, negativeProbes: [{ id: 'lost-update', status: 'failed' }] })) });
  assert.ok(codes(evaluateGoldenPathCertification(failedProbe)).includes('negative-probe-failed:lost-update'));
  const regression = inputs({ evaluationReceipts: [
    ...inputs().evaluationReceipts,
    record({ id: 'evidence.older', caseId: 'held-out-case-0', runId: 'run-old', platform: 'linux', receipt: { level: 'E3-agent-executable', verdict: 'failed', digests: { pack: HASH.pack, repository: HASH.repository }, evaluatedAt: '2026-10-06T00:00:00.000Z' } }),
  ] });
  assert.ok(codes(evaluateGoldenPathCertification(regression)).includes('regression:held-out-case-0'));
});

test('the certification contract is closed and versioned', () => {
  const receipt = evaluateGoldenPathCertification(inputs());
  assert.throws(() => validateGoldenPathCertification({ ...receipt, extra: true }), /extra/);
  assert.throws(() => validateGoldenPathCertification({ ...receipt, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateGoldenPathCertification({ ...receipt, status: 'unknown' }), /status/);
});
test('the cross-OS workflow is manual, exact, and never turns a non-blocking result into verified support', () => {
  const workflowPath = path.join(testRoot, '..', '.github/workflows/golden-path-evaluation.yml');
  const workflow = fs.readFileSync(workflowPath, 'utf8');
  for (const platform of ['ubuntu-latest', 'macos-latest', 'windows-latest']) assert.ok(workflow.includes(platform), platform);
  assert.ok(workflow.includes('workflow_dispatch'));
  assert.doesNotMatch(workflow, /pull_request|schedule:/);
  assert.match(workflow, /node-version/);
  assert.match(workflow, /24\./);
  assert.match(workflow, /actions\/upload-artifact/);
  assert.match(workflow, /if:\s*always\(\)/);
  assert.doesNotMatch(workflow, /continue-on-error/);
  assert.doesNotMatch(workflow, /dangerously|--full-auto|--yolo/);
  assert.match(workflow, /receipt/i);
  assert.ok(fs.existsSync(path.join(testRoot, '..', 'docs/internal/validation/golden-path-cross-os-runbook.md')));
});

test('platform evidence separates verified platforms from informational ones', () => {
  const records = ['linux', 'darwin', 'win32'].map((platform, index) => ({
    platform,
    receipt: { level: 'E3-agent-executable', verdict: 'passed', digests: { pack: 'a'.repeat(64), repository: 'b'.repeat(64) }, evaluatedAt: `2026-10-0${index + 1}T00:00:00.000Z` },
  }));
  const claimed = platformEvidence(records, { claimed: ['linux', 'darwin'], informational: [{ platform: 'win32', status: 'informational' }] });
  assert.deepEqual(claimed.verified, ['darwin', 'linux']);
  assert.equal(claimed.entries.find((entry) => entry.platform === 'win32').verified, false);
  assert.equal(claimed.entries.find((entry) => entry.platform === 'win32').status, 'informational-passed');
  const failing = platformEvidence([{ platform: 'win32', receipt: { level: 'E3-agent-executable', verdict: 'failed', digests: { pack: 'a'.repeat(64), repository: 'b'.repeat(64) }, evaluatedAt: '2026-10-01T00:00:00.000Z' } }], { claimed: ['linux', 'darwin', 'win32'], informational: [] });
  assert.equal(failing.verified.length, 0);
  assert.equal(failing.entries.find((entry) => entry.platform === 'win32').status, 'failed');
  assert.equal(failing.entries.find((entry) => entry.platform === 'linux').status, 'missing');
});
test('E4 authorizes Milestone 3 without performing it, and anything less stays evidence-incomplete', () => {
  const certified = evaluateGoldenPathCertification(inputs());
  const authorized = publicationDecision(certified);
  assert.equal(authorized.milestone2, 'complete');
  assert.equal(authorized.milestone3, 'authorized');
  assert.equal(authorized.performsPhaseB, false);
  assert.deepEqual(authorized.gaps, []);

  const incomplete = evaluateGoldenPathCertification(inputs({ evaluationReceipts: inputs().evaluationReceipts.map((entry) => record({ ...entry, receipt: { ...entry.receipt, level: 'E2-integrated' } })) }));
  const pending = publicationDecision(incomplete);
  assert.equal(pending.milestone2, 'evidence-incomplete');
  assert.equal(pending.milestone3, 'blocked');
  assert.equal(pending.performsPhaseB, false);
  assert.ok(pending.gaps.length > 0);
  assert.ok(pending.gaps.some((gap) => gap.code === 'missing-e3'));

  const blocked = publicationDecision(evaluateGoldenPathCertification(inputs({ evaluationReceipts: [record({ caseDigests: { requirement: HASH.requirement, repository: HASH.repository } })] })));
  assert.equal(blocked.milestone2, 'evidence-incomplete');
  assert.equal(blocked.milestone3, 'blocked');
  assert.ok(blocked.gaps.some((gap) => gap.code === 'held-out-overlap'));

  assert.throws(() => publicationDecision({ ...certified, status: 'unknown' }), /status/);
});

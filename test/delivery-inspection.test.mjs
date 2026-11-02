import assert from 'node:assert/strict';
import test from 'node:test';
import * as deliveryCore from '../src/modules/delivery-core/index.mjs';
import { loadGoldenPathPack } from '../src/modules/stack-packs/index.mjs';
import { architectureFixture, authorityFixture, budgetsFixture, repositoryFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

function session(overrides = {}) {
  const base = deliveryCore.createDeliverySession({
    id: 'session.inspection',
    requestText: 'Inspect the delivery without changing it',
    requirement: requirementFixture(),
    authority: authorityFixture(),
    budgets: budgetsFixture(),
    repositorySnapshot: repositoryFixture(),
    clock: () => '2026-10-11T01:00:00.000Z',
  });
  return { ...base, usage: { ...base.usage, agentTurns: 2 }, ...overrides };
}

function qualityRun(current, environment = 'e'.repeat(64), digestOverrides = {}) {
  const plan = {
    schemaVersion: 1,
    id: 'quality-run.inspection',
    packId: 'pack.inspection',
    matrixId: 'quality.inspection',
    requiredGateIds: ['unit-tests'],
    gates: [{ id: 'unit-tests', owner: 'functional', purpose: 'unit', applicability: 'required', reason: null, timeoutMs: 1000, maxOutputBytes: 512, artifactBudgetBytes: 256, evidence: 'captured output' }],
    digests: { requirement: current.requirementDigest, architecture: current.architectureDigest, repository: current.repositoryDigest, pack: 'c'.repeat(64), risk: 'd'.repeat(64), environment, ...digestOverrides },
  };
  return deliveryCore.evaluateQualityMatrixRun({ plan, results: [{ gateId: 'unit-tests', status: 'passed', cleanup: { status: 'clean' } }], artifacts: [], environment });
}

test('delivery Core exposes one inspection projector for every client surface', () => {
  assert.equal(typeof deliveryCore.projectDeliveryInspection, 'function');
});

test('inspection projects guided and expert views from one validated session', () => {
  const result = deliveryCore.projectDeliveryInspection(session());
  assert.equal(result.schemaVersion, 1);
  assert.equal(result.sessionId, 'session.inspection');
  assert.equal(result.state, 'requirements-approved');
  assert.deepEqual(result.guided, {
    stage: 'architecture',
    status: 'needs-decision',
    summary: 'Requirements are approved and architecture is pending.',
    nextAction: 'Review and approve the architecture proposal.',
    decisions: [],
    risks: [],
    evidence: { status: 'incomplete', required: 0, passed: 0, failed: 0, missing: 0 },
    recovery: { available: false, checkpointCount: 0, lastFailure: null },
  });
  assert.equal(result.expert.usage.agentTurns, 2);
  assert.equal(result.expert.digests.requirement, session().requirementDigest);
  assert.equal(result.expert.requestText, undefined);
  assert.equal(result.expert.requirement, undefined);
  assert.match(result.semanticDigest, /^[a-f0-9]{64}$/);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.guided.evidence), true);
});

test('inspection maps every canonical state without hiding blocked or failed delivery', () => {
  const expected = {
    draft: ['requirements', 'needs-decision'],
    'requirements-pending': ['requirements', 'needs-decision'],
    'requirements-approved': ['architecture', 'needs-decision'],
    'architecture-ready': ['planning', 'needs-decision'],
    'plan-approved': ['execution', 'ready'],
    executing: ['execution', 'in-progress'],
    verifying: ['verification', 'in-progress'],
    repairing: ['repair', 'in-progress'],
    'review-ready': ['review', 'ready'],
    blocked: ['recovery', 'blocked'],
    failed: ['recovery', 'failed'],
    completed: ['result', 'completed'],
    cancelled: ['result', 'cancelled'],
  };
  for (const [state, [stage, status]] of Object.entries(expected)) {
    const result = deliveryCore.projectDeliveryInspection(session({ state }));
    assert.equal(result.guided.stage, stage, state);
    assert.equal(result.guided.status, status, state);
  }
});

test('inspection digest ignores timestamps and changes with semantic state', () => {
  const original = deliveryCore.projectDeliveryInspection(session());
  const later = deliveryCore.projectDeliveryInspection(session({ updatedAt: '2026-10-11T02:00:00.000Z' }));
  const blocked = deliveryCore.projectDeliveryInspection(session({ state: 'blocked', updatedAt: '2026-10-11T02:00:00.000Z' }));
  assert.equal(later.semanticDigest, original.semanticDigest);
  assert.notEqual(blocked.semanticDigest, original.semanticDigest);
});

test('inspection exposes explicit failure and budget facts as risks', () => {
  const current = session({
    state: 'failed',
    lastFailure: { category: 'budget', message: 'Changed file budget exceeded.' },
    usage: { agentTurns: 4, commands: 8, changedFiles: 3, changedBytes: 8192, inputTokens: 'unverified', outputTokens: 'unverified', cost: 'unverified' },
  });
  const result = deliveryCore.projectDeliveryInspection(current);
  assert.deepEqual(result.guided.risks.map((risk) => risk.code), ['last-failure', 'budget:maxAgentTurns', 'budget:maxCommands', 'budget:maxChangedFiles', 'budget:maxChangedBytes']);
  assert.equal(result.guided.recovery.lastFailure.category, 'budget');
});

test('inspection fails closed for malformed matrix evidence', () => {
  assert.throws(
    () => deliveryCore.projectDeliveryInspection(session({ runtime: { qualityMatrixRun: { status: 'passed' } } })),
    /qualityMatrixRun/,
  );
});

test('expert inspection retains the exact validated evidence that drives its summary', () => {
  const current = session();
  const firstRun = qualityRun(current, 'e'.repeat(64));
  const secondRun = qualityRun(current, 'f'.repeat(64));
  const first = deliveryCore.projectDeliveryInspection({ ...current, runtime: { qualityMatrixRun: firstRun } });
  const second = deliveryCore.projectDeliveryInspection({ ...current, runtime: { qualityMatrixRun: secondRun } });
  assert.deepEqual(first.expert.evidence, firstRun);
  assert.equal(first.guided.evidence.status, 'passed');
  assert.notEqual(first.semanticDigest, second.semanticDigest);
});

test('inspection never presents a stale quality matrix as current passed evidence', () => {
  const current = session();
  const run = qualityRun(current);
  const stale = { ...current, repositoryDigest: 'f'.repeat(64), runtime: { qualityMatrixRun: run } };
  const result = deliveryCore.projectDeliveryInspection(stale);
  assert.equal(result.guided.evidence.status, 'incomplete');
  assert.equal(result.guided.evidence.passed, 0);
  assert.equal(result.guided.evidence.missing, 1);
  assert.ok(result.guided.risks.some((risk) => risk.code === 'quality-matrix-stale' && /repository/.test(risk.detail)));
  assert.deepEqual(result.expert.evidence, run);
});

test('inspection does not call a review-ready session ready when its matrix is stale', () => {
  const current = session();
  const run = qualityRun(current);
  const stale = { ...current, state: 'review-ready', repositoryDigest: 'f'.repeat(64), runtime: { qualityMatrixRun: run } };
  const result = deliveryCore.projectDeliveryInspection(stale);
  assert.equal(result.state, 'review-ready');
  assert.equal(result.guided.status, 'blocked');
  assert.match(result.guided.nextAction, /rerun.*verification/i);
});

test('inspection does not call a golden-path review ready without its matrix receipt', () => {
  const current = session({ state: 'review-ready', runtime: { pack: { id: 'pack.inspection', digest: 'c'.repeat(64) } } });
  const result = deliveryCore.projectDeliveryInspection(current);
  assert.equal(result.guided.status, 'blocked');
  assert.ok(result.guided.risks.some((risk) => risk.code === 'quality-matrix-missing'));
});

test('inspection counts activated gates omitted from a passed matrix as missing evidence', () => {
  const current = session();
  const riskProfileSet = deliveryCore.activateRiskProfiles({
    requirement: current.requirement,
    architecture: architectureFixture(current.requirementDigest),
    repositoryFacts: { paths: [], packages: [] },
    pack: loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql'),
  });
  assert.ok(riskProfileSet.requiredGateIds.length > 1);
  const run = qualityRun(current, 'e'.repeat(64), { risk: deliveryCore.riskProfileSetDigest(riskProfileSet) });
  const result = deliveryCore.projectDeliveryInspection({ ...current, runtime: { riskProfileSet, qualityMatrixRun: run } });
  assert.equal(result.guided.evidence.status, 'incomplete');
  assert.ok(result.guided.evidence.missing > 0);
  assert.ok(result.guided.risks.some((risk) => risk.code === 'quality-matrix-uncovered'));
});

test('inspection does not present an owner-blocked risk profile as review-ready', () => {
  const current = session({ state: 'review-ready' });
  const set = deliveryCore.activateRiskProfiles({
    requirement: current.requirement,
    architecture: architectureFixture(current.requirementDigest),
    repositoryFacts: { paths: [], packages: [] },
    pack: loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql'),
  });
  const blockedSet = {
    ...set,
    profiles: set.profiles.map((entry) => entry.id === 'privacy'
      ? { ...entry, applicability: 'blocked', triggerEvidence: [{ source: 'requirement', detail: 'requirement.summary: personal data' }], reason: 'Owner decision required.' }
      : entry),
    ownerQuestions: [{ id: 'question.risk.privacy', profileId: 'privacy', question: 'Confirm privacy evidence provider.', material: true }],
  };
  const ids = [...blockedSet.requiredGateIds].sort();
  const plan = {
    schemaVersion: 1, id: 'quality-run.owner-risk', packId: 'pack.inspection', matrixId: 'quality.inspection', requiredGateIds: ids,
    gates: ids.map((id) => ({ id, owner: 'functional', purpose: 'unit', applicability: 'required', reason: null, timeoutMs: 1000, maxOutputBytes: 512, artifactBudgetBytes: 256, evidence: 'captured output' })),
    digests: { requirement: current.requirementDigest, architecture: current.architectureDigest, repository: current.repositoryDigest, pack: blockedSet.packDigest, risk: deliveryCore.riskProfileSetDigest(blockedSet), environment: 'e'.repeat(64) },
  };
  const run = deliveryCore.evaluateQualityMatrixRun({ plan, results: ids.map((gateId) => ({ gateId, status: 'passed', cleanup: { status: 'clean' } })), artifacts: [], environment: plan.digests.environment });
  const result = deliveryCore.projectDeliveryInspection({ ...current, runtime: { pack: { id: 'pack.inspection', digest: blockedSet.packDigest }, riskProfileSet: blockedSet, qualityMatrixRun: run } });
  assert.equal(result.guided.status, 'blocked');
  assert.equal(result.guided.evidence.status, 'incomplete');
  assert.ok(result.guided.risks.some((risk) => risk.code === 'risk-profile-blocked' && /privacy/.test(risk.detail)));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import {
  activateRiskProfiles,
  buildTraceabilityGraph,
  canonicalContractDigest,
  createDeliverySession,
  evaluateDeliveryCompletion,
  evaluateQualityMatrixRun,
  evaluateTraceability,
  riskProfileSetDigest,
} from '../src/modules/delivery-core/index.mjs';
import { loadGoldenPathPack } from '../src/modules/stack-packs/index.mjs';
import { architectureFixture, authorityFixture, budgetsFixture, digest, repositoryFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

function session(overrides = {}) {
  const requirement = requirementFixture(), requirementDigest = canonicalContractDigest('requirement', requirement);
  const base = createDeliverySession({ id: 'session.completion', requestText: 'Complete fixture', requirement, architecture: architectureFixture(requirementDigest), authority: authorityFixture(), budgets: budgetsFixture(), repositorySnapshot: repositoryFixture(), clock: () => '2026-10-05T00:00:00.000Z' });
  return { ...base, state: 'review-ready', runtime: { applicability: {}, ...overrides.runtime }, ...overrides };
}

function traceability() {
  const requirement = requirementFixture(), architecture = architectureFixture(canonicalContractDigest('requirement', requirement));
  const requirementIds = ['goal.complete', 'rule.once', 'acceptance.fixture'];
  return evaluateTraceability(buildTraceabilityGraph({
    requirement, architecture,
    patches: [{ id: 'patch.fixture', path: 'src/fixture.mjs', requirementIds, architectureIds: ['decision.fixture'] }],
    tests: [{ id: 'test.fixture', path: 'test/fixture.test.mjs', requirementIds, evidenceIds: ['evidence.automated'] }],
    evidence: [{ id: 'evidence.automated', status: 'passed', verificationLevel: 'verified' }],
  }));
}

function evidence(source, id, overrides = {}) {
  return { schemaVersion: 1, id, sessionId: 'session.completion', source, verificationLevel: 'verified', semanticDigest: canonicalContractDigest('requirement', requirementFixture()), repositoryDigest: canonicalContractDigest('session', session()).slice(0, 64), commandDigest: digest, resultDigest: digest, artifactDigests: [], status: 'passed', ...overrides };
}

function currentEvidence(current) {
  const common = { sessionId: current.id, semanticDigest: current.requirementDigest, repositoryDigest: current.repositoryDigest };
  return [
    evidence('automated-test', 'evidence.automated', common),
    evidence('independent-review', 'evidence.review', common),
    evidence('human-acceptance', 'evidence.acceptance', common),
    evidence('deployment', 'evidence.deployability', common),
  ];
}

test('production completion keeps implementation, verification, acceptance, deployability, and deployment separate', () => {
  const current = session();
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.overall, 'complete');
  assert.equal(contract.implementation, 'complete');
  assert.equal(contract.verification, 'verified');
  assert.equal(contract.acceptance, 'accepted');
  assert.equal(contract.deployability, 'ready');
  assert.equal(contract.deployment, 'not-deployed');
  assert.equal(contract.gates.find((gate) => gate.id === 'deployment').status, 'unrun');
});

test('production fails closed for stale, failed, missing, unsupported, or unrun evidence', () => {
  const current = session();
  for (const mutation of [
    (items) => items.filter((item) => item.source !== 'independent-review'),
    (items) => items.map((item) => item.source === 'automated-test' ? { ...item, status: 'failed' } : item),
    (items) => items.map((item) => item.source === 'automated-test' ? { ...item, semanticDigest: 'b'.repeat(64) } : item),
    (items) => items.map((item) => item.source === 'automated-test' ? { ...item, status: 'unsupported' } : item),
    (items) => items.map((item) => item.source === 'automated-test' ? { ...item, status: 'unrun' } : item),
  ]) {
    const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: mutation(currentEvidence(current)), profile: 'production' });
    assert.notEqual(contract.overall, 'complete');
    assert.ok(contract.residualGaps.length > 0);
  }
});

test('explicit not-applicable decisions require reasons and advisory remains compatible', () => {
  const current = session({ runtime: { applicability: { 'human-acceptance': { applicability: 'not-applicable', reason: 'No user-facing behavior changes.' } } } });
  const withoutHuman = currentEvidence(current).filter((item) => item.source !== 'human-acceptance');
  assert.equal(evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: withoutHuman, profile: 'production' }).acceptance, 'not-applicable');
  const invalid = session({ runtime: { applicability: { 'human-acceptance': { applicability: 'not-applicable', reason: '' } } } });
  assert.throws(() => evaluateDeliveryCompletion({ session: invalid, traceability: traceability(), evidence: withoutHuman, profile: 'production' }), /reason/i);
  const advisory = evaluateDeliveryCompletion({ session: current, traceability: { ...traceability(), status: 'incomplete', gaps: ['open gap'] }, evidence: [], profile: 'advisory' });
  assert.equal(advisory.overall, 'incomplete');
  assert.ok(advisory.residualGaps.includes('open gap'));
});

test('unresolved requirement questions and orphan production paths block completion', () => {
  const current = session();
  const incomplete = { ...traceability(), status: 'incomplete', orphanChanges: ['src/orphan.mjs'], gaps: ['orphan changed path src/orphan.mjs'] };
  const contract = evaluateDeliveryCompletion({ session: current, traceability: incomplete, evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.implementation, 'partial');
  assert.notEqual(contract.overall, 'complete');
});

function riskProfileSet() {
  const requirement = requirementFixture();
  return activateRiskProfiles({
    requirement,
    architecture: architectureFixture(canonicalContractDigest('requirement', requirement)),
    repositoryFacts: { paths: [], packages: [] },
    pack: loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql'),
  });
}

function planFor(session, set, ids = set.requiredGateIds) {
  const sorted = [...ids].sort();
  return {
    schemaVersion: 1, id: 'quality-run.completion', packId: 'pack.completion', matrixId: 'quality.completion',
    requiredGateIds: sorted,
    gates: sorted.map((id) => ({ id, owner: 'functional', purpose: 'unit', applicability: 'required', reason: null, timeoutMs: 1000, maxOutputBytes: 512, artifactBudgetBytes: 256, evidence: 'captured output' })),
    digests: { requirement: session.requirementDigest, architecture: session.architectureDigest, repository: session.repositoryDigest, pack: set.packDigest, risk: riskProfileSetDigest(set), environment: 'e'.repeat(64) },
  };
}

function runFor(session, set, { ids, status = 'passed' } = {}) {
  const plan = planFor(session, set, ids);
  const results = plan.requiredGateIds.map((gateId) => (status === 'failed' && gateId === plan.requiredGateIds[0]
    ? { gateId, status: 'failed', failureClassification: 'functional' }
    : { gateId, status: 'passed', cleanup: { status: 'clean' } }));
  return evaluateQualityMatrixRun({ plan, results, artifacts: [], environment: plan.digests.environment });
}

function withRun(base, set, run, extra = {}) {
  return session({ runtime: { riskProfileSet: set, qualityMatrixRun: run, qualityMatrixPlanId: run.planId, environmentDigest: run.digests.environment, pack: { id: 'pack.completion', digest: set.packDigest }, ...extra } });
}

test('a current quality matrix run covering every activated gate satisfies production verification', () => {
  const set = riskProfileSet();
  const base = session();
  const current = withRun(base, set, runFor(base, set));
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.gates.find((gate) => gate.id === 'automated-verification').status, 'passed');
  assert.equal(contract.overall, 'complete');
});

test('a failed, incomplete, or stale quality matrix run keeps production blocked', () => {
  const set = riskProfileSet();
  const base = session();
  const failedSession = withRun(base, set, runFor(base, set, { status: 'failed' }));
  const failed = evaluateDeliveryCompletion({ session: failedSession, traceability: traceability(), evidence: currentEvidence(failedSession), profile: 'production' });
  assert.notEqual(failed.overall, 'complete');
  assert.ok(failed.residualGaps.some((gap) => gap.includes('quality matrix run')));

  const partialSession = withRun(base, set, runFor(base, set, { ids: set.requiredGateIds.slice(1) }));
  const uncovered = evaluateDeliveryCompletion({ session: partialSession, traceability: traceability(), evidence: currentEvidence(partialSession), profile: 'production' });
  assert.ok(uncovered.residualGaps.some((gap) => gap.includes('does not cover')));

  const staleRun = runFor(base, set);
  const staleSession = { ...withRun(base, set, staleRun), repositoryDigest: 'f'.repeat(64) };
  const stale = evaluateDeliveryCompletion({ session: staleSession, traceability: traceability(), evidence: currentEvidence(staleSession), profile: 'production' });
  assert.ok(stale.residualGaps.some((gap) => gap.includes('stale') && gap.includes('repository')));

  const movedPlan = withRun(base, set, runFor(base, set), { qualityMatrixPlanId: 'quality-run.other' });
  const moved = evaluateDeliveryCompletion({ session: movedPlan, traceability: traceability(), evidence: currentEvidence(movedPlan), profile: 'production' });
  assert.ok(moved.residualGaps.some((gap) => gap.includes('stale') && gap.includes('plan')));
});

test('a failed golden path architecture evaluation blocks production completion', () => {
  const failed = session({ runtime: { architectureEvaluation: { status: 'failed', digest, issueCodes: ['cross-feature-private-import'], unsupportedFiles: [] } } });
  const contract = evaluateDeliveryCompletion({ session: failed, traceability: traceability(), evidence: currentEvidence(failed), profile: 'production' });
  assert.equal(contract.overall, 'blocked');
  assert.equal(contract.gates.find((gate) => gate.id === 'architecture').status, 'blocked');
  assert.ok(contract.residualGaps.some((gap) => gap.includes('architecture evaluation failed')));

  const passing = session({ runtime: { architectureEvaluation: { status: 'passed', digest, issueCodes: [], unsupportedFiles: [] } } });
  assert.equal(evaluateDeliveryCompletion({ session: passing, traceability: traceability(), evidence: currentEvidence(passing), profile: 'production' }).overall, 'complete');
});

test('malformed risk and architecture bindings fail closed', () => {
  const current = session({ runtime: { architectureEvaluation: { status: 'unknown', digest, issueCodes: [], unsupportedFiles: [] } } });
  assert.throws(() => evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: [], profile: 'production' }), /architectureEvaluation/);
  const tampered = session({ runtime: { riskProfileSet: { ...riskProfileSet(), requirementDigest: 'not-a-digest' } } });
  assert.throws(() => evaluateDeliveryCompletion({ session: tampered, traceability: traceability(), evidence: [], profile: 'production' }), /requirementDigest/);
});
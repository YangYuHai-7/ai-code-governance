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

test('completion refuses evidence owned by another delivery session', () => {
  const current = session();
  const foreign = currentEvidence(current).map((entry) => ({ ...entry, sessionId: 'session.other' }));
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: foreign, profile: 'production' });
  assert.notEqual(contract.overall, 'complete');
  assert.equal(contract.verification, 'unverified');
  assert.equal(contract.acceptance, 'unreviewed');
  for (const stage of ['automated-verification', 'independent-review', 'human-acceptance', 'deployability']) {
    assert.notEqual(contract.gates.find((gate) => gate.id === stage).status, 'passed');
  }
});

test('foreign or stale failures do not classify the current session as failed or rejected', () => {
  const current = session();
  const foreignFailure = { sessionId: 'session.other', semanticDigest: current.requirementDigest, repositoryDigest: current.repositoryDigest, status: 'failed' };
  const staleFailure = { sessionId: current.id, semanticDigest: current.requirementDigest, repositoryDigest: 'f'.repeat(64), status: 'failed' };
  for (const overrides of [foreignFailure, staleFailure]) {
    const records = [evidence('automated-test', 'evidence.failed', overrides), evidence('human-acceptance', 'evidence.rejected', overrides)];
    const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: records, profile: 'production' });
    assert.equal(contract.verification, 'unverified');
    assert.equal(contract.acceptance, 'unreviewed');
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
  const withoutLegacyAutomatedRecord = evaluateDeliveryCompletion({
    session: current, traceability: traceability(),
    evidence: currentEvidence(current).filter((entry) => entry.source !== 'automated-test'),
    profile: 'production',
  });
  assert.equal(withoutLegacyAutomatedRecord.verification, 'verified');
  assert.equal(withoutLegacyAutomatedRecord.gates.find((gate) => gate.id === 'automated-verification').status, 'passed');
  assert.equal(withoutLegacyAutomatedRecord.overall, 'complete');
});

test('a failed, incomplete, or stale quality matrix run keeps production blocked', () => {
  const set = riskProfileSet();
  const base = session();
  const failedSession = withRun(base, set, runFor(base, set, { status: 'failed' }));
  const failed = evaluateDeliveryCompletion({ session: failedSession, traceability: traceability(), evidence: currentEvidence(failedSession), profile: 'production' });
  assert.notEqual(failed.overall, 'complete');
  assert.equal(failed.verification, 'failed');
  assert.ok(failed.residualGaps.some((gap) => gap.includes('quality matrix run')));

  const partialSession = withRun(base, set, runFor(base, set, { ids: set.requiredGateIds.slice(1) }));
  const uncovered = evaluateDeliveryCompletion({ session: partialSession, traceability: traceability(), evidence: currentEvidence(partialSession), profile: 'production' });
  assert.equal(uncovered.verification, 'unverified');
  assert.ok(uncovered.residualGaps.some((gap) => gap.includes('does not cover')));

  const staleRun = runFor(base, set);
  const staleSession = { ...withRun(base, set, staleRun), repositoryDigest: 'f'.repeat(64) };
  const stale = evaluateDeliveryCompletion({ session: staleSession, traceability: traceability(), evidence: currentEvidence(staleSession), profile: 'production' });
  assert.equal(stale.verification, 'unverified');
  assert.ok(stale.residualGaps.some((gap) => gap.includes('stale') && gap.includes('repository')));

  const architectureRun = runFor(base, set);
  const staleArchitectureSession = withRun(base, set, {
    ...architectureRun, digests: { ...architectureRun.digests, architecture: 'f'.repeat(64) },
  });
  const staleArchitecture = evaluateDeliveryCompletion({ session: staleArchitectureSession, traceability: traceability(), evidence: currentEvidence(staleArchitectureSession), profile: 'production' });
  assert.ok(staleArchitecture.residualGaps.some((gap) => gap.includes('stale') && gap.includes('architecture')));

  const movedPlan = withRun(base, set, runFor(base, set), { qualityMatrixPlanId: 'quality-run.other' });
  const moved = evaluateDeliveryCompletion({ session: movedPlan, traceability: traceability(), evidence: currentEvidence(movedPlan), profile: 'production' });
  assert.ok(moved.residualGaps.some((gap) => gap.includes('stale') && gap.includes('plan')));
});

test('a matrix cannot verify a session when its risk profile set belongs to another requirement', () => {
  const base = session();
  const staleSet = { ...riskProfileSet(), requirementDigest: 'f'.repeat(64) };
  const current = withRun(base, staleSet, runFor(base, staleSet));
  const contract = evaluateDeliveryCompletion({
    session: current,
    traceability: traceability(),
    evidence: currentEvidence(current).filter((entry) => entry.source !== 'automated-test'),
    profile: 'production',
  });
  assert.equal(contract.verification, 'unverified');
  assert.equal(contract.gates.find((gate) => gate.id === 'automated-verification').status, 'blocked');
  assert.ok(contract.residualGaps.some((gap) => /risk.*requirement/.test(gap)));
});

test('a matrix cannot verify a session when its risk profile set belongs to another Pack', () => {
  const base = session();
  const set = riskProfileSet();
  const staleSet = { ...set, packDigest: 'f'.repeat(64) };
  const run = runFor(base, set);
  const current = withRun(base, staleSet, {
    ...run,
    digests: { ...run.digests, risk: riskProfileSetDigest(staleSet) },
  }, { pack: { id: 'pack.completion', digest: set.packDigest } });
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.verification, 'unverified');
  assert.ok(contract.residualGaps.some((gap) => /risk.*pack/i.test(gap)));
});

test('a Pack-bound matrix cannot verify a session without its risk profile set', () => {
  const base = session();
  const set = riskProfileSet();
  const withRisk = withRun(base, set, runFor(base, set));
  const runtime = { ...withRisk.runtime };
  delete runtime.riskProfileSet;
  const current = { ...withRisk, runtime };
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.verification, 'unverified');
  assert.ok(contract.residualGaps.some((gap) => /risk.*missing/i.test(gap)));
});

test('a Pack-bound matrix cannot verify a session without its plan binding', () => {
  const base = session();
  const set = riskProfileSet();
  const bound = withRun(base, set, runFor(base, set));
  const runtime = { ...bound.runtime };
  delete runtime.qualityMatrixPlanId;
  const current = { ...bound, runtime };
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.verification, 'unverified');
  assert.ok(contract.residualGaps.some((gap) => /plan.*missing/i.test(gap)));
});

test('a Pack-bound matrix cannot verify a session without its environment binding', () => {
  const base = session();
  const set = riskProfileSet();
  const bound = withRun(base, set, runFor(base, set));
  const runtime = { ...bound.runtime };
  delete runtime.environmentDigest;
  const current = { ...bound, runtime };
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.verification, 'unverified');
  assert.ok(contract.residualGaps.some((gap) => /environment.*missing/i.test(gap)));
});

test('legacy automated evidence cannot replace a missing Pack quality matrix', () => {
  const current = session({ runtime: { pack: { id: 'pack.completion', digest: riskProfileSet().packDigest } } });
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.verification, 'unverified');
  assert.equal(contract.gates.find((gate) => gate.id === 'automated-verification').status, 'blocked');
  assert.ok(contract.residualGaps.some((gap) => /quality matrix.*missing/i.test(gap)));
});

test('a passed matrix cannot clear a risk profile that still needs an owner decision', () => {
  const base = session();
  const set = riskProfileSet();
  const profiles = set.profiles.map((entry) => entry.id === 'privacy'
    ? { ...entry, applicability: 'blocked', triggerEvidence: [{ source: 'requirement', detail: 'requirement.summary: personal data' }], reason: 'Owner decision required.' }
    : entry);
  const blockedSet = { ...set, profiles, ownerQuestions: [{ id: 'question.risk.privacy', profileId: 'privacy', question: 'Confirm privacy evidence provider.', material: true }] };
  const current = withRun(base, blockedSet, runFor(base, blockedSet));
  const contract = evaluateDeliveryCompletion({ session: current, traceability: traceability(), evidence: currentEvidence(current), profile: 'production' });
  assert.equal(contract.verification, 'unverified');
  assert.equal(contract.gates.find((gate) => gate.id === 'automated-verification').status, 'blocked');
  assert.ok(contract.residualGaps.some((gap) => /risk profile privacy.*owner decision/i.test(gap)));
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
test('production completion consumes executed review independence when it is recorded', () => {
  const baseline = session();
  assert.equal(evaluateDeliveryCompletion({ session: baseline, traceability: traceability(), evidence: currentEvidence(baseline), profile: 'production' }).overall, 'complete');

  const shared = session({ runtime: { reviewSessions: [
    { role: 'implementer', identity: 'agent-1', sessionId: 'session.a' },
    { role: 'reviewer', identity: 'agent-1', sessionId: 'session.b' },
  ] } });
  const blocked = evaluateDeliveryCompletion({ session: shared, traceability: traceability(), evidence: currentEvidence(shared), profile: 'production' });
  assert.notEqual(blocked.overall, 'complete');
  assert.ok(blocked.residualGaps.some((gap) => gap.startsWith('review-independence:shared-identity')));

  const satisfied = session({ runtime: { reviewRisk: 'high', reviewSessions: [
    { role: 'implementer', identity: 'agent-1', sessionId: 'session.a' },
    { role: 'reviewer', identity: 'agent-2', sessionId: 'session.b' },
    { role: 'referee', identity: 'agent-3', sessionId: 'session.c' },
  ] } });
  assert.equal(evaluateDeliveryCompletion({ session: satisfied, traceability: traceability(), evidence: currentEvidence(satisfied), profile: 'production' }).overall, 'complete');
});

test('production completion consumes structured review findings when they are recorded', () => {
  const finding = { id: 'finding.1', role: 'reviewer', severity: 'critical', statement: 'Unbounded retry.', evidence: 'apps/api/src/transport/board-routes.ts:12', proposedResolution: 'Bound retries.', disposition: 'open', owner: 'reviewer-1' };
  const blocked = session({ runtime: { reviewFindings: [finding] } });
  const contract = evaluateDeliveryCompletion({ session: blocked, traceability: traceability(), evidence: currentEvidence(blocked), profile: 'production' });
  assert.notEqual(contract.overall, 'complete');
  assert.ok(contract.residualGaps.some((gap) => gap.startsWith('review-finding:unresolved-critical')));

  const selfReview = session({ runtime: { reviewFindings: [{ ...finding, severity: 'minor', disposition: 'resolved', owner: 'implementer-1' }], implementerIdentity: 'implementer-1' } });
  const selfContract = evaluateDeliveryCompletion({ session: selfReview, traceability: traceability(), evidence: currentEvidence(selfReview), profile: 'production' });
  assert.ok(selfContract.residualGaps.some((gap) => gap.startsWith('review-finding:self-review-finding')));
});

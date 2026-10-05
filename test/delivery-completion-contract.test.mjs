import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTraceabilityGraph,
  canonicalContractDigest,
  createDeliverySession,
  evaluateDeliveryCompletion,
  evaluateTraceability,
} from '../src/modules/delivery-core/index.mjs';
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

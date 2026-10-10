import assert from 'node:assert/strict';
import test from 'node:test';
import { canonicalContractDigest, createDeliverySession, evaluateDeliveryCompletion, recordReviewEvidence } from '../src/modules/delivery-core/index.mjs';
import { architectureFixture, authorityFixture, budgetsFixture, repositoryFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

function session() {
  const requirement = requirementFixture();
  return createDeliverySession({
    id: 'session.review-evidence', requestText: 'Record review evidence',
    requirement, architecture: architectureFixture(canonicalContractDigest('requirement', requirement)),
    authority: authorityFixture(), budgets: budgetsFixture(), repositorySnapshot: repositoryFixture(),
    clock: () => '2026-10-05T00:00:00.000Z',
  });
}

const sessions = [
  { role: 'implementer', identity: 'agent-1', sessionId: 'session.a' },
  { role: 'reviewer', identity: 'agent-2', sessionId: 'session.b' },
];

test('validated review evidence is recorded into the session runtime', () => {
  const current = session();
  const result = recordReviewEvidence(current, { risk: 'standard', sessions, findings: [] });
  assert.equal(result.status, 'recorded');
  assert.equal(result.session.runtime.reviewRisk, 'standard');
  assert.equal(result.session.runtime.reviewSessions.length, 2);
  assert.equal(result.session.sequence, current.sequence + 1);
  assert.notEqual(canonicalContractDigest('session', result.session), canonicalContractDigest('session', current));
});

test('rejected review evidence never mutates the session', () => {
  const current = session();
  const result = recordReviewEvidence(current, { risk: 'high', sessions });
  assert.equal(result.status, 'rejected');
  assert.ok(result.gaps.some((gap) => gap.startsWith('review-independence:missing-referee')));
  assert.equal(result.session.sequence, current.sequence);
  assert.equal(canonicalContractDigest('session', result.session), canonicalContractDigest('session', current));
});

test('rejected evidence leaves no false claim for the completion gate', () => {
  const current = session();
  const rejected = recordReviewEvidence(current, { risk: 'standard', sessions: [sessions[0], { role: 'reviewer', identity: 'agent-1', sessionId: 'session.b' }] });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.session.runtime, undefined);
  const unsatisfied = { ...current, runtime: { reviewSessions: [sessions[0], { role: 'reviewer', identity: 'agent-1', sessionId: 'session.b' }] } };
  const contract = evaluateDeliveryCompletion({ session: unsatisfied, traceability: { status: 'complete', gaps: [], orphanChanges: [] }, evidence: [], profile: 'production' });
  assert.ok(contract.residualGaps.some((gap) => gap.startsWith('review-independence')));
  assert.throws(() => recordReviewEvidence({ nope: true }, { risk: 'standard', sessions }), /session/i);
});

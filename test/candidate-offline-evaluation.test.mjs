import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateCandidateOffline } from '../src/modules/capabilities/index.mjs';

const candidate = { id: 'candidate.rule-1', projectId: 'project-alpha', digest: 'a'.repeat(64) };
const corpus = [
  { id: 'case.1', expected: 'pass', actual: 'pass' },
  { id: 'case.2', expected: 'pass', actual: 'pass' },
  { id: 'case.3', expected: 'fail', actual: 'fail' },
];

test('a candidate that keeps every expected outcome passes offline evaluation', () => {
  const result = evaluateCandidateOffline({ candidate, cases: corpus, thresholdPolicy: { minimumCases: 3 } });
  assert.equal(result.status, 'passed');
  assert.deepEqual(result.evidence.regressions, []);
  assert.equal(result.evidence.caseCount, 3);
  assert.match(result.evidence.digest, /^[a-f0-9]{64}$/);
  assert.equal(result.evidence.candidateId, 'candidate.rule-1');
});

test('a regression fails the candidate and is named in the evidence', () => {
  const regressed = corpus.map((entry) => (entry.id === 'case.1' ? { ...entry, actual: 'fail' } : entry));
  const result = evaluateCandidateOffline({ candidate, cases: regressed, thresholdPolicy: { minimumCases: 3 } });
  assert.equal(result.status, 'failed');
  assert.deepEqual(result.evidence.regressions, ['case.1']);
});

test('an empty or duplicate corpus fails closed instead of passing by default', () => {
  assert.equal(evaluateCandidateOffline({ candidate, cases: [] }).status, 'failed');
  assert.equal(evaluateCandidateOffline({ candidate, cases: [] }).evidence.reason, 'no-cases');
  assert.throws(() => evaluateCandidateOffline({ candidate, cases: [corpus[0], corpus[0]] }), /duplicate/i);
  assert.throws(() => evaluateCandidateOffline({ candidate, cases: [{ id: 'case.x', expected: 'maybe', actual: 'pass' }] }), /expected/i);
});

test('thresholds are enforced: too few cases or too many regressions fail', () => {
  const thin = evaluateCandidateOffline({ candidate, cases: corpus.slice(0, 2), thresholdPolicy: { minimumCases: 5 } });
  assert.equal(thin.status, 'failed');
  assert.equal(thin.evidence.reason, 'insufficient-cases');
  const tolerant = evaluateCandidateOffline({ candidate, cases: [{ id: 'case.1', expected: 'pass', actual: 'fail' }], thresholdPolicy: { minimumCases: 1, maximumRegressions: 1 } });
  assert.equal(tolerant.status, 'passed');
  const strict = evaluateCandidateOffline({ candidate, cases: [{ id: 'case.1', expected: 'pass', actual: 'fail' }], thresholdPolicy: { minimumCases: 1 } });
  assert.equal(strict.status, 'failed');
});

test('the receipt digest is deterministic and tracks the outcome', () => {
  const first = evaluateCandidateOffline({ candidate, cases: corpus, thresholdPolicy: { minimumCases: 3 } });
  const second = evaluateCandidateOffline({ candidate, cases: corpus, thresholdPolicy: { minimumCases: 3 } });
  assert.equal(first.evidence.digest, second.evidence.digest);
  const changed = evaluateCandidateOffline({ candidate, cases: corpus.slice(1), thresholdPolicy: { minimumCases: 3 } });
  assert.notEqual(first.evidence.digest, changed.evidence.digest);
  assert.ok(Object.isFrozen(first.evidence));
});

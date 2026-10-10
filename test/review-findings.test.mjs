import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReviewFindings, validateReviewFinding } from '../src/modules/release/index.mjs';

const finding = (overrides = {}) => ({
  id: 'finding.1', role: 'reviewer', severity: 'minor', statement: 'The handler retries without a bound.',
  evidence: 'apps/api/src/transport/board-routes.ts:12', proposedResolution: 'Bound the retry count.',
  disposition: 'resolved', owner: 'reviewer-1',
  ...overrides,
});

test('a well-formed finding validates and a clean set passes', () => {
  const validated = validateReviewFinding(finding());
  assert.equal(validated.severity, 'minor');
  const result = evaluateReviewFindings({ findings: [finding()] });
  assert.equal(result.status, 'clean');
  assert.deepEqual(result.gaps, []);
  assert.ok(Object.isFrozen(validated));
});

test('the finding contract is closed', () => {
  assert.throws(() => validateReviewFinding(finding({ evidence: '' })), /evidence/i);
  assert.throws(() => validateReviewFinding(finding({ severity: 'blocker' })), /severity/i);
  assert.throws(() => validateReviewFinding(finding({ disposition: 'maybe' })), /disposition/i);
  assert.throws(() => validateReviewFinding(finding({ extra: true })), /extra/);
});

test('an open critical finding blocks completion', () => {
  const result = evaluateReviewFindings({ findings: [finding({ severity: 'critical', disposition: 'open' })] });
  assert.equal(result.status, 'blocked');
  assert.ok(result.gaps.some((gap) => gap.code === 'unresolved-critical'));
});

test('accepted risk needs a human approver, not silence', () => {
  const withoutApprover = evaluateReviewFindings({ findings: [finding({ disposition: 'accepted-risk' })] });
  assert.ok(withoutApprover.gaps.some((gap) => gap.code === 'risk-without-approver'));
  const withApprover = evaluateReviewFindings({ findings: [finding({ disposition: 'accepted-risk' })], approver: { identity: 'human-1', identityClass: 'human' } });
  assert.equal(withApprover.status, 'clean');
  const machine = evaluateReviewFindings({ findings: [finding({ disposition: 'accepted-risk' })], approver: { identity: 'agent-9', identityClass: 'ai' } });
  assert.ok(machine.gaps.some((gap) => gap.code === 'risk-without-approver'));
});

test('a finding cannot be authored by the implementer of the same change', () => {
  const result = evaluateReviewFindings({ findings: [finding({ owner: 'implementer-1' })], implementerIdentity: 'implementer-1' });
  assert.equal(result.status, 'blocked');
  assert.ok(result.gaps.some((gap) => gap.code === 'self-review-finding'));
});

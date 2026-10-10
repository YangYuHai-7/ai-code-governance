import assert from 'node:assert/strict';
import test from 'node:test';
import { buildReviewEvidence } from '../src/modules/release/index.mjs';

const sessions = [
  { role: 'implementer', identity: 'agent-1', sessionId: 'session.a' },
  { role: 'reviewer', identity: 'agent-2', sessionId: 'session.b' },
];
const finding = { id: 'finding.1', role: 'reviewer', severity: 'minor', statement: 'Unbounded retry.', evidence: 'apps/api/src/transport/board-routes.ts:12', proposedResolution: 'Bound retries.', disposition: 'resolved', owner: 'reviewer-1' };

test('a satisfied review produces the exact runtime evidence production completion consumes', () => {
  const bundle = buildReviewEvidence({ risk: 'standard', sessions, findings: [finding], implementerIdentity: 'agent-9' });
  assert.equal(bundle.status, 'ready');
  assert.deepEqual(bundle.gaps, []);
  assert.deepEqual(Object.keys(bundle.runtime).sort(), ['reviewFindings', 'reviewRisk', 'reviewSessions', 'implementerIdentity'].sort());
  assert.equal(bundle.runtime.reviewRisk, 'standard');
  assert.equal(bundle.runtime.reviewSessions.length, 2);
  assert.ok(Object.isFrozen(bundle.runtime));
  assert.ok(Object.isFrozen(bundle));
});

test('review evidence cannot be recorded when the sessions are not independent', () => {
  const bundle = buildReviewEvidence({ risk: 'standard', sessions: [sessions[0], { role: 'reviewer', identity: 'agent-1', sessionId: 'session.b' }] });
  assert.equal(bundle.status, 'blocked');
  assert.ok(bundle.gaps.some((gap) => gap.startsWith('review-independence:shared-identity')));
  assert.equal(bundle.runtime.reviewSessions.length, 2);
});

test('review evidence cannot be recorded around an unresolved critical finding', () => {
  const bundle = buildReviewEvidence({ risk: 'standard', sessions, findings: [{ ...finding, severity: 'critical', disposition: 'open' }] });
  assert.equal(bundle.status, 'blocked');
  assert.ok(bundle.gaps.some((gap) => gap.startsWith('review-finding:unresolved-critical')));
});

test('a high-risk review without a referee is blocked before it is recorded', () => {
  const bundle = buildReviewEvidence({ risk: 'high', sessions });
  assert.equal(bundle.status, 'blocked');
  assert.ok(bundle.gaps.some((gap) => gap.startsWith('review-independence:missing-referee')));
  assert.throws(() => buildReviewEvidence({ risk: 'standard', sessions: 'nope' }), /sessions/i);
});

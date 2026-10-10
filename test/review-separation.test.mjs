import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateReviewIndependence, requiredReviewRoles } from '../src/modules/release/index.mjs';

const session = (role, identity, sessionId, identityClass = 'human') => ({ role, identity, sessionId, identityClass });

test('required roles scale with risk instead of being declared once for everything', () => {
  assert.deepEqual([...requiredReviewRoles({ risk: 'standard' })], ['implementer', 'reviewer']);
  assert.deepEqual([...requiredReviewRoles({ risk: 'high' })], ['implementer', 'reviewer', 'referee']);
  assert.deepEqual([...requiredReviewRoles({ risk: 'production' })], ['implementer', 'reviewer', 'referee', 'approver']);
});

test('distinct sessions and identities satisfy independence', () => {
  const result = evaluateReviewIndependence({ risk: 'standard', sessions: [session('implementer', 'agent-1', 'session.a'), session('reviewer', 'agent-2', 'session.b')] });
  assert.equal(result.status, 'satisfied');
  assert.deepEqual(result.gaps, []);
});

test('a high-risk review needs a referee, not just a reviewer', () => {
  const result = evaluateReviewIndependence({ risk: 'high', sessions: [session('implementer', 'agent-1', 'session.a'), session('reviewer', 'agent-2', 'session.b')] });
  assert.equal(result.status, 'blocked');
  assert.ok(result.gaps.some((gap) => gap.code === 'missing-referee'));
});

test('one identity or one session can never cover two review roles', () => {
  const sameIdentity = evaluateReviewIndependence({ risk: 'standard', sessions: [session('implementer', 'agent-1', 'session.a'), session('reviewer', 'agent-1', 'session.b')] });
  assert.ok(sameIdentity.gaps.some((gap) => gap.code === 'shared-identity'));
  assert.ok(sameIdentity.gaps.some((gap) => gap.code === 'self-approval'));
  const sameSession = evaluateReviewIndependence({ risk: 'standard', sessions: [session('implementer', 'agent-1', 'session.a'), session('reviewer', 'agent-2', 'session.a')] });
  assert.ok(sameSession.gaps.some((gap) => gap.code === 'shared-session'));
  const duplicated = evaluateReviewIndependence({ risk: 'standard', sessions: [session('reviewer', 'agent-2', 'session.b'), session('reviewer', 'agent-3', 'session.c')] });
  assert.ok(duplicated.gaps.some((gap) => gap.code === 'duplicate-role'));
});

test('a machine identity can never be the sole approver', () => {
  const machine = evaluateReviewIndependence({ risk: 'production', sessions: [
    session('implementer', 'agent-1', 'session.a'), session('reviewer', 'agent-2', 'session.b'),
    session('referee', 'agent-3', 'session.c'), session('approver', 'agent-4', 'session.d', 'ai'),
  ] });
  assert.equal(machine.status, 'blocked');
  assert.ok(machine.gaps.some((gap) => gap.code === 'ai-approval'));
  const human = evaluateReviewIndependence({ risk: 'production', sessions: [
    session('implementer', 'agent-1', 'session.a'), session('reviewer', 'agent-2', 'session.b'),
    session('referee', 'agent-3', 'session.c'), session('approver', 'human-1', 'session.d'),
  ] });
  assert.equal(human.status, 'satisfied');
});

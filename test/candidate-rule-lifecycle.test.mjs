import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateRule, deduplicateCandidateRules, transitionCandidateRule } from '../src/modules/capabilities/index.mjs';

const HASH = 'a'.repeat(64);
const rule = () => createCandidateRule({ id: 'candidate.rule-1', projectId: 'project-alpha', observationId: 'observation.1', digest: HASH });
const reviewer = { class: 'independent-reviewer', projectId: 'project-beta' };
const approver = { class: 'human-owner', projectId: 'project-beta' };

function advance(events = []) {
  return events.reduce((current, event) => transitionCandidateRule(current, event), rule());
}

test('a candidate travels the governed lifecycle and a project can never promote its own rule', () => {
  const promoted = advance([
    { type: 'deduplicate', duplicateOf: null },
    { type: 'offline-evaluate', evidence: { cases: 3, regressions: 0 } },
    { type: 'independent-review', reviewer },
    { type: 'approve', approver },
    { type: 'canary', evidence: { current: true, projectIds: ['project-beta'] } },
    { type: 'monitor', evidence: { monitoredWindowPassed: true } },
    { type: 'promote', evidence: { monitoredWindowPassed: true } },
  ]);
  assert.equal(promoted.state, 'promoted');
  assert.equal(promoted.history.length, 8);
  assert.ok(Object.isFrozen(promoted));
});

test('illegal transitions are rejected instead of skipping governance', () => {
  assert.throws(() => advance([{ type: 'promote', evidence: { monitoredWindowPassed: true } }]), /Illegal candidate rule transition/);
  assert.throws(() => advance([{ type: 'deduplicate' }, { type: 'approve', approver }]), /Illegal candidate rule transition/);
});

test('self-review, self-approval, and Agent approval are refused', () => {
  const reviewed = advance([{ type: 'deduplicate' }, { type: 'offline-evaluate', evidence: {} }]);
  assert.throws(() => transitionCandidateRule(reviewed, { type: 'independent-review', reviewer: { class: 'independent-reviewer', projectId: 'project-alpha' } }), /independently reviewed/);
  const ready = transitionCandidateRule(reviewed, { type: 'independent-review', reviewer });
  assert.throws(() => transitionCandidateRule(ready, { type: 'approve', approver: { class: 'human-owner', projectId: 'project-alpha' } }), /never promote its own/);
  assert.throws(() => transitionCandidateRule(ready, { type: 'approve', approver: { class: 'ai', projectId: 'project-beta' } }), /human owner/);
});

test('an identical observation is deduplicated instead of creating a second candidate', () => {
  const first = rule();
  const list = deduplicateCandidateRules([first], { projectId: 'project-alpha', observationId: 'observation.2', digest: HASH });
  assert.equal(list.length, 1);
  assert.equal(list[0].id, first.id);
  const appended = deduplicateCandidateRules([first], { projectId: 'project-alpha', observationId: 'observation.3', digest: 'b'.repeat(64) });
  assert.equal(appended.length, 2);
});

test('a failed canary rolls back and promotion needs a monitored window', () => {
  const canaried = advance([
    { type: 'deduplicate' }, { type: 'offline-evaluate', evidence: {} },
    { type: 'independent-review', reviewer }, { type: 'approve', approver },
    { type: 'canary', evidence: { current: true } },
  ]);
  assert.throws(() => transitionCandidateRule(canaried, { type: 'promote', evidence: { monitoredWindowPassed: true, canaryPassed: false } }), /canary/);
  assert.throws(() => transitionCandidateRule(canaried, { type: 'rollback' }), /reason/);
  const rolled = transitionCandidateRule(canaried, { type: 'rollback', reason: 'canary regression' });
  assert.equal(rolled.state, 'rolled-back');
  assert.throws(() => transitionCandidateRule(rolled, { type: 'canary', evidence: {} }), /Illegal candidate rule transition/);
});

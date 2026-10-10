import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateRule, transitionCandidateRule } from '../src/modules/capabilities/index.mjs';

const DIGEST = 'd'.repeat(64);
const base = () => createCandidateRule({ id: 'candidate.rule-1', projectId: 'project-alpha', observationId: 'observation.1', digest: 'a'.repeat(64) });
const deduped = () => transitionCandidateRule(base(), { type: 'deduplicate' });

test('offline evaluation must carry a passed receipt digest before review', () => {
  assert.throws(() => transitionCandidateRule(deduped(), { type: 'offline-evaluate' }), /offline evaluation/i);
  assert.throws(() => transitionCandidateRule(deduped(), { type: 'offline-evaluate', evidence: { status: 'passed' } }), /offline evaluation/i);
  assert.throws(() => transitionCandidateRule(deduped(), { type: 'offline-evaluate', evidence: { status: 'failed', digest: DIGEST } }), /offline evaluation failed/i);
  const ready = transitionCandidateRule(deduped(), { type: 'offline-evaluate', evidence: { status: 'passed', digest: DIGEST, caseCount: 3 } });
  assert.equal(ready.state, 'offline-evaluated');
  assert.equal(ready.history.at(-1).evidenceDigest, DIGEST);
  assert.equal(ready.history.at(-1).event, 'offline-evaluate');
});

test('canary and monitoring refuse to advance without current evidence', () => {
  const reviewed = transitionCandidateRule(transitionCandidateRule(deduped(), { type: 'offline-evaluate', evidence: { status: 'passed', digest: DIGEST } }), { type: 'independent-review', reviewer: { class: 'independent-reviewer', projectId: 'project-beta' } });
  const approved = transitionCandidateRule(reviewed, { type: 'approve', approver: { class: 'human-owner', projectId: 'project-beta' } });
  assert.throws(() => transitionCandidateRule(approved, { type: 'canary', evidence: { current: false } }), /canary/i);
  const canaried = transitionCandidateRule(approved, { type: 'canary', evidence: { current: true, digest: DIGEST } });
  assert.equal(canaried.history.at(-1).evidenceDigest, DIGEST);
  assert.throws(() => transitionCandidateRule(canaried, { type: 'monitor', evidence: { monitoredWindowPassed: false } }), /monitored window/i);
  const monitored = transitionCandidateRule(canaried, { type: 'monitor', evidence: { monitoredWindowPassed: true, digest: DIGEST } });
  assert.equal(monitored.state, 'monitored');
});

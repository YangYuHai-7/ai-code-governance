import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateRule, evaluateCandidateCanary, transitionCandidateRule } from '../src/modules/capabilities/index.mjs';

const candidate = () => createCandidateRule({ id: 'candidate.rule-1', projectId: 'project-alpha', observationId: 'observation.1', digest: 'a'.repeat(64) });

test('a healthy canary across an independent project passes and points at monitoring', () => {
  const result = evaluateCandidateCanary({
    candidate: candidate(),
    canary: { windowDays: 3, observations: [
      { projectId: 'project-beta', gate: 'unit-tests', passed: true, regressions: [] },
      { projectId: 'project-beta', gate: 'integration', passed: true, regressions: [] },
    ] },
    thresholdPolicy: { minimumWindowDays: 2, minimumIndependentProjects: 1 },
  });
  assert.equal(result.status, 'passed');
  assert.equal(result.action, 'monitor');
  assert.equal(result.evidence.monitoredWindowPassed, true);
  assert.match(result.evidence.digest, /^[a-f0-9]{64}$/);
  assert.deepEqual(result.evidence.regressions, []);
});

test('the originating project alone can never validate its own canary', () => {
  const result = evaluateCandidateCanary({
    candidate: candidate(),
    canary: { windowDays: 3, observations: [{ projectId: 'project-alpha', gate: 'unit-tests', passed: true, regressions: [] }] },
    thresholdPolicy: { minimumWindowDays: 1, minimumIndependentProjects: 1 },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.action, 'rollback');
  assert.equal(result.evidence.reason, 'no-independent-observation');
});

test('a canary regression fails the candidate and names the regressed gate', () => {
  const result = evaluateCandidateCanary({
    candidate: candidate(),
    canary: { windowDays: 3, observations: [
      { projectId: 'project-beta', gate: 'unit-tests', passed: true, regressions: [] },
      { projectId: 'project-gamma', gate: 'contract-tests', passed: false, regressions: ['case.4'] },
    ] },
    thresholdPolicy: { minimumWindowDays: 1, minimumIndependentProjects: 1 },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.evidence.reason, 'canary-regression');
  assert.deepEqual(result.evidence.regressions, ['case.4']);
  assert.equal(result.evidence.monitoredWindowPassed, false);
});

test('a window shorter than the minimum cannot promote', () => {
  const result = evaluateCandidateCanary({
    candidate: candidate(),
    canary: { windowDays: 1, observations: [{ projectId: 'project-beta', gate: 'unit-tests', passed: true, regressions: [] }] },
    thresholdPolicy: { minimumWindowDays: 5, minimumIndependentProjects: 1 },
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.evidence.reason, 'window-too-short');
});

test('the canary outcome drives the lifecycle instead of bypassing it', () => {
  const passed = evaluateCandidateCanary({
    candidate: candidate(),
    canary: { windowDays: 3, observations: [{ projectId: 'project-beta', gate: 'unit-tests', passed: true, regressions: [] }] },
    thresholdPolicy: { minimumWindowDays: 1, minimumIndependentProjects: 1 },
  });
  const canaried = transitionCandidateRule(
    transitionCandidateRule(
      transitionCandidateRule(
        transitionCandidateRule(candidate(), { type: 'deduplicate' }),
        { type: 'offline-evaluate', evidence: { status: 'passed', digest: 'd'.repeat(64) } }),
      { type: 'independent-review', reviewer: { class: 'independent-reviewer', projectId: 'project-beta' } }),
    { type: 'approve', approver: { class: 'human-owner', projectId: 'project-beta' } });
  const monitored = transitionCandidateRule(transitionCandidateRule(canaried, { type: 'canary', evidence: { current: true, digest: passed.evidence.digest } }), { type: 'monitor', evidence: passed.evidence });
  assert.equal(monitored.state, 'monitored');
  const failed = evaluateCandidateCanary({ candidate: candidate(), canary: { windowDays: 1, observations: [{ projectId: 'project-beta', gate: 'unit-tests', passed: false, regressions: ['case.1'] }] }, thresholdPolicy: { minimumWindowDays: 1, minimumIndependentProjects: 1 } });
  const rolled = transitionCandidateRule(canaried, { type: 'rollback', reason: failed.evidence.reason });
  assert.equal(rolled.state, 'rolled-back');
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { createCandidateRule, describeCandidateReview, transitionCandidateRule } from '../src/modules/capabilities/index.mjs';

function memoryStore(seed = []) {
  const writes = [];
  let value = seed;
  return { writes, read: () => value, write: (next) => { writes.push(next); value = next; return next; } };
}

const base = (id = 'candidate.rule-1') => createCandidateRule({ id, projectId: 'project-alpha', observationId: 'observation.1', digest: 'a'.repeat(64) });
const digest = 'd'.repeat(64);

function reviewed() {
  return transitionCandidateRule(
    transitionCandidateRule(base(), { type: 'deduplicate' }),
    { type: 'offline-evaluate', evidence: { status: 'passed', digest } });
}

test('an empty candidate store reports empty instead of inventing work', () => {
  const review = describeCandidateReview({ store: memoryStore() });
  assert.equal(review.status, 'empty');
  assert.deepEqual([...review.candidates], []);
  assert.deepEqual([...review.pendingApprovals], []);
});

test('candidates are described with their next legal action and decision state', () => {
  const promoted = transitionCandidateRule(
    transitionCandidateRule(reviewed(), { type: 'independent-review', reviewer: { class: 'independent-reviewer', projectId: 'project-beta' } }),
    { type: 'approve', approver: { class: 'human-owner', projectId: 'project-beta' } });
  const store = memoryStore([reviewed(), promoted]);
  const review = describeCandidateReview({ store });
  assert.equal(review.status, 'ready');
  const awaiting = review.candidates.find((entry) => entry.id === 'candidate.rule-1');
  assert.equal(awaiting.state, 'offline-evaluated');
  assert.equal(awaiting.awaitingDecision, false);
  assert.equal(awaiting.nextAction, 'independent-review');
  const approved = review.candidates.find((entry) => entry.state === 'approved');
  assert.equal(approved.awaitingDecision, false);
  assert.equal(approved.nextAction, 'canary');
  assert.deepEqual([...review.pendingApprovals], []);
});

test('a candidate awaiting the human owner is surfaced as a pending approval', () => {
  const ready = transitionCandidateRule(reviewed(), { type: 'independent-review', reviewer: { class: 'independent-reviewer', projectId: 'project-beta' } });
  const review = describeCandidateReview({ store: memoryStore([ready]) });
  assert.deepEqual([...review.pendingApprovals], ['candidate.rule-1']);
  assert.equal(review.candidates[0].awaitingDecision, true);
  assert.equal(review.candidates[0].nextAction, 'approve');
});

test('describing a review never writes to the candidate store', () => {
  const store = memoryStore([reviewed()]);
  describeCandidateReview({ store });
  describeCandidateReview({ store, candidateId: 'candidate.rule-1' });
  assert.deepEqual(store.writes, []);
});

test('a single candidate can be filtered and unknown ids are rejected', () => {
  const store = memoryStore([reviewed(), base('candidate.rule-2')]);
  const one = describeCandidateReview({ store, candidateId: 'candidate.rule-1' });
  assert.equal(one.candidates.length, 1);
  assert.equal(one.candidates[0].id, 'candidate.rule-1');
  assert.deepEqual([...one.candidates[0].evidenceDigests], [digest]);
  assert.throws(() => describeCandidateReview({ store, candidateId: 'candidate.missing' }), /unknown candidate/i);
});

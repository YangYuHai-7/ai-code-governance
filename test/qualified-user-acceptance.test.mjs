import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateQualifiedUserAcceptance, qualifiedUserEvidence, validateQualifiedUserAcceptance } from '../src/modules/evaluation/index.mjs';

const HASH = { requirement: 'a'.repeat(64), pack: 'b'.repeat(64), run: 'c'.repeat(64), repository: 'd'.repeat(64) };

function acceptance(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'acceptance.golden-path-1',
    participant: { class: 'qualified-human', stackFamiliarity: 'unfamiliar', identity: 'participant-1' },
    observer: { class: 'independent-human', identity: 'observer-1' },
    implementerIdentity: 'implementer-1',
    digests: { ...HASH },
    decisionsRequested: ['scope-approval', 'rollback-review'],
    ownerQuestions: [{ id: 'question.scope', material: true, status: 'resolved' }],
    elapsedMinutes: 42,
    recoveryActions: [{ id: 'recovery.restart', intervention: 'restart the interrupted run', hidden: false }],
    localRun: { status: 'passed', entrypoint: 'npm run start:local' },
    residualGaps: [],
    outcome: 'accepted',
    recordedAt: '2026-10-06T00:00:00.000Z',
    ...overrides,
  };
}

const codes = (record) => evaluateQualifiedUserAcceptance(record).gaps.map((gap) => gap.code);

test('an independent, unfamiliar qualified user with a passing local run is accepted', () => {
  const evaluation = evaluateQualifiedUserAcceptance(acceptance());
  assert.equal(evaluation.status, 'accepted');
  assert.deepEqual(evaluation.gaps, []);
});

test('implementer self-acceptance and AI identities are rejected', () => {
  assert.ok(codes(acceptance({ participant: { class: 'implementer', stackFamiliarity: 'unfamiliar', identity: 'implementer-1' } })).includes('implementer-self-acceptance'));
  assert.ok(codes(acceptance({ participant: { class: 'qualified-human', stackFamiliarity: 'unfamiliar', identity: 'implementer-1' } })).includes('implementer-self-acceptance'));
  assert.ok(codes(acceptance({ participant: { class: 'ai', stackFamiliarity: 'unfamiliar', identity: 'agent-1' } })).includes('ai-identity'));
  assert.ok(codes(acceptance({ observer: { class: 'implementer', identity: 'implementer-1' } })).includes('implementer-observer'));
  assert.ok(codes(acceptance({ observer: { class: 'ai', identity: 'agent-1' } })).includes('ai-observer'));
});

test('a familiar participant or a missing unfamiliarity declaration is rejected', () => {
  assert.ok(codes(acceptance({ participant: { class: 'qualified-human', stackFamiliarity: 'familiar', identity: 'participant-1' } })).includes('participant-not-unfamiliar'));
  assert.ok(codes(acceptance({ participant: { class: 'qualified-human', identity: 'participant-1' } })).includes('participant-not-unfamiliar'));
});

test('unbound digests, unresolved owner questions, failed runs, hidden recovery, and missing gaps are rejected', () => {
  assert.ok(codes(acceptance({ digests: { ...HASH, run: 'not-a-digest' } })).includes('unbound-run-digest'));
  assert.ok(codes(acceptance({ digests: { ...HASH, run: 'e'.repeat(64) } }), ).length === 0);
  assert.deepEqual(evaluateQualifiedUserAcceptance(acceptance({ digests: { ...HASH, run: 'e'.repeat(64) } }), { expectedRunDigest: 'f'.repeat(64) }).gaps.map((gap) => gap.code), ['stale-run-digest']);
  assert.ok(codes(acceptance({ ownerQuestions: [{ id: 'question.scope', material: true, status: 'open' }] })).includes('unresolved-owner-question'));
  assert.ok(codes(acceptance({ localRun: { status: 'failed', entrypoint: 'npm run start:local' } })).includes('local-run-failed'));
  assert.ok(codes(acceptance({ recoveryActions: [{ id: 'recovery.restart', intervention: 'restart', hidden: true }] })).includes('hidden-recovery'));
  assert.ok(codes(acceptance({ residualGaps: undefined })).includes('missing-residual-gaps'));
  assert.ok(codes(acceptance({ outcome: 'rejected' })).includes('outcome-not-accepted'));
});

test('the published acceptance contract is closed and versioned', () => {
  const evaluation = evaluateQualifiedUserAcceptance(acceptance());
  assert.equal(evaluation.status, 'accepted');
  const receipt = { ...acceptance(), evaluation: { status: evaluation.status, gaps: evaluation.gaps } };
  assert.equal(validateQualifiedUserAcceptance(receipt).id, 'acceptance.golden-path-1');
  assert.throws(() => validateQualifiedUserAcceptance({ ...receipt, extra: true }), /extra/);
  assert.throws(() => validateQualifiedUserAcceptance({ ...receipt, schemaVersion: 2 }), /schemaVersion/);
  assert.throws(() => validateQualifiedUserAcceptance({ ...receipt, participant: { class: 'robot', stackFamiliarity: 'unfamiliar', identity: 'x' } }), /class/);
});
test('an acceptance evaluation maps into certification evidence without softening a rejection', () => {
  const accepted = qualifiedUserEvidence(evaluateQualifiedUserAcceptance(acceptance()));
  assert.equal(accepted.qualifiedHuman, true);
  assert.deepEqual(accepted.gaps, []);
  const rejected = qualifiedUserEvidence(evaluateQualifiedUserAcceptance(acceptance({ participant: { class: 'implementer', stackFamiliarity: 'unfamiliar', identity: 'implementer-1' } })));
  assert.equal(rejected.qualifiedHuman, false);
  assert.ok(rejected.gaps.some((gap) => gap.code === 'qualified-user-rejected:implementer-self-acceptance'));
});

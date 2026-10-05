import assert from 'node:assert/strict';
import test from 'node:test';
import {
  canonicalContractDigest,
  createDeliverySession,
  createSessionCheckpoint,
  resumeDeliverySession,
  transitionDeliverySession,
} from '../src/modules/delivery-core/index.mjs';
import { authorityFixture, budgetsFixture, digest, repositoryFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

function create(overrides = {}) {
  return createDeliverySession({ id: 'session.fixture', requestText: 'Implement fixture', requirement: null, architecture: null, authority: authorityFixture(), budgets: budgetsFixture(), repositorySnapshot: repositoryFixture(), clock: () => '2026-10-05T00:00:00.000Z', ...overrides });
}

test('delivery sessions bind semantic inputs and allow only legal idempotent transitions', () => {
  const initial = create();
  assert.equal(initial.state, 'requirements-pending');
  const requirement = requirementFixture();
  const approved = transitionDeliverySession(initial, { id: 'event.requirement', idempotencyKey: 'approve-1', type: 'approve-requirements', requirement, at: '2026-10-05T00:01:00.000Z' });
  assert.equal(approved.state, 'requirements-approved');
  assert.equal(approved.requirementDigest, canonicalContractDigest('requirement', requirement));
  assert.equal(approved.sequence, 1);
  assert.equal(transitionDeliverySession(approved, { id: 'event.retry', idempotencyKey: 'approve-1', type: 'approve-requirements', requirement }), approved);
  assert.throws(() => transitionDeliverySession(approved, { id: 'event.skip', idempotencyKey: 'skip-1', type: 'start-execution' }), /illegal.*transition/i);
  assert.throws(() => transitionDeliverySession(initial, { id: 'event.bad', idempotencyKey: 'bad-1', type: 'approve-requirements', requirement: requirementFixture({ schemaVersion: 3 }) }), /schemaVersion/);
});

test('checkpoints bind the previous state and stay bounded', () => {
  let current = create();
  let previous;
  for (let index = 0; index < 70; index += 1) {
    previous = current;
    current = createSessionCheckpoint(current, `checkpoint ${index}`, () => `2026-10-05T00:${String(index % 60).padStart(2, '0')}:00.000Z`);
  }
  assert.equal(current.checkpoints.length, 64);
  assert.equal(current.checkpoints.at(-1).sequence, current.sequence);
  assert.match(current.checkpoints.at(-1).sessionDigest, /^[a-f0-9]{64}$/);
  assert.equal(current.previousDigest, canonicalContractDigest('session', previous));
});

test('resume rejects stale semantic, authority, and repository inputs', () => {
  const current = create({ requirement: requirementFixture() });
  const inputs = { requirementDigest: current.requirementDigest, architectureDigest: current.architectureDigest, authorityDigest: current.authorityDigest, repositoryDigest: current.repositoryDigest };
  assert.equal(resumeDeliverySession(current, inputs), current);
  for (const key of Object.keys(inputs)) assert.throws(() => resumeDeliverySession(current, { ...inputs, [key]: digest.replace(/^a/, 'b') }), new RegExp(`stale.*${key}`, 'i'));
  const cancelled = transitionDeliverySession(current, { id: 'event.cancel', idempotencyKey: 'cancel-1', type: 'cancel' });
  assert.throws(() => resumeDeliverySession(cancelled, inputs), /terminal/i);
});

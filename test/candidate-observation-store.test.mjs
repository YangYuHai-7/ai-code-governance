import assert from 'node:assert/strict';
import test from 'node:test';
import { recordCandidateObservation } from '../src/modules/capabilities/index.mjs';

function memoryStore(seed = []) {
  let value = seed;
  return {
    read: () => value,
    write: (next) => { value = next; return next; },
    snapshot: () => value,
  };
}

const observation = { rule: 'prefer-relative-imports', detail: 'cross-layer import seen twice', projectId: 'project-alpha' };

test('a project observation becomes exactly one persisted candidate', () => {
  const store = memoryStore();
  const first = recordCandidateObservation({ store, projectId: 'project-alpha', observation });
  assert.equal(first.status, 'recorded');
  assert.equal(store.snapshot().length, 1);
  assert.equal(store.snapshot()[0].state, 'observed');
  assert.equal(store.snapshot()[0].projectId, 'project-alpha');
  assert.match(store.snapshot()[0].digest, /^[a-f0-9]{64}$/);
});

test('the same observation is deduplicated instead of becoming a second global candidate', () => {
  const store = memoryStore();
  recordCandidateObservation({ store, projectId: 'project-alpha', observation });
  const second = recordCandidateObservation({ store, projectId: 'project-alpha', observation: { ...observation, detail: 'seen again in another run' } , digest: undefined });
  assert.equal(store.snapshot().length, 1);
  assert.equal(second.status, 'duplicate');
  assert.equal(second.candidate.id, store.snapshot()[0].id);
});

test('an explicit digest deduplicates even when the observation text differs', () => {
  const store = memoryStore();
  const digest = 'c'.repeat(64);
  recordCandidateObservation({ store, projectId: 'project-alpha', observation, digest });
  const duplicate = recordCandidateObservation({ store, projectId: 'project-beta', observation: { other: true }, digest });
  assert.equal(store.snapshot().length, 1);
  assert.equal(duplicate.status, 'duplicate');
});

test('recording never approves or promotes: a candidate stays observed for independent review', () => {
  const store = memoryStore();
  const recorded = recordCandidateObservation({ store, projectId: 'project-alpha', observation });
  assert.equal(recorded.candidate.state, 'observed');
  assert.throws(() => recordCandidateObservation({ store: {}, projectId: 'project-alpha', observation }), /store/);
});

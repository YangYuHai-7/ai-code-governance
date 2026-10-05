import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { canonicalContractDigest, createDeliverySession, createSessionCheckpoint } from '../src/modules/delivery-core/index.mjs';
import { authorityFixture, budgetsFixture, repositoryFixture } from './support/delivery-core-fixtures.mjs';

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-session-store-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function session(id = 'session.store') {
  return createDeliverySession({ id, requestText: 'Persist fixture', requirement: null, architecture: null, authority: authorityFixture(), budgets: budgetsFixture(), repositorySnapshot: repositoryFixture(), clock: () => '2026-10-05T00:00:00.000Z' });
}

test('store creates, lists, and atomically compare-and-swaps sessions', (context) => {
  const root = fixture(context), store = openDeliverySessionStore(root), first = session();
  assert.deepEqual(store.create(first), first);
  assert.deepEqual(store.read(first.id), first);
  assert.deepEqual(store.list().map((entry) => entry.id), [first.id]);
  const next = createSessionCheckpoint(first, 'durable', () => '2026-10-05T00:01:00.000Z');
  assert.deepEqual(store.compareAndSwap(first.id, canonicalContractDigest('session', first), next), next);
  assert.throws(() => store.compareAndSwap(first.id, canonicalContractDigest('session', first), first), /compare-and-swap conflict/i);
  assert.deepEqual(store.read(first.id), next);
  assert.throws(() => store.create(first), /already exists/i);
});

test('store rejects traversal, duplicate events, unreadable state, and link ancestors', (context) => {
  const root = fixture(context), store = openDeliverySessionStore(root), first = session();
  assert.throws(() => store.read('../escape'), /session id/i);
  store.create(first);
  assert.equal(store.appendEvent(first.id, { id: 'event.one', type: 'started' }).id, 'event.one');
  assert.throws(() => store.appendEvent(first.id, { id: 'event.one', type: 'again' }), /duplicate event/i);
  const file = path.join(root, '.ai-governance/state/delivery-sessions', first.id, 'session.json');
  fs.writeFileSync(file, '{');
  assert.throws(() => store.read(first.id), /unreadable delivery session/i);

  const linkedRoot = fixture(context), outside = fixture(context);
  fs.mkdirSync(path.join(linkedRoot, '.ai-governance/state'), { recursive: true });
  fs.symlinkSync(outside, path.join(linkedRoot, '.ai-governance/state/delivery-sessions'));
  assert.throws(() => openDeliverySessionStore(linkedRoot).create(session('session.link')), /symbolic link/i);
});

test('store recovers a corrupt current file from the last durable checkpoint and bounds retained records', (context) => {
  const root = fixture(context), store = openDeliverySessionStore(root);
  let current = session(); store.create(current);
  for (let index = 0; index < 20; index += 1) {
    const next = createSessionCheckpoint(current, `checkpoint ${index}`, () => '2026-10-05T00:01:00.000Z');
    store.compareAndSwap(current.id, canonicalContractDigest('session', current), next); current = next;
  }
  const directory = path.join(root, '.ai-governance/state/delivery-sessions', current.id);
  assert.ok(fs.readdirSync(path.join(directory, 'checkpoints')).length <= 16);
  for (let index = 0; index < 1100; index += 1) store.appendEvent(current.id, { id: `event.${index}`, type: 'test' });
  assert.ok(fs.readFileSync(path.join(directory, 'events.jsonl'), 'utf8').trim().split('\n').length <= 1024);
  fs.writeFileSync(path.join(directory, 'session.json'), '{');
  assert.deepEqual(store.read(current.id, { recover: true }), current);
});

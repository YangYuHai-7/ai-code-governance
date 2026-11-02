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

test('create never exposes an incomplete session when publication fails', (context) => {
  const root = fixture(context);
  const first = session('session.incomplete');
  const store = openDeliverySessionStore(root, { onCreateStep(step) {
    if (step === 'before-publish') throw new Error('injected publication failure');
  } });
  assert.throws(() => store.create(first), /injected publication failure/);
  const reader = openDeliverySessionStore(root);
  assert.deepEqual(reader.list(), []);
  assert.throws(() => reader.read(first.id), /does not exist|incomplete/i);
  assert.deepEqual(reader.create(first), first);
  assert.deepEqual(reader.list().map((entry) => entry.id), [first.id]);
});

test('every prepublication fault point leaves no visible session or owned staging debris', (context) => {
  const stages = ['after-stage-session', 'after-stage-events', 'after-stage-checkpoint', 'after-stage-sync', 'before-reserve', 'after-reserve', 'after-events', 'after-checkpoint', 'before-publish'];
  for (const stage of stages) {
    const root = fixture(context);
    const first = session(`session.fault.${stage}`);
    const store = openDeliverySessionStore(root, { onCreateStep(step) {
      if (step === stage) throw new Error(`injected ${stage}`);
    } });
    assert.throws(() => store.create(first), new RegExp(`injected ${stage}`));
    assert.deepEqual(store.list(), [], stage);
    const base = path.join(root, '.ai-governance/state/delivery-sessions');
    assert.equal(fs.readdirSync(base).length, 0, stage);
  }
});

test('store does not treat a reserved or companion-corrupt directory as a complete session', (context) => {
  const root = fixture(context);
  const store = openDeliverySessionStore(root);
  const base = path.join(root, '.ai-governance/state/delivery-sessions');
  fs.mkdirSync(path.join(base, 'session.reserved'), { recursive: true });
  assert.deepEqual(store.list(), []);
  assert.throws(() => store.read('session.reserved'), /incomplete/i);
  assert.throws(() => store.create(session('session.reserved')), /incomplete|already exists/i);
  store.create(session('session.corrupt-companion'));
  fs.unlinkSync(path.join(base, 'session.corrupt-companion', 'events.jsonl'));
  assert.throws(() => store.read('session.corrupt-companion'), /unreadable|incomplete/i);
  assert.throws(() => store.read('session.corrupt-companion', { recover: true }), /unreadable|incomplete/i);
  assert.throws(() => store.list(), /unreadable|incomplete/i);
});

test('a failure after publication remains recoverable by the original session id', (context) => {
  const root = fixture(context);
  const first = session('session.response-lost');
  const failing = openDeliverySessionStore(root, { onCreateStep(step) {
    if (step === 'after-publish') throw new Error('injected response loss');
  } });
  assert.throws(() => failing.create(first), /response loss/);
  const reader = openDeliverySessionStore(root);
  assert.deepEqual(reader.read(first.id), first);
  assert.deepEqual(reader.list().map((entry) => entry.id), [first.id]);
  assert.throws(() => reader.create(first), /already exists/i);
});

test('store rejects a published marker whose session id differs from its directory', (context) => {
  const root = fixture(context);
  const store = openDeliverySessionStore(root);
  const first = session('session.expected');
  store.create(first);
  fs.writeFileSync(path.join(root, '.ai-governance/state/delivery-sessions', first.id, 'session.json'), serializedOtherSession());
  assert.throws(() => store.read(first.id), /unreadable|mismatch/i);
});

test('published companion contents must be readable before a session is visible', (context) => {
  const eventRoot = fixture(context);
  const eventStore = openDeliverySessionStore(eventRoot);
  const eventSession = session('session.invalid-event');
  eventStore.create(eventSession);
  const eventDirectory = path.join(eventRoot, '.ai-governance/state/delivery-sessions', eventSession.id);
  fs.writeFileSync(path.join(eventDirectory, 'events.jsonl'), 'not-json\n');
  assert.throws(() => eventStore.read(eventSession.id), /unreadable|incomplete/i);
  assert.throws(() => eventStore.list(), /unreadable|incomplete/i);

  const checkpointRoot = fixture(context);
  const checkpointStore = openDeliverySessionStore(checkpointRoot);
  const checkpointSession = session('session.invalid-checkpoint');
  checkpointStore.create(checkpointSession);
  const checkpointDirectory = path.join(checkpointRoot, '.ai-governance/state/delivery-sessions', checkpointSession.id, 'checkpoints');
  const checkpointName = fs.readdirSync(checkpointDirectory)[0];
  fs.writeFileSync(path.join(checkpointDirectory, checkpointName), serializedOtherSession());
  assert.throws(() => checkpointStore.read(checkpointSession.id), /unreadable|incomplete/i);
  assert.throws(() => checkpointStore.list(), /unreadable|incomplete/i);
});

test('oversized event records and event logs fail closed without allocating unbounded reads', (context) => {
  const root = fixture(context);
  const store = openDeliverySessionStore(root);
  const first = session('session.large-events');
  store.create(first);
  const file = path.join(root, '.ai-governance/state/delivery-sessions', first.id, 'events.jsonl');
  assert.throws(() => store.appendEvent(first.id, { id: 'event.large', payload: 'x'.repeat(70 * 1024) }), /event.*large|bounded/i);
  assert.equal(fs.readFileSync(file, 'utf8'), '');
  fs.writeFileSync(file, 'x'.repeat(9 * 1024 * 1024));
  assert.throws(() => store.read(first.id), /unreadable|incomplete/i);
  assert.throws(() => store.list(), /unreadable|incomplete/i);
});

function serializedOtherSession() {
  return `${JSON.stringify(session('session.other'))}\n`;
}

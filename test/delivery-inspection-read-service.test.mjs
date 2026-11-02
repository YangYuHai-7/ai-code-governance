import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { createDeliverySession } from '../src/modules/delivery-core/index.mjs';
import { listDeliveryInspections, readDeliveryInspection } from '../src/modules/delivery-inspection/read-service.mjs';
import { authorityFixture, budgetsFixture, repositoryFixture } from './support/delivery-core-fixtures.mjs';

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-inspection-read-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function storedSession(id, state = 'requirements-pending') {
  const session = createDeliverySession({
    id,
    requestText: `Private request for ${id}`,
    authority: authorityFixture(),
    budgets: budgetsFixture(),
    repositorySnapshot: repositoryFixture(),
    clock: () => '2026-10-11T01:00:00.000Z',
  });
  return { ...session, state };
}

test('delivery inspection read service exposes list and detail operations', async () => {
  const service = await import('../src/modules/delivery-inspection/read-service.mjs').catch(() => ({}));
  assert.equal(typeof service.listDeliveryInspections, 'function');
  assert.equal(typeof service.readDeliveryInspection, 'function');
});

test('list returns deterministic bounded summaries while detail returns the full projection', (t) => {
  const root = repository(t);
  const store = openDeliverySessionStore(root);
  store.create(storedSession('session.zeta', 'blocked'));
  store.create(storedSession('session.alpha', 'executing'));

  const listed = listDeliveryInspections(root, { limit: 1 });
  assert.deepEqual({ schemaVersion: listed.schemaVersion, total: listed.total, count: listed.count, truncated: listed.truncated }, {
    schemaVersion: 1, total: 2, count: 1, truncated: true,
  });
  assert.deepEqual(listed.sessions.map((entry) => entry.sessionId), ['session.alpha']);
  assert.equal(listed.sessions[0].guided.status, 'in-progress');
  assert.equal(listed.sessions[0].expert, undefined);
  assert.equal(JSON.stringify(listed).includes('Private request'), false);

  const detail = readDeliveryInspection(root, 'session.alpha');
  assert.equal(detail.semanticDigest, listed.sessions[0].semanticDigest);
  assert.equal(detail.expert.authority.allowNetwork, false);
});

test('inspection reads are byte-for-byte non-mutating', (t) => {
  const root = repository(t);
  openDeliverySessionStore(root).create(storedSession('session.read-only'));
  const directory = path.join(root, '.ai-governance/state/delivery-sessions/session.read-only');
  const sessionFile = path.join(directory, 'session.json');
  const eventsFile = path.join(directory, 'events.jsonl');
  const before = { session: fs.readFileSync(sessionFile), events: fs.readFileSync(eventsFile) };

  readDeliveryInspection(root, 'session.read-only');
  listDeliveryInspections(root);

  assert.deepEqual(fs.readFileSync(sessionFile), before.session);
  assert.deepEqual(fs.readFileSync(eventsFile), before.events);
});

test('inspection fails closed for invalid ids, corrupt sessions, and invalid limits', (t) => {
  const root = repository(t);
  openDeliverySessionStore(root).create(storedSession('session.corrupt'));
  assert.throws(() => readDeliveryInspection(root, '../escape'), /session id/i);
  assert.throws(() => listDeliveryInspections(root, { limit: 0 }), /limit/i);
  const sessionFile = path.join(root, '.ai-governance/state/delivery-sessions/session.corrupt/session.json');
  fs.writeFileSync(sessionFile, '{not-json');
  assert.throws(() => listDeliveryInspections(root), /unreadable delivery session/i);
});

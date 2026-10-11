import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { canonicalContractDigest, createDeliverySession } from '../src/modules/delivery-core/index.mjs';
import { architectureFixture, authorityFixture, budgetsFixture, repositoryFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

// The Core session document is a published contract with a version, so a future change has a baseline
// to migrate from and a reader that fails closed instead of guessing. This test is that publication.
const CURRENT_SCHEMA_VERSION = 1;

function repository() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-core-schema-'));
}

function session() {
  const requirement = requirementFixture();
  return createDeliverySession({
    id: 'session.schema-compatibility',
    requestText: 'Publish the Core session schema contract',
    requirement,
    architecture: architectureFixture(canonicalContractDigest('requirement', requirement)),
    authority: authorityFixture(),
    budgets: budgetsFixture(),
    repositorySnapshot: repositoryFixture(),
    clock: () => '2026-10-05T00:00:00.000Z',
  });
}

function writeRaw(root, id, body) {
  const directory = path.join(root, '.ai-governance/state/delivery-sessions', id);
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'session.json'), typeof body === 'string' ? body : JSON.stringify(body, null, 2));
}

test('the current schema version round-trips through the durable store', () => {
  const root = repository();
  try {
    const store = openDeliverySessionStore(root);
    const created = store.create(session());
    assert.equal(created.schemaVersion, CURRENT_SCHEMA_VERSION);
    const read = store.read(created.id);
    assert.equal(read.schemaVersion, CURRENT_SCHEMA_VERSION);
    assert.equal(read.id, created.id);
    assert.equal(canonicalContractDigest('session', read), canonicalContractDigest('session', created));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('an unsupported schema version is refused instead of reinterpreted', () => {
  for (const schemaVersion of [0, 2, CURRENT_SCHEMA_VERSION + 1]) {
    const root = repository();
    try {
      const store = openDeliverySessionStore(root);
      writeRaw(root, 'session.unsupported', { ...session(), schemaVersion });
      assert.throws(() => store.read('session.unsupported'), /Unreadable delivery session/, `version ${schemaVersion} must be refused`);
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  }
});

test('a structurally broken session document is refused with the same clear error', () => {
  const root = repository();
  try {
    const store = openDeliverySessionStore(root);
    writeRaw(root, 'session.broken', '{ not json');
    assert.throws(() => store.read('session.broken'), /Unreadable delivery session/);
    writeRaw(root, 'session.broken', { schemaVersion: CURRENT_SCHEMA_VERSION, id: '' });
    assert.throws(() => store.read('session.broken'), /Unreadable delivery session/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

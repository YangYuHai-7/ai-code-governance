import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openCandidateStore, recordCandidateObservation } from '../src/modules/capabilities/index.mjs';

function temporaryRoot() { return fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-candidate-store-')); }

test('a missing candidate file reads as empty and a write round-trips', () => {
  const root = temporaryRoot();
  try {
    const store = openCandidateStore(root);
    assert.equal(store.path, path.join(root, '.ai-governance/state/candidate-rules.json'));
    assert.deepEqual([...store.read()], []);
    store.write([{ id: 'candidate.one', digest: 'a'.repeat(64) }]);
    assert.equal(openCandidateStore(root).read().length, 1);
    assert.equal(fs.existsSync(`${store.path}.tmp`), false);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('observations persist across store reloads and still deduplicate', () => {
  const root = temporaryRoot();
  try {
    const store = openCandidateStore(root);
    const first = recordCandidateObservation({ store, projectId: 'project-alpha', observation: { rule: 'prefer-relative-imports' } });
    const second = recordCandidateObservation({ store, projectId: 'project-alpha', observation: { rule: 'prefer-relative-imports', detail: 'seen again' } });
    assert.equal(first.status, 'recorded');
    assert.equal(second.status, 'duplicate');
    const reloaded = openCandidateStore(root);
    assert.equal(reloaded.read().length, 1);
    assert.equal(recordCandidateObservation({ store: reloaded, projectId: 'project-alpha', observation: { rule: 'prefer-relative-imports' } }).status, 'duplicate');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('a corrupted candidate file fails closed instead of resetting global governance', () => {
  const root = temporaryRoot();
  try {
    const store = openCandidateStore(root);
    fs.mkdirSync(path.dirname(store.path), { recursive: true });
    fs.writeFileSync(store.path, '{ not json');
    assert.throws(() => store.read(), /refusing to reset/i);
    assert.equal(fs.readFileSync(store.path, 'utf8'), '{ not json');
    fs.writeFileSync(store.path, '{"candidates":[]}');
    assert.throws(() => store.read(), /array/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('the store validates its root and rejects non-array writes', () => {
  assert.throws(() => openCandidateStore(''), /root/i);
  const root = temporaryRoot();
  try {
    const store = openCandidateStore(root);
    assert.throws(() => store.write('nope'), /array/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

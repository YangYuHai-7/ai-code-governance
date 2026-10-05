import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { beginWorkspaceTransaction } from '../src/adapters/filesystem/index.mjs';
import { normalizeDeliveryAuthority } from '../src/modules/delivery-core/index.mjs';
import { sha256 } from '../src/shared/index.mjs';

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-workspace-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/feature.mjs'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(root, 'notes.txt'), 'owner notes\n');
  return root;
}

function snapshot(root, overrides = {}) {
  const content = fs.readFileSync(path.join(root, 'src/feature.mjs'));
  return { sessionDigest: 'a'.repeat(64), files: [{ path: 'src/feature.mjs', kind: 'file', digest: sha256(content), bytes: content.length }], ...overrides };
}

function authority(overrides = {}) {
  return normalizeDeliveryAuthority({ allowedPaths: ['src/feature.mjs', 'src/new.mjs'], allowedCommands: [], maxChangedFiles: 2, maxChangedBytes: 4096, ...overrides });
}

test('transaction applies an approved proposal and preserves unrelated pre-existing changes', (context) => {
  const root = fixture(context), transaction = beginWorkspaceTransaction(root, { sessionId: 'session.tx', authority: authority(), repositorySnapshot: snapshot(root) });
  transaction.run({ writes: [{ path: 'src/feature.mjs', content: 'export const value = 2;\n' }, { path: 'src/new.mjs', content: 'export const added = true;\n' }] });
  const inspection = transaction.inspect();
  assert.deepEqual(inspection.changedPaths, ['src/feature.mjs', 'src/new.mjs']);
  assert.equal(inspection.allowed, true);
  assert.equal(transaction.commit('a'.repeat(64)).status, 'committed');
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'owner notes\n');
});

test('transaction rejects stale approved preimages and symlink ancestors', (context) => {
  const root = fixture(context), stale = snapshot(root);
  fs.writeFileSync(path.join(root, 'src/feature.mjs'), 'owner changed\n');
  assert.throws(() => beginWorkspaceTransaction(root, { sessionId: 'session.stale', authority: authority(), repositorySnapshot: stale }), /overlapping dirty scope/i);
  const linked = fixture(context), outside = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-workspace-outside-'));
  context.after(() => fs.rmSync(outside, { recursive: true, force: true }));
  fs.symlinkSync(outside, path.join(linked, 'src/link'));
  const linkedAuthority = normalizeDeliveryAuthority({ allowedPaths: ['src/link/file.mjs'], allowedCommands: [], maxChangedFiles: 1, maxChangedBytes: 100 });
  assert.throws(() => beginWorkspaceTransaction(linked, { sessionId: 'session.link', authority: linkedAuthority, repositorySnapshot: { sessionDigest: 'a'.repeat(64), files: [] } }), /symbolic link/i);
});

test('outside-scope writes and crashes roll back only transaction mutations', (context) => {
  const root = fixture(context), transaction = beginWorkspaceTransaction(root, { sessionId: 'session.escape', authority: authority(), repositorySnapshot: snapshot(root) });
  assert.throws(() => transaction.run(() => {
    fs.writeFileSync(path.join(root, 'src/feature.mjs'), 'partial\n');
    fs.writeFileSync(path.join(root, 'escape.txt'), 'escape\n');
  }), /outside approved paths/i);
  assert.equal(fs.readFileSync(path.join(root, 'src/feature.mjs'), 'utf8'), 'export const value = 1;\n');
  assert.equal(fs.existsSync(path.join(root, 'escape.txt')), false);
  assert.equal(fs.readFileSync(path.join(root, 'notes.txt'), 'utf8'), 'owner notes\n');

  const crashing = beginWorkspaceTransaction(root, { sessionId: 'session.crash', authority: authority(), repositorySnapshot: snapshot(root) });
  assert.throws(() => crashing.run(() => { fs.writeFileSync(path.join(root, 'src/feature.mjs'), 'partial\n'); throw new Error('agent crashed'); }), /agent crashed/);
  assert.equal(fs.readFileSync(path.join(root, 'src/feature.mjs'), 'utf8'), 'export const value = 1;\n');
});

test('changed-file and byte budgets fail closed and restore preimages', (context) => {
  const root = fixture(context), transaction = beginWorkspaceTransaction(root, { sessionId: 'session.budget', authority: authority({ maxChangedFiles: 1, maxChangedBytes: 8 }), repositorySnapshot: snapshot(root) });
  assert.throws(() => transaction.run({ writes: [{ path: 'src/feature.mjs', content: 'long changed content\n' }, { path: 'src/new.mjs', content: 'new\n' }] }), /changed-file|changed-byte/i);
  assert.equal(fs.readFileSync(path.join(root, 'src/feature.mjs'), 'utf8'), 'export const value = 1;\n');
  assert.equal(fs.existsSync(path.join(root, 'src/new.mjs')), false);
});

test('commit detects concurrent modification and rollback never overwrites it', (context) => {
  const root = fixture(context), transaction = beginWorkspaceTransaction(root, { sessionId: 'session.concurrent', authority: authority(), repositorySnapshot: snapshot(root) });
  transaction.run({ writes: [{ path: 'src/feature.mjs', content: 'transaction result\n' }] });
  fs.writeFileSync(path.join(root, 'src/feature.mjs'), 'concurrent owner result\n');
  assert.throws(() => transaction.commit('a'.repeat(64)), /concurrent modification/i);
  assert.throws(() => transaction.rollback('conflict'), /concurrent modification/i);
  assert.equal(fs.readFileSync(path.join(root, 'src/feature.mjs'), 'utf8'), 'concurrent owner result\n');
  assert.throws(() => transaction.commit('b'.repeat(64)), /session digest/i);
});

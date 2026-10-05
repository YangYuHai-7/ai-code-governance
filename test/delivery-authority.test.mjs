import assert from 'node:assert/strict';
import test from 'node:test';
import { authorizeDeliveryAction, normalizeDeliveryAuthority } from '../src/modules/delivery-core/index.mjs';

test('delivery authority is immutable, path-safe, and deny-by-default for effects', () => {
  const authority = normalizeDeliveryAuthority({ allowedPaths: ['src/feature/', 'test/feature.test.mjs'], allowedCommands: [{ argv: ['npm', 'test'], cwd: '.', sideEffects: [] }], maxChangedFiles: 4, maxChangedBytes: 4096 });
  assert.ok(Object.isFrozen(authority));
  assert.ok(Object.isFrozen(authority.allowedPaths));
  assert.equal(authority.allowNetwork, false);
  assert.equal(authority.allowExternalEffects, false);
  assert.deepEqual(authorizeDeliveryAction(authority, { type: 'write', path: 'src/feature/index.mjs' }), { allowed: true, reasons: [] });
  assert.equal(authorizeDeliveryAction(authority, { type: 'write', path: 'src/other.mjs' }).allowed, false);
  assert.equal(authorizeDeliveryAction(authority, { type: 'network', target: 'example.com' }).allowed, false);
  assert.equal(authorizeDeliveryAction(authority, { type: 'external-effect', effect: 'publish' }).allowed, false);
  assert.equal(authorizeDeliveryAction(authority, { type: 'command', argv: ['npm', 'test'], cwd: '.', sideEffects: [] }).allowed, true);
  assert.equal(authorizeDeliveryAction(authority, { type: 'command', argv: ['npm', 'publish'], cwd: '.', sideEffects: ['publish'] }).allowed, false);
});

test('authority rejects traversal, shell composition, duplicate paths, and invalid budgets', () => {
  assert.throws(() => normalizeDeliveryAuthority({ allowedPaths: ['../escape'], allowedCommands: [], maxChangedFiles: 1, maxChangedBytes: 1 }), /allowedPaths/);
  assert.throws(() => normalizeDeliveryAuthority({ allowedPaths: ['src/a', 'src/a'], allowedCommands: [], maxChangedFiles: 1, maxChangedBytes: 1 }), /duplicate/i);
  assert.throws(() => normalizeDeliveryAuthority({ allowedPaths: ['src/a'], allowedCommands: [{ argv: ['npm test'], cwd: '.', sideEffects: [] }], maxChangedFiles: 1, maxChangedBytes: 1 }), /shell-free/i);
  assert.throws(() => normalizeDeliveryAuthority({ allowedPaths: ['src/a'], allowedCommands: [], maxChangedFiles: 0, maxChangedBytes: 1 }), /maxChangedFiles/);
});

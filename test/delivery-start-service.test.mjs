import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { prepareDeliverySessionStart, startDeliverySession } from '../src/modules/delivery-start/index.mjs';

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-delivery-start-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = true;\n');
  return root;
}

test('Studio preparation is read-only, strict, and binds defaults into a stable digest', (t) => {
  const root = repository(t);
  const before = fs.readdirSync(root);
  const first = prepareDeliverySessionStart(root, { requestText: '  Build a governed task  ' });
  const again = prepareDeliverySessionStart(root, { requestText: 'Build a governed task', profile: 'advisory' });
  assert.equal(first.requestText, 'Build a governed task');
  assert.equal(first.previewDigest, again.previewDigest);
  assert.equal(first.profile, 'advisory');
  assert.match(first.compilationInputDigest, /^[a-f0-9]{64}$/);
  assert.deepEqual(first.authority.allowedPaths, []);
  assert.deepEqual(first.authority.allowedCommands, []);
  assert.equal(first.authority.allowNetwork, false);
  assert.equal(first.authority.allowExternalEffects, false);
  assert.equal(first.agentExecution, 'unavailable');
  assert.equal(first.workspaceEffects, 'denied');
  assert.deepEqual(fs.readdirSync(root), before);

  for (const input of [null, {}, { requestText: null }, { requestText: '' }, { requestText: 'x', profile: null }, { requestText: 'x', extra: true }, { requestText: 'x', profile: 'unknown' }, { requestText: '😀'.repeat(2049) }]) {
    assert.throws(() => prepareDeliverySessionStart(root, input), /invalid|requires|unsupported|exceeds/i);
  }
});

test('CLI and Studio text starts share canonical defaults without activating an Agent', (t) => {
  const root = repository(t);
  const preview = prepareDeliverySessionStart(root, { requestText: 'Build a governed task' });
  const cli = startDeliverySession(root, { source: 'cli', sessionId: 'session.cli', requestText: 'Build a governed task' });
  const studio = startDeliverySession(root, { source: 'studio', requestText: 'Build a governed task', previewDigest: preview.previewDigest, idempotencyKey: '0123456789abcdef' });
  assert.equal(cli.session.state, 'requirements-pending');
  assert.equal(studio.session.state, 'requirements-pending');
  assert.equal(cli.session.requestDigest, studio.session.requestDigest);
  assert.equal(cli.session.authorityDigest, studio.session.authorityDigest);
  assert.equal(cli.session.repositoryDigest, studio.session.repositoryDigest);
  assert.equal(studio.session.runtime.compilation.inputDigest, preview.compilationInputDigest);
  assert.deepEqual(cli.session.budgets, studio.session.budgets);
  assert.equal(studio.session.activeAgentId, null);
  assert.equal(studio.replayed, false);
  assert.equal(openDeliverySessionStore(root).list().length, 2);
  assert.equal(startDeliverySession(root, { source: 'studio', requestText: 'Build a governed task', previewDigest: preview.previewDigest, idempotencyKey: '0123456789abcdef' }).replayed, true);
  assert.equal(openDeliverySessionStore(root).list().length, 2);
  assert.throws(() => startDeliverySession(root, { source: 'studio', requestText: 'Different task', previewDigest: preview.previewDigest, idempotencyKey: '0123456789abcdef' }), /conflict/i);
});

test('Studio rejects unpreviewed changes, extra capabilities, and invalid keys without creating a session', (t) => {
  const root = repository(t);
  const preview = prepareDeliverySessionStart(root, { requestText: 'Task one' });
  const input = { source: 'studio', requestText: 'Task one', previewDigest: preview.previewDigest, idempotencyKey: '0123456789abcdef' };
  for (const extra of [{ agent: 'codex' }, { sessionId: 'chosen' }, { requirementPath: 'requirement.json' }, { profile: null }, { idempotencyKey: 'short' }, { unknown: true }]) {
    assert.throws(() => startDeliverySession(root, { ...input, ...extra }), /invalid|unsupported/i);
  }
  assert.throws(() => startDeliverySession(root, { ...input, requestText: 'Task two' }), /stale/i);
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = false;\n');
  assert.throws(() => startDeliverySession(root, input), /stale/i);
  assert.deepEqual(openDeliverySessionStore(root).list(), []);
});

test('Studio replay rejects a damaged published input binding', (t) => {
  const root = repository(t);
  const requestText = 'Task one';
  const previewDigest = prepareDeliverySessionStart(root, { requestText }).previewDigest;
  const input = { source: 'studio', requestText, previewDigest, idempotencyKey: '0123456789abcdef' };
  const first = startDeliverySession(root, input);
  const file = path.join(root, '.ai-governance/state/delivery-sessions', first.session.id, 'session.json');
  const changed = { ...JSON.parse(fs.readFileSync(file, 'utf8')), requestText: 'Tampered task' };
  fs.writeFileSync(file, `${JSON.stringify(changed)}\n`);
  assert.throws(() => startDeliverySession(root, input), /unreadable|invalid|binding/i);
});

test('lost response after durable publication is recovered by the same key', (t) => {
  const root = repository(t);
  const requestText = 'Task one';
  const previewDigest = prepareDeliverySessionStart(root, { requestText }).previewDigest;
  const input = { source: 'studio', requestText, previewDigest, idempotencyKey: '0123456789abcdef' };
  assert.throws(() => startDeliverySession(root, input, { storeFactory: (directory) => openDeliverySessionStore(directory, { onCreateStep(step) {
    if (step === 'after-publish') throw new Error('injected response loss');
  } }) }), /response loss/i);
  assert.equal(openDeliverySessionStore(root).list().length, 1);
  const replay = startDeliverySession(root, input);
  assert.equal(replay.replayed, true);
  assert.equal(openDeliverySessionStore(root).list().length, 1);
});

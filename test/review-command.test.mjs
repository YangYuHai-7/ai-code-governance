import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { COMMAND_HANDLERS } from '../src/cli/command-registry.mjs';
import { reviewCommand } from '../src/cli/commands/review.mjs';
import { canonicalContractDigest, createDeliverySession } from '../src/modules/delivery-core/index.mjs';
import { architectureFixture, authorityFixture, budgetsFixture, repositoryFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

const SATISFIED = { risk: 'standard', sessions: [{ role: 'implementer', identity: 'agent-1', sessionId: 'session.a' }, { role: 'reviewer', identity: 'agent-2', sessionId: 'session.b' }], findings: [] };
const REJECTED = { risk: 'high', sessions: [{ role: 'implementer', identity: 'agent-1', sessionId: 'session.a' }, { role: 'reviewer', identity: 'agent-2', sessionId: 'session.b' }] };

function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-review-command-'));
  const requirement = requirementFixture();
  const session = createDeliverySession({
    id: 'session.review-command', requestText: 'Record review evidence', requirement,
    architecture: architectureFixture(canonicalContractDigest('requirement', requirement)),
    authority: authorityFixture(), budgets: budgetsFixture(), repositorySnapshot: repositoryFixture(),
    clock: () => '2026-10-05T00:00:00.000Z',
  });
  openDeliverySessionStore(root).create(session);
  return { root, session };
}

test('the review evidence command is registered as an expert write surface', () => {
  assert.ok(COMMAND_HANDLERS.review, 'review command is registered');
  assert.deepEqual(COMMAND_HANDLERS.review.argumentKeys, ['target', 'action', 'options']);
});

test('the command records validated evidence into the persisted session', async () => {
  const { root, session } = repo();
  try {
    fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(SATISFIED));
    const persisted = await reviewCommand(root, 'evidence', { session: session.id, evidence: 'evidence.json', json: true });
    assert.equal(persisted.runtime.reviewRisk, 'standard');
    assert.equal(persisted.runtime.reviewSessions.length, 2);
    assert.equal(openDeliverySessionStore(root).read(session.id).runtime.reviewSessions.length, 2);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('rejected evidence throws and leaves the stored session untouched', async () => {
  const { root, session } = repo();
  try {
    fs.writeFileSync(path.join(root, 'evidence.json'), JSON.stringify(REJECTED));
    const before = openDeliverySessionStore(root).read(session.id);
    await assert.rejects(() => reviewCommand(root, 'evidence', { session: session.id, evidence: 'evidence.json' }), /review evidence rejected/i);
    assert.equal(canonicalContractDigest('session', openDeliverySessionStore(root).read(session.id)), canonicalContractDigest('session', before));
    await assert.rejects(() => reviewCommand(root, 'evidence', { evidence: 'evidence.json' }), /--session/);
    await assert.rejects(() => reviewCommand(root, 'approve', {}), /action/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

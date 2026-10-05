import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs } from '../src/cli/args.mjs';
import { deliverySessionCommand } from '../src/cli/commands/delivery-session.mjs';
import { requirementFixture } from './support/delivery-core-fixtures.mjs';

function repository() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-delivery-command-'));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = true;\n');
  return root;
}

test('delivery session arguments expose the milestone-one lifecycle without adding a top-level command', () => {
  assert.deepEqual(parseArgs(['delivery', 'session', 'start', '.', '--session', 'session.cli', '--agent', 'codex', '--profile', 'production', '--text', 'Build the fixture']), {
    command: 'delivery', action: 'session', subAction: 'start', target: '.',
    options: { session: 'session.cli', agent: 'codex', profile: 'production', text: 'Build the fixture' },
  });
  assert.equal(parseArgs(['delivery', 'session', 'resume', '--session', 'session.cli']).subAction, 'resume');
});

test('start persists a canonical requirement-bound session and status is read-only', async (t) => {
  const root = repository(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'requirement.json'), `${JSON.stringify(requirementFixture(), null, 2)}\n`);
  const started = await deliverySessionCommand(root, 'start', { session: 'session.cli', requirement: 'requirement.json', profile: 'production', agent: 'codex' });
  assert.equal(started.session.id, 'session.cli');
  assert.equal(started.session.state, 'requirements-approved');
  assert.equal(started.session.runtime.profile, 'production');
  assert.equal(started.session.runtime.requestSource.path, 'requirement.json');
  assert.equal(started.session.activeAgentId, null);
  assert.match(started.notice, /unverified/i);

  const sessionPath = path.join(root, started.sessionPath);
  const before = fs.readFileSync(sessionPath, 'utf8');
  const status = await deliverySessionCommand(root, 'status', { session: 'session.cli' });
  assert.equal(status.session.requirementDigest, started.session.requirementDigest);
  assert.equal(fs.readFileSync(sessionPath, 'utf8'), before);
});

test('text start stores bounded compilation input and an unavailable step never claims completion', async (t) => {
  const root = repository(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const started = await deliverySessionCommand(root, 'start', { session: 'session.text', text: 'Add one governed action', profile: 'advisory' });
  assert.equal(started.session.state, 'requirements-pending');
  assert.equal(started.session.runtime.compilation.schemaPath, 'assets/contracts/requirement-ir-v2-schema.json');
  const stepped = await deliverySessionCommand(root, 'step', { session: 'session.text' });
  assert.equal(stepped.session.state, 'failed');
  assert.equal(stepped.session.lastFailure.category, 'agent-unavailable');
  assert.notEqual(stepped.session.state, 'completed');
});

test('resume checks current repository binding and cancel is durable', async (t) => {
  const root = repository(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await deliverySessionCommand(root, 'start', { session: 'session.resume', text: 'Add one governed action' });
  const resumed = await deliverySessionCommand(root, 'resume', { session: 'session.resume' });
  assert.equal(resumed.session.state, 'requirements-pending');
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const changed = true;\n');
  await assert.rejects(() => deliverySessionCommand(root, 'resume', { session: 'session.resume' }), /stale delivery session repositoryDigest/i);

  const cancelled = await deliverySessionCommand(root, 'cancel', { session: 'session.resume' });
  assert.equal(cancelled.session.state, 'cancelled');
  assert.equal(cancelled.adapterCancellation, 'unavailable');
});

test('requirement input is confined to a repository-relative regular JSON file', async (t) => {
  const root = repository(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  await assert.rejects(() => deliverySessionCommand(root, 'start', { session: 'session.unsafe', requirement: '../outside.json' }), /safe repository-relative/i);
});

test('session input rejects ambiguous intent and silently unsupported Agent switching', async (t) => {
  const root = repository(); t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'requirement.json'), `${JSON.stringify(requirementFixture(), null, 2)}\n`);
  await assert.rejects(() => deliverySessionCommand(root, 'start', { session: 'session.ambiguous', requirement: 'requirement.json', text: 'Different intent' }), /exactly one/i);
  await assert.rejects(() => deliverySessionCommand(root, 'start', { session: 'session.bad-agent', text: 'Build', agent: '../bad' }), /Agent id/i);
  await deliverySessionCommand(root, 'start', { session: 'session.switch', text: 'Build' });
  await assert.rejects(() => deliverySessionCommand(root, 'resume', { session: 'session.switch', agent: 'codex' }), /verified.*adapter/i);
});

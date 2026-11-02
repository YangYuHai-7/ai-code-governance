import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import { deliveryInspectionCommand } from '../src/cli/commands/delivery-inspection.mjs';
import { deliveryCommand } from '../src/cli/commands/delivery.mjs';
import { HELP, HELP_ZH } from '../src/cli/help.mjs';
import { createDeliverySession } from '../src/modules/delivery-core/index.mjs';
import { readDeliveryInspection } from '../src/modules/delivery-inspection/read-service.mjs';
import { authorityFixture, budgetsFixture, repositoryFixture } from './support/delivery-core-fixtures.mjs';

function repository(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-inspection-cli-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const session = createDeliverySession({
    id: 'session.cli-inspect', requestText: 'Inspect from both clients',
    authority: authorityFixture(), budgets: budgetsFixture(), repositorySnapshot: repositoryFixture(),
    clock: () => '2026-10-11T01:00:00.000Z',
  });
  openDeliverySessionStore(root).create(session);
  return root;
}

function capture(callback) {
  const lines = [];
  const original = console.log;
  console.log = (value) => lines.push(String(value));
  try { return { result: callback(), lines }; }
  finally { console.log = original; }
}

test('delivery inspection CLI exposes one read-only command handler', async () => {
  const command = await import('../src/cli/commands/delivery-inspection.mjs').catch(() => ({}));
  assert.equal(typeof command.deliveryInspectionCommand, 'function');
});

test('delivery inspect returns the same detail projection as the read service', (t) => {
  const root = repository(t);
  const expected = readDeliveryInspection(root, 'session.cli-inspect');
  const { result, lines } = capture(() => deliveryInspectionCommand(root, { session: 'session.cli-inspect', json: true }));
  assert.deepEqual(result, expected);
  assert.deepEqual(JSON.parse(lines[0]), expected);
});

test('delivery inspect lists summaries and its text output retains state and digest', async (t) => {
  const root = repository(t);
  const listed = capture(() => deliveryInspectionCommand(root, { json: true }));
  assert.equal(listed.result.count, 1);
  assert.equal(listed.result.sessions[0].expert, undefined);

  const detail = capture(() => deliveryInspectionCommand(root, { session: 'session.cli-inspect' }));
  assert.match(detail.lines[0], /session\.cli-inspect/);
  assert.match(detail.lines[0], /requirements-pending/);
  assert.match(detail.lines[0], new RegExp(detail.result.semanticDigest));

  const routed = capture(() => deliveryCommand(root, 'inspect', { session: 'session.cli-inspect', json: true }));
  assert.deepEqual(await routed.result, detail.result);
});

test('English and Chinese help publish the read-only inspection command', () => {
  assert.match(HELP, /aicg delivery inspect \[path\] \[--session <id>\] \[--json\]/);
  assert.match(HELP_ZH, /aicg delivery inspect \[路径\] \[--session <标识>\] \[--json\]/);
});

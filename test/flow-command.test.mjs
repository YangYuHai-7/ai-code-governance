import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs } from '../src/cli/args.mjs';
import { flowCommand } from '../src/cli/commands/flow.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-flow-command-${name}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  return root;
}

function readLedger(root) {
  const relative = ['docs/ai/flow-state.json', '.ai-governance/state/flow-state.json'].find((candidate) => fs.existsSync(path.join(root, candidate)));
  return JSON.parse(fs.readFileSync(path.join(root, relative), 'utf8'));
}

test('flow requires an explicit start or status action', () => {
  assert.deepEqual(parseArgs(['flow', 'start', '.', '--text', 'Do work', '--json']), {
    command: 'flow', action: 'start', target: '.', options: { text: 'Do work', json: true },
  });
  assert.equal(parseArgs(['flow', 'status', 'project']).action, 'status');
  assert.throws(() => parseArgs(['flow']), /flow requires an action/);
  assert.throws(() => parseArgs(['flow', 'run', '.']), /flow requires an action/);
});

test('flow start records the routed level and required evidence without binding it', (context) => {
  const root = fixture(context, 'start');
  const started = flowCommand(root, 'start', { text: '实现合同包分解与导出功能', paths: 'src/modules/a.mjs,src/modules/b.mjs', json: true });
  assert.ok(['L0', 'L1', 'L1.5', 'L2', 'L3'].includes(started.route.level));
  assert.equal(started.phase, 'requirements');
  if (['L2', 'L3'].includes(started.route.level)) assert.deepEqual(started.requiredDecisions, ['requirements', 'plan', 'report']);
  const ledger = readLedger(root);
  assert.equal(ledger.route.level, started.route.level);
  assert.equal(ledger.requirement.path, null, 'start must not fabricate a requirement binding');
  assert.equal(ledger.plan.path, null, 'start must not fabricate a plan binding');
  assert.equal(ledger.report.path, null, 'start must not fabricate a report binding');
  const status = flowCommand(root, 'status', { json: true });
  assert.equal(status.route.text, '实现合同包分解与导出功能');
  assert.equal(status.plan.path, null);
});

test('flow start requires a task description', (context) => {
  const root = fixture(context, 'missing-text');
  assert.throws(() => flowCommand(root, 'start', { json: true }), /flow start requires --text/);
});

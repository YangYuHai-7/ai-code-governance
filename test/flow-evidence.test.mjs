import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { runCompletion } from '../src/commit-completion.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { satisfyFlow } from './helpers/flow-fixture.mjs';

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function governed(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-flow-evidence-${name}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  for (const args of [['init'], ['config', 'user.email', 'aicg@example.test'], ['config', 'user.name', 'AICG Test'], ['add', '--all'], ['-c', 'core.hooksPath=/dev/null', 'commit', '--allow-empty', '-m', 'flow baseline']]) {
    const result = git(root, args);
    assert.equal(result.status, 0, result.stderr);
  }
  return root;
}

test('L2 completion blocks when the flow ledger has no approved requirement and plan', (context) => {
  const root = governed(context, 'blocked');
  const result = runCompletion(root, { taskLevel: 'L2' });
  assert.equal(result.flow.required, true);
  assert.equal(result.flow.status, 'blocked');
  assert.ok(result.flow.gaps.some((gap) => /requirement/.test(gap)), result.flow.gaps.join('\n'));
  assert.equal(result.ok, false);
});

test('L2 completion accepts flow evidence whose requirement and plan digests match', (context) => {
  const root = governed(context, 'satisfied');
  satisfyFlow(root);
  const result = runCompletion(root, { taskLevel: 'L2' });
  assert.equal(result.flow.status, 'satisfied');
  assert.equal(result.flow.requirement.path, 'docs/workflow/requirement.md');
  assert.equal(result.flow.plan.path, 'docs/workflow/plan.md');
  assert.equal(result.flow.report.path, 'docs/workflow/report.md');
  assert.match(result.taskApproval.plan.planDigest, /^[a-f0-9]{64}$/);
});

test('a changed plan document invalidates the flow evidence', (context) => {
  const root = governed(context, 'tampered');
  satisfyFlow(root);
  fs.writeFileSync(path.join(root, 'docs/workflow/plan.md'), '# changed after approval\n');
  const result = runCompletion(root, { taskLevel: 'L2' });
  assert.equal(result.flow.status, 'blocked');
  assert.ok(result.flow.gaps.some((gap) => /does not match/.test(gap)), result.flow.gaps.join('\n'));
});

test('L1 completion does not require flow evidence', (context) => {
  const root = governed(context, 'l1');
  const result = runCompletion(root, { taskLevel: 'L1' });
  assert.equal(result.flow.required, false);
  assert.equal(result.flow.status, 'not-required');
});

test('L3 completion binds a consistent design decision instead of trusting the approval id alone', (context) => {
  const root = governed(context, 'l3-design');
  satisfyFlow(root);
  // `not-needed` is a recorded decision for a requirement without a frontend page, so it passes.
  assert.equal(runCompletion(root, { taskLevel: 'L3' }).flow.design.status, 'not-needed');
  const ledgerPath = ['.ai-governance/state/flow-state.json', 'docs/ai/flow-state.json']
    .map((relative) => path.join(root, relative)).find((absolute) => fs.existsSync(absolute));
  const ledger = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));

  // Negative probe: "chosen" with no recorded drafts is contradictory and must block.
  ledger.design = { status: 'chosen', proposals: [] };
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  const inconsistent = runCompletion(root, { taskLevel: 'L3' });
  assert.equal(inconsistent.flow.status, 'blocked');
  assert.ok(inconsistent.flow.gaps.some((gap) => /design/.test(gap)), inconsistent.flow.gaps.join('\n'));

  ledger.design = { status: 'chosen', proposals: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] };
  fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + '\n');
  assert.equal(runCompletion(root, { taskLevel: 'L3' }).flow.design.status, 'chosen');
});

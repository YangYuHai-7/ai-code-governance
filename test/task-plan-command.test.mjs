import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { planTask } from '../src/cli/commands/task-plan.mjs';

test('task planner scales a question and frontend source bug differently and retains confirmation gates', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-plan-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const question = planTask(root, { text: 'Explain the current status' });
  assert.equal(question.route.level, 'L0');
  assert.equal(question.process.implementationConsent, 'not-applicable');
  const bug = planTask(root, { text: 'Fix the frontend button bug', paths: ['apps/web/src/Button.tsx'] });
  assert.equal(bug.route.level, 'L2');
  assert.equal(bug.process.implementationConsent, 'required-before-business-code-change');
  assert.equal(bug.process.commitGate, 'report-only-by-default');
  assert.deepEqual(bug.roles.recommendedRoles, []);
  assert.deepEqual(bug.roles.missingRoleCapabilities.map((item) => item.category), ['frontend']);
  const crossStack = planTask(root, { text: 'Implement an order page and API',
    paths: ['apps/frontend-react/src/modules/orders/view.tsx', 'services/backend-node/src/modules/orders/interface/handler.ts'] });
  assert.equal(crossStack.route.level, 'L3');
  assert.deepEqual(crossStack.route.requiredApprovals, ['requirements', 'design', 'plan']);
  assert.equal(crossStack.route.verificationClass, 'integrated');
});

test('explicit Chinese and English read-only requests stay L0 without path evidence', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-plan-read-only-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));

  for (const text of [
    '仅评估，不要修改文件',
    'review only, do not change files',
    '仅评估现有开发规范，不要修改或新增文件',
    'review only the proposed changes; do not change or modify files',
  ]) {
    const result = planTask(root, { text });
    assert.equal(result.route.level, 'L0', text);
    assert.equal(result.process.implementationConsent, 'not-applicable', text);
    assert.ok(result.route.reasonCodes.includes('text-intent:read-only-explicit'), text);
    assert.equal(result.route.intentEvidence.classification, 'read-only', text);
    assert.equal(result.route.intentEvidence.positiveWriteSignals.length, 0, text);
    assert.ok(result.route.intentEvidence.negatedWriteSignals.length > 0, text);
  }
});

test('unnegated writes and conflicting read-only wording fail closed to a write route', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-plan-write-intent-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));

  const write = planTask(root, { text: '请修改这个文件' });
  assert.equal(write.route.level, 'L2');
  assert.equal(write.route.intentEvidence.classification, 'write');
  assert.ok(write.route.reasonCodes.includes('text-intent:write'));

  const conflicting = planTask(root, { text: '只评估现状，但也修复这个 bug' });
  assert.equal(conflicting.route.level, 'L2');
  assert.equal(conflicting.route.intentEvidence.classification, 'ambiguous-write');
  assert.ok(conflicting.route.reasonCodes.includes('text-intent:ambiguous-write-conservative'));

  const explicitWrite = planTask(root, { text: 'do not only modify the file; add the missing test' });
  assert.equal(explicitWrite.route.level, 'L2');
  assert.ok(explicitWrite.route.intentEvidence.positiveWriteSignals.includes('modify'));
  assert.ok(explicitWrite.route.intentEvidence.positiveWriteSignals.includes('add'));
});

test('changed path evidence overrides read-only text while retaining the conflict evidence', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-plan-path-priority-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));

  const result = planTask(root, {
    text: 'review only, do not change files',
    paths: ['src/widget.mjs'],
  });
  assert.equal(result.route.level, 'L2');
  assert.equal(result.process.implementationConsent, 'required-before-business-code-change');
  assert.ok(result.route.reasonCodes.includes('path-evidence:changed-paths-priority'));
  assert.equal(result.route.intentEvidence.classification, 'read-only');
  assert.equal(result.route.intentEvidence.effectiveIntent, 'write');
});

test('the bugfix fast track routes L1.5 and escalates without reproduction or a bounded fix', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-plan-bugfix-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const fast = planTask(root, { text: 'Fix the session crash', paths: ['src/session.mjs'], taskKind: 'bugfix', bugfix: { reproducible: true, boundedFix: true, publicContract: false, behaviorBeyondDefect: false, dataMigration: false } });
  assert.equal(fast.route.level, 'L1.5');
  assert.deepEqual(fast.route.requiredApprovals, []);
  assert.deepEqual(fast.route.requiredArtifacts, ['reproduction-case', 'fix', 'verification', 'report']);
  assert.equal(fast.process.implementationConsent, 'required-before-business-code-change');
  const notReproduced = planTask(root, { text: 'Fix the session crash', paths: ['src/session.mjs'], taskKind: 'bugfix', bugfix: { reproducible: false, boundedFix: true } });
  assert.equal(notReproduced.route.level, 'L2');
  assert.ok(notReproduced.route.reasonCodes.includes('bugfix-escalation:defect-not-reproduced'));
  const unbounded = planTask(root, { text: 'Fix the session crash', paths: ['src/session.mjs'], taskKind: 'bugfix', bugfix: { reproducible: true, boundedFix: true, behaviorBeyondDefect: true } });
  assert.equal(unbounded.route.level, 'L2');
  const crossModule = planTask(root, { text: 'Fix the crash', paths: ['src/modules/a/x.mjs', 'src/modules/b/y.mjs'], taskKind: 'bugfix', bugfix: { reproducible: true, boundedFix: true } });
  assert.equal(crossModule.route.level, 'L2');
});

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

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { checkProject } from '../src/checker.mjs';
import { buildProjectFlowArtifacts, PROJECT_FLOW_PHASES } from '../src/modules/governance/project-flow.mjs';
import { buildWorkflowArtifacts, WORKFLOW_DOC } from '../src/modules/governance/workflow.mjs';
import { buildTaskApprovalPlan } from '../src/modules/governance/task-approval.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-' + name + '-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('the delivery process ships as one workflow document plus a runtime ledger', (context) => {
  const root = fixture(context, 'project-flow-flag');
  const scan = scanProject(root);
  const base = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  const paths = buildArtifacts(base, scan).map((entry) => entry.path);
  assert.ok(paths.includes(WORKFLOW_DOC));
  assert.ok(paths.includes('.ai-governance/state/flow-state.json'));
  // The process is never split back into one Skill per phase.
  assert.equal(paths.some((entry) => entry.includes('skills/project-flow')), false);
  for (const phase of PROJECT_FLOW_PHASES) {
    assert.equal(paths.includes('docs/ai/skills/' + phase + '/SKILL.md'), false, phase);
  }

  // An owner who declines the flow keeps their previous artifact set and recorded approval.
  const declined = { ...base, features: { ...base.features, projectFlow: false } };
  const off = buildArtifacts(declined, scan).map((entry) => entry.path);
  assert.equal(off.some((entry) => entry.includes('flow-state')), false);

  // Minimal stays a bootstrap-only kernel and never carries the flow.
  const minimal = { ...base, governanceDepth: 'minimal' };
  const minimalPaths = buildArtifacts(minimal, scan).map((entry) => entry.path);
  assert.equal(minimalPaths.includes(WORKFLOW_DOC), false);
  assert.equal(minimalPaths.some((entry) => entry.includes('flow-state')), false);

  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(base, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  const ledger = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/state/flow-state.json'), 'utf8'));
  assert.equal(ledger.phase, 'requirements');
  assert.deepEqual(ledger.phases, PROJECT_FLOW_PHASES);
  assert.deepEqual(ledger.openFindings, []);
  assert.deepEqual(ledger.blockedOnOwner, []);
  assert.equal(ledger.requirement.path, null);
});

test('the workflow document is the single process surface and covers every stage', () => {
  for (const artifactLanguage of ['zh-CN', 'en']) {
    const { artifacts } = buildWorkflowArtifacts({ artifactLanguage });
    assert.equal(artifacts.length, 1);
    const [workflow] = artifacts;
    assert.equal(workflow.path, WORKFLOW_DOC);
    assert.equal(workflow.kind, 'project-workflow');
    assert.equal(workflow.ownership, 'full');
    for (const stage of ['1.', '2.', '3.', '4.', '5.', '6.']) assert.ok(workflow.content.includes(stage), artifactLanguage + ' ' + stage);
    assert.match(workflow.content, /角色模型|Role model/);
    assert.match(workflow.content, /planHash/);
    assert.doesNotMatch(workflow.content, /SKILL\.md/);
  }
});

test('the flow ledger is a seed and a later sync keeps runtime progress', (context) => {
  const root = fixture(context, 'project-flow-seed');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const ledgerPath = path.join(root, '.ai-governance/state/flow-state.json');
  const edited = JSON.parse(fs.readFileSync(ledgerPath, 'utf8'));
  edited.phase = 'delivery';
  fs.writeFileSync(ledgerPath, JSON.stringify(edited));
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  assert.equal(JSON.parse(fs.readFileSync(ledgerPath, 'utf8')).phase, 'delivery');
});

test('a missing workflow document is reported and fails the check', (context) => {
  const root = fixture(context, 'workflow-missing');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  fs.unlinkSync(path.join(root, 'docs/WORKFLOW.md'));
  const failed = checkProject(scanProject(root));
  assert.equal(failed.ok, false);
  assert.ok(failed.errors.some((error) => error.includes('docs/WORKFLOW.md')));
});

test('the development plan digest binds into the task approval hash', () => {
  const base = { taskLevel: 'L2', reviewMode: 'single', plannedPaths: ['src/a.mjs'], changeDigest: 'a'.repeat(64) };
  const without = buildTaskApprovalPlan(base);
  const withDigest = buildTaskApprovalPlan({ ...base, planDigest: 'b'.repeat(64) });
  assert.equal(Object.hasOwn(without, 'planDigest'), false);
  assert.equal(withDigest.planDigest, 'b'.repeat(64));
  assert.notEqual(withDigest.planHash, without.planHash);
  assert.throws(() => buildTaskApprovalPlan({ ...base, planDigest: 'not-a-hash' }), /plan digest/i);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { checkProject } from '../src/checker.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { sha256 } from '../src/shared/index.mjs';

function fixture(context) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'workflow-preservation-')));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'sample-project' }));
  const config = { ...defaultConfig(scanProject(root)), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  const workflow = path.join(root, 'docs/WORKFLOW.md');
  const original = fs.readFileSync(workflow, 'utf8');
  const content = original + '\n## Project convention\n\nKeep the selected desktop design.\n';
  fs.writeFileSync(workflow, content);
  const approvalPath = 'workflow-approval.json';
  const approve = (bytes) => {
    fs.writeFileSync(workflow, bytes);
    const receipt = JSON.stringify({ kind: 'workflow-content-preservation', status: 'APPROVED',
      path: 'docs/WORKFLOW.md', sha256: sha256(bytes), source: 'owner-message' });
    fs.writeFileSync(path.join(root, approvalPath), receipt);
    config.workflowPreservation = { contentSha256: sha256(bytes), approvalPath, approvalSha256: sha256(receipt) };
  };
  approve(content);
  return { root, config, workflow, original, content, approvalPath, approve };
}

test('approved additive workflow becomes an integrity-checked owner seed without overwriting bytes', (context) => {
  const { root, config, workflow, content } = fixture(context);
  const artifacts = buildArtifacts(config, scanProject(root));
  const artifact = artifacts.find(entry => entry.path === 'docs/WORKFLOW.md');
  assert.equal(artifact.ownership, 'seed');
  const plan = planArtifacts(root, artifacts);
  assert.deepEqual(plan.conflicts, []);
  applyArtifactPlan(root, plan);
  assert.equal(fs.readFileSync(workflow, 'utf8'), content);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'))).files.some(entry => entry.path === 'docs/WORKFLOW.md'), false);
  assert.equal(checkProject(scanProject(root)).ok, true);
  const removal = planArtifacts(root, [], { allowStaleRemoval: true });
  assert.equal(removal.operations.some(entry => entry.path === 'docs/WORKFLOW.md' && entry.remove), false);
  fs.appendFileSync(workflow, '\nUnapproved change\n');
  assert.equal(checkProject(scanProject(root)).ok, false);
  assert.throws(() => buildArtifacts(config, scanProject(root)), /workflow.*digest/i);
  assert.throws(() => buildArtifacts({ ...config, governanceDepth: 'minimal' }, scanProject(root)), /workflow.*digest/i);
});

test('workflow preservation rejects stale, missing, unsafe and linked approval evidence', (context) => {
  const { root, config, approvalPath } = fixture(context);
  const approval = path.join(root, approvalPath);
  const receipt = fs.readFileSync(approval);
  fs.appendFileSync(approval, ' ');
  assert.throws(() => buildArtifacts(config, scanProject(root)), /workflow.*approval/i);
  fs.rmSync(approval);
  assert.throws(() => buildArtifacts(config, scanProject(root)));
  const target = path.join(root, 'receipt-copy.json');
  fs.writeFileSync(target, receipt);
  fs.symlinkSync(target, approval);
  assert.throws(() => buildArtifacts(config, scanProject(root)));
  config.workflowPreservation.approvalPath = '../outside.json';
  assert.throws(() => buildArtifacts(config, scanProject(root)), /workflow.*preservation/i);
});

test('approval cannot remove template gates or promote an unapproved receipt', (context) => {
  const { root, config, original, approvalPath, approve } = fixture(context);
  approve(original.replace('## Definition of done', '## Removed'));
  assert.throws(() => buildArtifacts(config, scanProject(root)), /workflow.*template/i);
  approve(original);
  const receipt = JSON.parse(fs.readFileSync(path.join(root, approvalPath)));
  receipt.status = 'PENDING';
  const bytes = JSON.stringify(receipt);
  fs.writeFileSync(path.join(root, approvalPath), bytes);
  config.workflowPreservation.approvalSha256 = sha256(bytes);
  assert.throws(() => buildArtifacts(config, scanProject(root)), /workflow.*approval/i);
});

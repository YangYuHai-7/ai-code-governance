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

test('completion binds more than ten thousand retained evidence paths and invalidates a changed last file', t => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-large-evidence-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  for (const args of [['init'], ['config', 'user.email', 'test@example.test'], ['config', 'user.name', 'Test'], ['add', '.'], ['-c', 'core.hooksPath=/dev/null', 'commit', '-qm', 'baseline']]) {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  }
  const evidence = path.join(root, 'governance/changes/sample');
  fs.mkdirSync(evidence, { recursive: true });
  for (let index = 0; index < 10010; index++) fs.writeFileSync(path.join(evidence, `${String(index).padStart(5, '0')}.json`), '{}');
  // Streaming also removes the old in-memory aggregate content limit.
  fs.writeFileSync(path.join(evidence, 'large.log'), Buffer.alloc(33 * 1024 * 1024, 65));
  const first = runCompletion(root, { taskLevel: 'L2' });
  assert.equal(first.ok, false); // absent approvals still block
  assert.match(first.taskApproval.plan.planHash, /^[a-f0-9]{64}$/);
  fs.writeFileSync(path.join(evidence, '10009.json'), '{"changed":true}');
  const second = runCompletion(root, { taskLevel: 'L2' });
  assert.notEqual(second.taskApproval.plan.planHash, first.taskApproval.plan.planHash);
});

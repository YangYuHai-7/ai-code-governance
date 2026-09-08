import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from '../src/execution-plan.mjs';
import { defaultConfig, buildArtifacts } from '../src/generator.mjs';
import { planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-execution-plan-${name}-`));
}

const initializeIntent = { id: 'governance.initialize', handler: 'init', mode: 'write' };

test('execution plans reject stale preimages before apply', (context) => {
  const root = fixture('stale');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# User-managed entry\n');
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  fs.appendFileSync(path.join(root, 'AGENTS.md'), 'changed after planning\n');
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /stale/.test(error.message));
});

test('execution plans reject repository input changes and altered desired content', (context) => {
  const root = fixture('inputs');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.1' } }));
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /repository inputs changed/.test(error.message));

  const refreshedScan = scanProject(root);
  const refreshedConfig = defaultConfig(refreshedScan);
  const refreshedArtifactPlan = planArtifacts(root, buildArtifacts(refreshedConfig, refreshedScan));
  const refreshedPlan = buildExecutionPlan({ intent: initializeIntent, scan: refreshedScan, artifactPlan: refreshedArtifactPlan, config: refreshedConfig });
  refreshedArtifactPlan.operations.find((operation) => operation.path === 'AGENTS.md').desired += '\nchanged after approval\n';
  assert.throws(() => assertArtifactPlanMatches(refreshedPlan, root, refreshedArtifactPlan), (error) => error.exitCode === 2 && /approved artifact plan/.test(error.message));
});

test('execution plans explicitly bind deterministic manifest content', (context) => {
  const root = fixture('manifest');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  const operation = plan.operations.find((item) => item.path === '.ai-governance/manifest.json');
  assert.ok(operation);
  assert.equal(operation.action, 'create');
  assert.equal(operation.afterSha256.length, 64);
  artifactPlan.manifest.content = `${artifactPlan.manifest.content}\n`;
  assert.throws(() => assertArtifactPlanMatches(plan, root, artifactPlan), (error) => error.exitCode === 2 && /approved artifact plan/.test(error.message));
});

test('execution plans reject a symlink inserted after planning', (context) => {
  const root = fixture('symlink');
  const outside = fixture('symlink-outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  fs.symlinkSync(outside, path.join(root, '.cursor'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /repository inputs changed/.test(error.message));
  assert.equal(fs.readdirSync(outside).length, 0);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { prepareInit } from '../src/cli/commands/init.mjs';
import { scanProject } from '../src/scanner.mjs';

test('selected frontend and backend stacks produce isolated production-oriented child projects', async (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-layout-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan), clients: ['codex'], stacks: ['frontend-react', 'backend-node'],
    governanceDepth: 'standard',
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' },
  };
  const artifacts = buildArtifacts(config, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  const ledger = JSON.parse(artifacts.find((artifact) => artifact.path === 'docs/ai/decision-ledger.json').content);
  assert.equal(ledger.pendingArchitectureDecision?.status, 'not-adopted');
  for (const prefix of ['apps/frontend-react', 'services/backend-node']) {
    for (const file of ['AGENTS.md', 'docs/ai/development.md', 'docs/ai/rules/architecture.md',
      'src/modules/README.md', 'src/plugins/README.md', 'src/shared/README.md']) {
      assert.ok(paths.has(`${prefix}/${file}`), `${prefix}/${file}`);
    }
  }
  assert.ok(paths.has('apps/frontend-react/docs/ai/skills/frontend-react-architecture/SKILL.md'));
  assert.ok(paths.has('apps/frontend-react/.agents/skills/frontend-react-architecture/SKILL.md'));
  assert.ok(paths.has('services/backend-node/docs/ai/skills/backend-node-architecture/SKILL.md'));
  assert.ok(paths.has('services/backend-node/.agents/skills/backend-node-architecture/SKILL.md'));
  assert.ok(paths.has('docs/ai/development/cross-project-contracts.md'));
  const design = artifacts.find((artifact) => artifact.path === 'services/backend-node/docs/ai/development.md').content;
  assert.match(design, /domain\/.*business rules/s);
  assert.match(design, /plugins\/.*extension contracts/s);
  const prepared = await prepareInit(root, { yes: true, 'dry-run': true }, { suppliedConfig: config });
  assert.ok(prepared.plan.operations.some((operation) => operation.path === 'services/backend-node/AGENTS.md'));
});

test('one selected stack uses root project boundary', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-one-stack-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], stacks: ['frontend-vue'],
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' } }, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  assert.ok(paths.has('docs/ai/development.md'));
  assert.ok(paths.has('src/modules/README.md'));
  assert.ok(paths.has('docs/ai/skills/frontend-vue-architecture/SKILL.md'));
  assert.equal([...paths].some((relative) => relative.startsWith('apps/')), false);
});

test('planned and roadmap stacks receive explicit provisional coverage instead of silently disappearing', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-provisional-stack-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], stacks: ['frontend-svelte', 'platform-android', 'backend-java'],
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null, source: 'config' } }, scan);
  const paths = new Set(artifacts.map((artifact) => artifact.path));
  assert.ok(paths.has('apps/frontend-svelte/src/modules/README.md'));
  assert.ok(paths.has('apps/platform-android/app/src/main/modules/README.md'));
  assert.ok(paths.has('services/backend-java/src/main/java/modules/README.md'));
  const index = JSON.parse(artifacts.find((artifact) => artifact.path === 'docs/ai/development/index.json').content);
  assert.deepEqual(index.units.map((unit) => unit.coverage), ['planned-template', 'roadmap-template', 'active-template']);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-generation-quality-' + name + '-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'quality-fixture', dependencies: { react: '^18.3.0', express: '^4.19.0' }, devDependencies: { typescript: '^5.5.0' } }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = true;\n');
  return root;
}

test('a root development unit never renders its path as a bare dot trigger', (context) => {
  const root = fixture(context, 'root-unit');
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete', initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } }, scan);
  const skill = artifacts.find((artifact) => artifact.path === 'docs/ai/skills/development-root/SKILL.md');
  if (skill) {
    assert.doesNotMatch(skill.content, /the \. development unit/);
    assert.match(skill.content, /root development unit/);
  }
});

test('each selected technical standard routes on its own condition and states a concrete scope', (context) => {
  const root = fixture(context, 'standard-conditions');
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard', stacks: ['frontend-react'] }, scan);
  const contextMap = artifacts.find((artifact) => artifact.path === 'docs/ai/context-map.yaml').content;
  // Extract exactly the stack block: from its key to the next conditional key.
  const stack = (contextMap.match(/^ {6}stack:\n(?:^ {8}-[^\n]*\n?)+/m) ?? [''])[0];
  assert.match(stack, /technical-standards\.json/, 'the stack block must exist');

  const standards = artifacts.filter((artifact) => artifact.path.startsWith('docs/ai/skills/standards/') && artifact.path.endsWith('/SKILL.md'));
  assert.ok(standards.length > 0, 'the fixture stack must select at least one standard');
  for (const standard of standards) {
    const id = standard.path.split('/')[4];
    // The description must carry the backticked id, which is what makes the trigger concrete.
    assert.match(standard.content, new RegExp('\`' + id + '\`'), standard.path);
    assert.doesNotMatch(stack, new RegExp(standard.path.replace(/[/.]/g, '\\$&')), 'a standard must not share the stack condition');
  }
});

test('development-unit rules and Skills are reachable from the context map', (context) => {
  const root = fixture(context, 'development-route');
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete', initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } }, scan);
  const contextMap = artifacts.find((artifact) => artifact.path === 'docs/ai/context-map.yaml').content;
  const paths = artifacts.map((artifact) => artifact.path);
  if (paths.includes('docs/ai/policies/development.md')) assert.match(contextMap, /docs\/ai\/policies\/development\.md/);
  if (paths.includes('docs/ai/skills/development-root/SKILL.md')) assert.match(contextMap, /docs\/ai\/skills\/development-root\/SKILL\.md/);
});

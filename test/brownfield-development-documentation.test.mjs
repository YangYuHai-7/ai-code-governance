import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-development-docs-'));
  fs.mkdirSync(path.join(root, 'apps', 'web', 'src'), { recursive: true });
  fs.mkdirSync(path.join(root, 'services', 'api', 'src', 'main', 'java'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'suite', workspaces: ['apps/*'], scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(root, 'apps', 'web', 'package.json'), JSON.stringify({ name: 'web', dependencies: { vue: '3.5.0' } }));
  fs.writeFileSync(path.join(root, 'apps', 'web', 'src', 'main.ts'), 'export const start = () => true;\n');
  fs.writeFileSync(path.join(root, 'services', 'api', 'pom.xml'), '<project></project>\n');
  fs.writeFileSync(path.join(root, 'services', 'api', 'src', 'main', 'java', 'Application.java'), 'class Application {}\n');
  return root;
}

test('existing monorepos receive one evidence baseline and README entrypoint per development unit', (context) => {
  const root = fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan),
    clients: ['codex'],
    governanceDepth: 'standard',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' },
  };
  const artifacts = buildArtifacts(config, scan);
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact]));
  const index = JSON.parse(byPath.get('docs/ai/development/index.json').content);
  assert.deepEqual(index.units.map((unit) => unit.path), ['.', 'apps/web', 'services/api']);
  for (const unit of index.units) {
    assert.ok(byPath.has(unit.documentation), unit.documentation);
    assert.equal(byPath.get(unit.readme).ownership, 'managed-block');
    assert.match(byPath.get(unit.documentation).content, /code-scan understanding baseline/);
  }
  const skill = byPath.get('docs/ai/skills/brownfield-understanding/SKILL.md').content;
  assert.match(skill, /Implementation Skills require correct, incorrect, and exception code shapes/);
  assert.match(skill, /Unknown content remains `unverified`/);
  assert.equal(byPath.get('.agents/skills/brownfield-understanding/SKILL.md').content, skill);
});
test('greenfield projects do not receive inferred brownfield documentation', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-greenfield-docs-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'] }, scan);
  assert.equal(artifacts.some((artifact) => artifact.path.startsWith('docs/ai/development/')), false);
  assert.equal(artifacts.some((artifact) => artifact.path === 'docs/ai/skills/brownfield-understanding/SKILL.md'), false);
});

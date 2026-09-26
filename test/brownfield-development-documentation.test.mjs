import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { prepareInit } from '../src/cli/commands/init.mjs';
import { canonicalPathVariants } from '../src/modules/governance/layout.mjs';

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
    const localRoot = unit.path === '.' ? 'docs/ai' : `${unit.path}/docs/ai`;
    assert.ok(canonicalPathVariants(`${localRoot}/rules/development.md`).some((candidate) => byPath.has(candidate)), `${localRoot}/rules/development.md`);
    const localSkill = byPath.get(`${localRoot}/skills/development-${unit.id}/SKILL.md`);
    assert.ok(localSkill);
    assert.match(localSkill.content, new RegExp(unit.documentation.replaceAll('/', '\\/')));
    const adapterRoot = unit.path === '.' ? '' : `${unit.path}/`;
    assert.ok(byPath.has(`${adapterRoot}.agents/skills/development-${unit.id}/SKILL.md`));
    if (unit.path !== '.') assert.ok(byPath.has(`${unit.path}/AGENTS.md`));
  }
  const skill = byPath.get('docs/ai/skills/brownfield-understanding/SKILL.md').content;
  assert.match(skill, /Implementation Skills require correct, incorrect, and exception code shapes/);
  assert.match(skill, /Unknown content remains `unverified`/);
  const adapter = byPath.get('.agents/skills/brownfield-understanding/SKILL.md').content;
  assert.match(adapter, /Read the complete Skill at `docs\/ai\/skills\/brownfield-understanding\/SKILL\.md`/);
  assert.doesNotMatch(adapter, /Implementation Skills require correct/);
});
test('a Maven aggregator is one development unit and its modules become inventory, not duplicate files', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-maven-aggregator-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const modules = ['svc-a', 'svc-b', 'svc-c'];
  fs.writeFileSync(path.join(root, 'pom.xml'),
    `<project><packaging>pom</packaging><modules>${modules.map((id) => `<module>${id}</module>`).join('')}</modules></project>\n`);
  for (const id of modules) {
    fs.mkdirSync(path.join(root, id, 'src/main/java'), { recursive: true });
    fs.mkdirSync(path.join(root, id, 'src/test/java'), { recursive: true });
    fs.writeFileSync(path.join(root, id, 'pom.xml'), `<project><artifactId>${id}</artifactId></project>\n`);
    fs.writeFileSync(path.join(root, id, 'src/main/java/App.java'), 'class App {}\n');
    fs.writeFileSync(path.join(root, id, 'src/test/java/AppTest.java'), 'class AppTest {}\n');
  }
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan),
    clients: ['codex'],
    governanceDepth: 'standard',
    artifactLanguage: 'en',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' },
  };
  const byPath = new Map(buildArtifacts(config, scan).map((artifact) => [artifact.path, artifact]));
  const index = JSON.parse(byPath.get('docs/ai/development/index.json').content);
  assert.deepEqual(index.units.map((unit) => unit.path), ['.']);
  assert.deepEqual(index.units[0].modules, modules);
  for (const id of modules) {
    assert.equal(byPath.has(`${id}/AGENTS.md`), false, `${id}/AGENTS.md must not be generated`);
    assert.equal(byPath.has(`${id}/README.md`), false, `${id}/README.md must not be generated`);
  }
  const document = byPath.get('docs/ai/development/root.md').content;
  assert.match(document, /## Module inventory/);
  assert.match(document, /`svc-b`/);
  // Each test file is listed once, under test evidence only.
  const sourceSection = document.split('## Source evidence')[1].split('## Test evidence')[0];
  assert.equal(sourceSection.includes('AppTest.java'), false);
});

test('greenfield projects do not receive inferred brownfield documentation', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-greenfield-docs-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'] }, scan);
  assert.equal(artifacts.some((artifact) => artifact.path.startsWith('docs/ai/development/')), false);
  assert.equal(artifacts.some((artifact) => artifact.path === 'docs/ai/skills/brownfield-understanding/SKILL.md'), false);
});

test('explicitly selected Agent can be planned for an existing project', async (context) => {
  const root = fixture();
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard',
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' },
  };
  const prepared = await prepareInit(root, { yes: true, 'dry-run': true, assist: 'codex' }, { suppliedConfig: config });
  assert.equal(prepared.config.features.aiAssist, true);
  assert.equal(prepared.config.initialization.lifecycle, 'existing');
});

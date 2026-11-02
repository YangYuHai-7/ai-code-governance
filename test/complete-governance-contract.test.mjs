import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { checkProject } from '../src/checker.mjs';

const repo = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
function fixture(t) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-complete-contract-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'member-app', dependencies: { react: '^19.0.0', express: '^4.0.0' }, scripts: { test: 'node --test' } }));
  fs.writeFileSync(path.join(root, 'src/member.js'), 'export const member = { active: true };\n');
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' } };
  return { root, scan, config };
}

test('governance completeness is fixed, including legacy minimal and standard input', t => {
  const { scan, config } = fixture(t);
  assert.equal(Object.hasOwn(config, 'governanceDepth'), false);
  let expected;
  for (const legacy of [undefined, 'minimal', 'standard', 'complete']) {
    const input = legacy ? { ...config, governanceDepth: legacy } : config;
    const artifacts = buildArtifacts(input, scan);
    const paths = artifacts.map(item => item.path).sort();
    expected ??= paths;
    assert.deepEqual(paths, expected, String(legacy));
    assert.ok(paths.includes('docs/ai/agents/architect.md'));
    assert.ok(paths.includes('docs/ai/skills/standards/module-boundaries/SKILL.md'));
    const persisted = JSON.parse(artifacts.find(item => item.path === '.ai-governance/config.json').content);
    assert.equal(Object.hasOwn(persisted, 'governanceDepth'), false);
  }
});

test('human development documents and three architecture views share one directory', t => {
  const { scan, config } = fixture(t);
  config.features.architectureDocumentation = false; // Old configuration cannot remove the baseline.
  const artifacts = buildArtifacts(config, scan);
  const index = JSON.parse(artifacts.find(item => item.path === 'docs/ai/development/index.json').content);
  assert.ok(index.units.every(unit => unit.documentation.startsWith('docs/development/')));
  assert.ok(artifacts.some(item => item.path === 'docs/development/README.md'));
  const architecture = artifacts.find(item => item.path === 'docs/development/architecture.md');
  assert.ok(architecture);
  assert.equal((architecture.content.match(/```mermaid/g) ?? []).length, 3);
  assert.doesNotMatch(architecture.content, /\]\([^)]*\.(?:js|ts|java|tsx)[)>]/);
});

test('actionable development Skills are compiled from human guidance and reject stale source', t => {
  const { root, scan, config } = fixture(t);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const document = 'docs/development/standards/module-boundaries.md';
  const skill = 'docs/ai/skills/standards/module-boundaries/SKILL.md';
  assert.ok(fs.existsSync(path.join(root, document)));
  assert.match(fs.readFileSync(path.join(root, skill), 'utf8'), /## Correct implementation shape/);
  assert.match(fs.readFileSync(path.join(root, skill), 'utf8'), /## Incorrect implementation shape/);
  fs.appendFileSync(path.join(root, document), '\n## Project decision\n\nKeep member state owned by the member module.\n');
  const stale = checkProject(scanProject(root));
  assert.equal(stale.ok, false);
  assert.ok(stale.errors.some(error => /module-boundaries/.test(error)));
  const rebuilt = buildArtifacts(config, scanProject(root));
  assert.match(rebuilt.find(item => item.path === skill).content, /Keep member state owned by the member module/);
  applyArtifactPlan(root, planArtifacts(root, rebuilt));
  assert.equal(checkProject(scanProject(root)).ok, true);
  assert.match(fs.readFileSync(path.join(root, document), 'utf8'), /Keep member state owned/);
});

test('human project guidance becomes a content-bearing Skill rather than a document pointer', t => {
  const { root, config } = fixture(t);
  fs.mkdirSync(path.join(root, 'docs/development/skills'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/development/skills/member-state.md'), `---\nname: member-state\ndescription: Use when changing member state and its view consumers.\n---\n\n# Member state\n\n## When to use\n\nChanging member state or view consumers.\n\n## Required invariants\n\nOne module owns member state.\n\n## Correct implementation shape\n\n\`\`\`js\nconst state = memberStore.read();\n\`\`\`\n\n## Incorrect implementation shape\n\n\`\`\`js\nwindow.member = {};\n\`\`\`\n\n## Verification matrix\n\n| Scenario | Expected |\n| --- | --- |\n| Member update | Consumers observe the new state |\n`);
  const artifacts = buildArtifacts(config, scanProject(root));
  const skill = artifacts.find(item => item.path === 'docs/ai/skills/development/member-state/SKILL.md');
  assert.ok(skill);
  assert.match(skill.content, /One module owns member state/);
  assert.match(skill.content, /window.member/);
  assert.ok(artifacts.some(item => item.path === '.agents/skills/development-member-state/SKILL.md'));
  applyArtifactPlan(root, planArtifacts(root, artifacts));
  assert.equal(checkProject(scanProject(root)).ok, true);
});

test('legacy human documents are copied into the new guide without losing authored facts or linking source code', t => {
  const { root, config } = fixture(t);
  fs.mkdirSync(path.join(root, 'docs/ai/development'), { recursive: true });
  const legacy = '# Existing member system\n\nKeep the member state contract. See [member][owner].\n\n[owner]: ../../../src/member.js\n';
  fs.writeFileSync(path.join(root, 'docs/ai/development/root.md'), legacy);
  const artifacts = buildArtifacts(config, scanProject(root));
  const guide = artifacts.find(item => item.path === 'docs/development/README.md');
  assert.match(guide.content, /Keep the member state contract/);
  assert.doesNotMatch(guide.content, /\[member\]\[owner\]|\[owner\]:/);
  assert.match(guide.content, /src\/member.js/);
  applyArtifactPlan(root, planArtifacts(root, artifacts));
  assert.equal(fs.readFileSync(path.join(root, 'docs/ai/development/root.md'), 'utf8'), legacy);
});

test('complete governance checks require role definitions and greenfield human documents stay together', t => {
  const { root, config } = fixture(t);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  fs.rmSync(path.join(root, 'docs/ai/agents/architect.md'));
  assert.equal(checkProject(scanProject(root)).ok, false);
  const empty = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-complete-new-')));
  t.after(() => fs.rmSync(empty, { recursive: true, force: true }));
  const scan = scanProject(empty);
  const greenfield = { ...defaultConfig(scan), clients: ['codex'], stacks: ['frontend-react', 'backend-java'], initialization: { lifecycle: 'greenfield', source: 'config' } };
  const artifacts = buildArtifacts(greenfield, scan);
  const human = artifacts.filter(item => item.kind === 'greenfield-development-document');
  assert.ok(human.length >= 2);
  assert.ok(human.every(item => item.path.startsWith('docs/development/')));
});

test('configuration UI and generated input expose no governance depth selection', t => {
  const { root } = fixture(t);
  const cli = spawnSync(process.execPath, ['bin/aicg.js', 'config', 'init', root, '--yes'], { cwd: repo, encoding: 'utf8' });
  assert.equal(cli.status, 0, cli.stderr);
  assert.equal(Object.hasOwn(JSON.parse(fs.readFileSync(path.join(root, 'aicg.config.json'))), 'governanceDepth'), false);
  const html = fs.readFileSync(path.join(repo, 'assets/config-ui/index.html'), 'utf8');
  const app = fs.readFileSync(path.join(repo, 'assets/config-ui/app.js'), 'utf8');
  assert.doesNotMatch(html, /id="depth"|id="ans-depth"/);
  assert.doesNotMatch(app, /\$\('depth'\)/);
});

test('human verification records stay outside the Agent instruction lint', t => {
  const { root, config } = fixture(t);
  fs.mkdirSync(path.join(root, 'docs/development'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/development/README.md'), '# Member project\n\nHuman verification history: reports/aicg/latest-check.json.\n');
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scanProject(root))));
  const result = checkProject(scanProject(root));
  assert.equal(result.ok, true, result.errors.join('\n'));
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { assessArchitecture } from '../src/architecture-assessment.mjs';
import { scanProject } from '../src/scanner.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-onboarding-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function writeBrownfield(root) {
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'brownfield', dependencies: { react: '19.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const App = () => null;\n');
}

test('non-interactive init requires an explicit client scope and records invocation and language separately', (context) => {
  const root = fixture('scope');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const rejected = run(['init', root, '--yes', '--no-assist']);
  assert.equal(rejected.status, 2);
  assert.match(rejected.stderr, /Client support scope must be explicit/);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);

  const initialized = run(['init', root, '--clients', 'codex,cursor', '--locale', 'zh-CN', '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.deepEqual(config.clientSupport, { mode: 'selected', selectedClients: ['codex', 'cursor'], source: 'cli' });
  assert.equal(config.interactionLanguage, 'zh-CN');
  assert.equal(config.artifactLanguage, 'zh-CN');
  assert.equal(config.invocationMode, 'npm-exec-pinned');
  assert.equal(config.toolVersion, '0.2.0');
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  assert.match(agents, /npm exec --yes --package=ai-code-governance@0\.2\.0 -- aicg complete \./);
});

test('legacy explicit clients in a config are normalized without losing compatibility', (context) => {
  const root = fixture('legacy-clients');
  const configRoot = fixture('legacy-clients-config');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  const configPath = path.join(configRoot, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify({ clients: ['codex'], interactionLanguage: 'en' }));
  const initialized = run(['init', root, '--config', configPath, '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.deepEqual(config.clientSupport, { mode: 'selected', selectedClients: ['codex'], source: 'config' });
});

test('architecture assessment produces stable adoptable ids and an approved selection only changes governance', (context) => {
  const root = fixture('architecture-adoption');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBrownfield(root);
  const first = assessArchitecture(scanProject(root));
  const second = assessArchitecture(scanProject(root));
  assert.equal(first.adoptionPlan.planHash, second.adoptionPlan.planHash);
  assert.match(first.adoptionPlan.planHash, /^[a-f0-9]{64}$/);
  assert.ok(first.recommendedBlueprints.every((profile) => /^[a-f0-9]{64}$/.test(profile.profileHash)));

  const sourceBefore = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const configPath = path.join(root, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify({
    clients: ['codex'],
    architectureApproval: {
      planId: first.adoptionPlan.planId,
      planHash: first.adoptionPlan.planHash,
      optionId: 'staged-migration',
      source: 'user',
    },
  }));
  const initialized = run(['init', root, '--config', configPath, '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.equal(config.initialization.existingCodeStrategy, 'staged-migration');
  assert.equal(config.architecture.mode, 'staged-migration-pending');
  assert.deepEqual(config.architecture.scope.roots, []);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8'), sourceBefore);
});

test('brownfield enrich is read-only and its exact plan hash can be replayed by init', (context) => {
  const root = fixture('enrich');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  writeBrownfield(root);
  const configPath = path.join(root, 'answers.json');
  fs.writeFileSync(configPath, JSON.stringify({
    clients: ['codex'],
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'new-code-standard' },
  }));
  const sourceBefore = fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8');
  const preview = run(['enrich', root, '--config', configPath, '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const payload = JSON.parse(preview.stdout);
  assert.equal(payload.readOnly, true);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  assert.match(payload.cta.applyExactPlan, /--approve [a-f0-9]{64}$/);

  const stale = run(['init', root, '--config', configPath, '--yes', '--approve', '0'.repeat(64), '--no-assist']);
  assert.equal(stale.status, 2);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
  const applied = run(['init', root, '--config', configPath, '--yes', '--approve', payload.plan.planHash, '--no-assist']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8'), sourceBefore);
});

test('help exposes Chinese onboarding while preserving English artifact language controls', () => {
  const result = run(['help', '--locale', 'zh-CN']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /客户端支持范围必须显式选择/);
  assert.match(result.stdout, /artifactLanguage/);
});

test('read-only discovery commands expose locale-aware action guides and distinguish scan shape from lifecycle', (context) => {
  const root = fixture('localized-guidance');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'manifest-only' }));

  for (const command of ['doctor', 'assess', 'architecture']) {
    const result = run([command, root, '--locale', 'zh-CN', '--json']);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    const payload = JSON.parse(result.stdout);
    assert.equal(payload.actionGuide.locale, 'zh-CN');
    assert.equal(payload.actionGuide.readOnly, true);
    assert.match(payload.actionGuide.projectMode.meaning, /扫描到的仓库形态/);
    assert.match(payload.actionGuide.lifecycle.meaning, /需要用户确认/);
    assert.ok(payload.nextSteps.length > 0);
  }

  const english = run(['assess', root, '--locale', 'en', '--json']);
  assert.equal(english.status, 0, english.stderr);
  assert.match(JSON.parse(english.stdout).actionGuide.projectMode.meaning, /scan shape/i);

  const humanDoctor = run(['doctor', root, '--locale', 'zh-CN']);
  assert.equal(humanDoctor.status, 0, humanDoctor.stderr);
  assert.match(humanDoctor.stdout, /^BOUNDARY: projectMode 仅描述扫描到的仓库形态/m);
  assert.match(humanDoctor.stdout, /^NEXT: 确认这是新脚手架还是已有项目/m);
  assert.match(humanDoctor.stdout, /aicg assess \. --locale zh-CN --json/);

  const invalid = run(['assess', root, '--locale', 'fr', '--json']);
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /locale must be one of: zh-CN, en/);
});

test('post-init source and scripts produce read-only rescan CTAs without mutating governance', (context) => {
  const root = fixture('post-init-rescan');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialized = run(['init', root, '--clients', 'codex', '--locale', 'zh-CN', '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const configPath = path.join(root, '.ai-governance', 'config.json');
  const configBefore = fs.readFileSync(configPath, 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'post-init-rescan',
    private: true,
    scripts: { test: 'node --eval "process.exit(0)"' },
  }));
  fs.mkdirSync(path.join(root, 'src', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'app', 'main.js'), 'export const ready = true;\n');

  const checked = run(['check', root, '--json']);
  assert.equal(checked.status, 0, `${checked.stderr}\n${checked.stdout}`);

  const assessed = run(['assess', root, '--locale', 'zh-CN', '--json']);
  assert.equal(assessed.status, 0, assessed.stderr);
  const payload = JSON.parse(assessed.stdout);
  assert.equal(payload.actionGuide.postInitRescan.recommended, true);
  assert.equal(payload.actionGuide.postInitRescan.mutatesConfiguration, false);
  assert.ok(payload.actionGuide.postInitRescan.newSourcePaths.includes('src/app/main.js'));
  assert.deepEqual(payload.actionGuide.allowedVerificationCommands, ['npm run test']);
  assert.ok(payload.nextSteps.some((step) => step.id === 'review-current-architecture' && step.readOnly === true));
  assert.ok(payload.nextSteps.some((step) => step.id === 'preview-current-standards' && step.readOnly === true));
  assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore);

  const completed = run(['complete', root, '--verify', 'npm test', '--json']);
  assert.equal(completed.status, 0, `${completed.stderr}\n${completed.stdout}`);
  assert.equal(JSON.parse(completed.stdout).projectVerification.command, 'npm run test');
  assert.equal(fs.readFileSync(configPath, 'utf8'), configBefore);
});

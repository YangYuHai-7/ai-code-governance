import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-request-${name}-`));
}

function run(args, options = {}) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8', ...options });
}

function treeSnapshot(root) {
  const entries = [];
  function walk(current) {
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name);
      const relative = path.relative(root, absolute);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory()) walk(absolute);
      else if (stat.isSymbolicLink()) entries.push({ relative, type: 'link', target: fs.readlinkSync(absolute), mode: stat.mode & 0o777 });
      else entries.push({ relative, type: 'file', content: fs.readFileSync(absolute, 'utf8'), mode: stat.mode & 0o777, mtimeMs: stat.mtimeMs });
    }
  }
  walk(root);
  return entries.sort((left, right) => left.relative.localeCompare(right.relative));
}

function configuredAnswers(root, features = {}) {
  return {
    schemaVersion: 1,
    generatedBy: 'ai-code-governance',
    toolVersion: '0.1.7',
    projectName: path.basename(root),
    projectMode: 'greenfield',
    canonicalRoot: 'docs/ai',
    clients: ['codex'],
    stacks: ['generic-unknown'],
    governanceDepth: 'standard',
    artifactLanguage: 'zh-CN',
    supportedOs: ['macos', 'windows', 'linux'],
    features: {
      knowledge: false,
      taskRuntime: false,
      hooks: false,
      externalWorkflows: false,
      ciIntegration: false,
      aiAssist: false,
      ...features,
    },
    domainConstraints: [],
  };
}

test('request dry-run emits a deterministic init plan without writing files', (context) => {
  const root = fixture('dry-run');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'README.md'), 'user content\n');
  const before = treeSnapshot(root);
  const first = run(['request', root, '--text', '帮我初始化项目 AI 治理框架', '--dry-run', '--json']);
  const second = run(['request', root, '--text', '初始化项目ai治理框架', '--dry-run', '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(second.status, 0, second.stderr);
  const firstPlan = JSON.parse(first.stdout);
  const secondPlan = JSON.parse(second.stdout);
  assert.equal(firstPlan.plan.planHash, secondPlan.plan.planHash);
  assert.equal(firstPlan.plan.intent, 'governance.initialize');
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
  assert.deepEqual(treeSnapshot(root), before);
  assert.ok(firstPlan.plan.operations.some((operation) => operation.action === 'create' && operation.path === 'AGENTS.md'));
});

test('request initialization writes only after approving its exact plan hash and verifies structure', (context) => {
  const root = fixture('init');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const preview = run(['request', root, '--text', '初始化治理框架', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const planHash = JSON.parse(preview.stdout).plan.planHash;
  const result = run(['request', root, '--text', '初始化治理框架', `--approve=${planHash}`, '--json']);
  assert.equal(result.status, 0, result.stderr);
  const payload = JSON.parse(result.stdout);
  assert.equal(payload.result.ok, true);
  assert.ok(fs.existsSync(path.join(root, '.ai-governance/manifest.json')));
});

test('request initialization without a matching non-interactive plan approval leaves the repository unchanged', (context) => {
  const root = fixture('approval');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = run(['request', root, '--text', '初始化治理框架']);
  assert.equal(result.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
  const stale = run(['request', root, '--text', '初始化治理框架', `--approve=${'0'.repeat(64)}`]);
  assert.equal(stale.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
  const bypass = run(['request', root, '--text', '初始化治理框架', '--yes']);
  assert.equal(bypass.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('a decision config never authorizes legacy init or a chat request', (context) => {
  const root = fixture('config-approval');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const answers = path.join(root, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify(configuredAnswers(root)));
  const legacy = run(['init', root, '--config', answers]);
  assert.equal(legacy.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
  const request = run(['request', root, '--text', '初始化治理框架', '--config', answers]);
  assert.equal(request.status, 2);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('existing projects reject --yes and chat initialization until an explicit strategy is supplied', (context) => {
  const root = fixture('existing-decision');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'existing', dependencies: { react: '19.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const App = () => null;\n');
  const before = treeSnapshot(root);
  for (const args of [
    ['init', root, '--yes', '--no-assist'],
    ['request', root, '--text', '初始化治理框架', '--dry-run', '--json'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(' ')} unexpectedly succeeded: ${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /existingCodeStrategy|existing implementation evidence/);
    assert.deepEqual(treeSnapshot(root), before);
  }
  const answers = path.join(root, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'new-code-standard' } }));
  const initialized = run(['init', root, '--config', answers, '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  assert.deepEqual(config.initialization, {
    lifecycle: 'existing',
    existingCodeStrategy: 'new-code-standard',
    source: 'config',
  });
  assert.equal(fs.readFileSync(path.join(root, 'src', 'App.tsx'), 'utf8'), 'export const App = () => null;\n');
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /Apply the approved project architecture profile to new code only/);
});

test('manifest-only projects require lifecycle confirmation before direct or chat initialization', (context) => {
  const root = fixture('ambiguous-decision');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'scaffold' }));
  const before = treeSnapshot(root);
  for (const args of [
    ['init', root, '--yes', '--no-assist'],
    ['request', root, '--text', '初始化治理框架', '--dry-run', '--json'],
  ]) {
    const result = run(args);
    assert.equal(result.status, 2, `${args.join(' ')} unexpectedly succeeded: ${result.stdout}${result.stderr}`);
    assert.match(`${result.stdout}${result.stderr}`, /lifecycle is ambiguous|initialization\.lifecycle/);
    assert.deepEqual(treeSnapshot(root), before);
  }
  const answers = path.join(root, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify({ initialization: { lifecycle: 'greenfield', existingCodeStrategy: null } }));
  const initialized = run(['init', root, '--config', answers, '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  assert.deepEqual(config.initialization, {
    lifecycle: 'greenfield',
    existingCodeStrategy: null,
    source: 'config',
  });
  assert.match(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), /repository is confirmed as greenfield/);
});

test('initialization rejects contradictory or incomplete existing-project decisions without writing files', (context) => {
  const root = fixture('invalid-decision');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'existing' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = true;\n');
  for (const [name, initialization, expression] of [
    ['greenfield', { lifecycle: 'greenfield', existingCodeStrategy: null }, /existing source/],
    ['missing-strategy', { lifecycle: 'existing', existingCodeStrategy: null }, /Existing-project initialization requires/],
    ['invalid-strategy', { lifecycle: 'existing', existingCodeStrategy: 'rewrite-everything' }, /existingCodeStrategy must be one of/],
  ]) {
    const answers = path.join(root, `${name}.json`);
    fs.writeFileSync(answers, JSON.stringify({ initialization }));
    const before = treeSnapshot(root);
    const result = run(['init', root, '--config', answers, '--yes', '--no-assist']);
    assert.equal(result.status, 2);
    assert.match(`${result.stdout}${result.stderr}`, expression);
    assert.deepEqual(treeSnapshot(root), before);
  }
});

test('init planning never executes PATH probes before approval, including rejected decision paths', (context) => {
  const root = fixture('no-probes');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'existing' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = true;\n');
  const bin = path.join(root, 'probe-bin');
  const marker = path.join(root, 'probe-marker');
  fs.mkdirSync(bin);
  for (const executable of ['git', 'codex', 'claude', 'cursor']) {
    const shim = path.join(bin, executable);
    fs.writeFileSync(shim, '#!/bin/sh\nprintf probe > "$AICG_INIT_PROBE_MARKER"\n');
    fs.chmodSync(shim, 0o755);
  }
  const before = treeSnapshot(root);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    AICG_INIT_PROBE_MARKER: marker,
  };
  for (const args of [
    ['init', root, '--yes', '--no-assist'],
    ['request', root, '--text', '初始化治理框架', '--dry-run', '--json'],
  ]) {
    const result = run(args, { env });
    assert.equal(result.status, 2, `${args.join(' ')} unexpectedly succeeded: ${result.stdout}${result.stderr}`);
    assert.equal(fs.existsSync(marker), false);
    assert.deepEqual(treeSnapshot(root), before);
  }
});

test('all existing-project strategies write governance only and AI assist is blocked before it can mutate code', (context) => {
  const configRoot = fixture('strategy-config');
  context.after(() => fs.rmSync(configRoot, { recursive: true, force: true }));
  for (const strategy of ['keep-existing', 'new-code-standard', 'staged-migration']) {
    const root = fixture(`strategy-${strategy}`);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: strategy }));
    fs.mkdirSync(path.join(root, 'src'));
    fs.writeFileSync(path.join(root, 'src', 'app.ts'), `export const strategy = '${strategy}';\n`);
    const answers = path.join(configRoot, `${strategy}.json`);
    fs.writeFileSync(answers, JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: strategy } }));
    const sourceBefore = fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8');
    const preview = run(['init', root, '--config', answers, '--yes', '--dry-run', '--no-assist']);
    assert.equal(preview.status, 0, preview.stderr);
    const previewPayload = JSON.parse(preview.stdout.slice(preview.stdout.lastIndexOf('\n{') + 1));
    assert.equal(previewPayload.initialization.existingCodeStrategy, strategy);
    assert.match(previewPayload.implementationBoundary, /preserve-existing-code/);
    assert.ok(previewPayload.files.every((file) => !file.path.startsWith('src/')));
    const initialized = run(['init', root, '--config', answers, '--yes', '--no-assist']);
    assert.equal(initialized.status, 0, initialized.stderr);
    assert.equal(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8'), sourceBefore);
  }

  const root = fixture('assist-blocked');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'assist-blocked' }));
  fs.mkdirSync(path.join(root, 'src'));
  const source = path.join(root, 'src', 'app.ts');
  fs.writeFileSync(source, 'export const preserved = true;\n');
  const answers = path.join(configRoot, 'assist-blocked.json');
  fs.writeFileSync(answers, JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'staged-migration' } }));
  const bin = path.join(root, 'assist-bin');
  fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'codex'), '#!/bin/sh\nprintf overwritten > "$AICG_ASSIST_TARGET"\n');
  fs.chmodSync(path.join(bin, 'codex'), 0o755);
  const result = run(['init', root, '--config', answers, '--yes', '--assist', 'codex'], {
    env: {
      ...process.env,
      PATH: `${bin}${path.delimiter}${process.env.PATH}`,
      AICG_ASSIST_TARGET: source,
    },
  });
  assert.equal(result.status, 2);
  assert.match(`${result.stdout}${result.stderr}`, /AI assist is unavailable/);
  assert.equal(fs.readFileSync(source, 'utf8'), 'export const preserved = true;\n');
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
});

test('chat initialization accepts a partial explicit lifecycle decision and records it in its approved plan', (context) => {
  const root = fixture('chat-partial-decision');
  const configRoot = fixture('chat-partial-config');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'existing' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = true;\n');
  const answers = path.join(configRoot, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  const before = fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8');
  const preview = run(['request', root, '--text', '初始化治理框架', '--config', answers, '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const payload = JSON.parse(preview.stdout);
  const decision = payload.plan.decisionLedger.decisions.find((item) => item.id === 'existing-code-strategy');
  assert.deepEqual(decision, { id: 'existing-code-strategy', value: 'keep-existing', source: 'config', status: 'confirmed' });
  const applied = run(['request', root, '--text', '初始化治理框架', '--config', answers, `--approve=${payload.plan.planHash}`, '--json']);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8'), before);
});

test('a recorded greenfield decision remains stable after source growth and ignores supplied classification snapshots', (context) => {
  const root = fixture('recorded-greenfield');
  const configRoot = fixture('recorded-greenfield-config');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  const first = run(['init', root, '--yes', '--no-assist']);
  assert.equal(first.status, 0, first.stderr);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = true;\n');
  const existingConfig = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  const replay = path.join(configRoot, 'replay.json');
  fs.writeFileSync(replay, JSON.stringify({
    ...existingConfig,
    initialClassification: {
      codebase: { lifecycle: { value: 'existing' } },
      implementationBoundary: 'forged',
      requiredDecisions: [],
    },
  }));
  const result = run(['init', root, '--config', replay, '--yes', '--no-assist']);
  assert.equal(result.status, 0, result.stderr);
  const persisted = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance', 'config.json'), 'utf8'));
  assert.deepEqual(persisted.initialization, {
    lifecycle: 'greenfield',
    existingCodeStrategy: null,
    source: 'yes-greenfield',
  });
  assert.equal(persisted.initialClassification.codebase.lifecycle.value, 'greenfield');
});

test('reconfiguring an existing-code strategy updates only managed policy and leaves seed files non-authoritative', (context) => {
  const root = fixture('strategy-reconfiguration');
  const configRoot = fixture('strategy-reconfiguration-config');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'existing' }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'app.ts'), 'export const app = true;\n');
  const keep = path.join(configRoot, 'keep.json');
  const newOnly = path.join(configRoot, 'new-only.json');
  fs.writeFileSync(keep, JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  fs.writeFileSync(newOnly, JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'new-code-standard' } }));
  assert.equal(run(['init', root, '--config', keep, '--yes', '--no-assist']).status, 0);
  assert.equal(run(['init', root, '--config', newOnly, '--yes', '--no-assist']).status, 0);
  const agents = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  const ledger = fs.readFileSync(path.join(root, 'docs', 'ai', 'decision-ledger.json'), 'utf8');
  const seedRule = fs.readFileSync(path.join(root, 'docs', 'ai', 'rules', '00_always.mdc'), 'utf8');
  const seedPrompt = fs.readFileSync(path.join(root, 'docs', 'ai', 'bootstrap-prompt.md'), 'utf8');
  assert.match(agents, /Apply the approved project architecture profile to new code only/);
  assert.match(ledger, /new-code-standard/);
  assert.doesNotMatch(agents, /Do not change its architecture or behavior unless a separate request/);
  assert.match(seedRule, /sole current record of initialization lifecycle/);
  assert.match(seedPrompt, /initialization decisions are authoritative/);
  assert.equal(fs.readFileSync(path.join(root, 'src', 'app.ts'), 'utf8'), 'export const app = true;\n');
});

test('chat requests refuse AI-assist configuration without invoking an agent', (context) => {
  const root = fixture('no-agent');
  const configRoot = fixture('no-agent-config');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  const answers = path.join(configRoot, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify(configuredAnswers(root, { aiAssist: true })));
  const before = treeSnapshot(root);
  const result = run(['request', root, '--text', '初始化治理框架', '--config', answers, '--dry-run']);
  assert.equal(result.status, 2);
  assert.match(`${result.stdout}${result.stderr}`, /do not invoke an AI agent/);
  assert.deepEqual(treeSnapshot(root), before);
});

test('the exact requested repair phrase routes to read-only doctor without writing a repository', (context) => {
  const root = fixture('ambiguous');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = run(['request', root, '--text', '修复一下治理框架']);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /intent=environment\.diagnose mode=read/);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
});

test('doctor and the requested repair phrase do not execute PATH probes or permit probe side effects', (context) => {
  const root = fixture('doctor-no-probe');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'probe-bin');
  const marker = path.join(root, 'doctor-side-effect');
  fs.mkdirSync(bin);
  for (const executable of ['codex', 'claude', 'cursor', 'git']) {
    const shim = path.join(bin, executable);
    fs.writeFileSync(shim, '#!/bin/sh\nprintf side-effect > "$AICG_DOCTOR_MARKER"\n');
    fs.chmodSync(shim, 0o755);
  }
  const before = treeSnapshot(root);
  const env = {
    ...process.env,
    PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    AICG_DOCTOR_MARKER: marker,
  };
  for (const args of [
    ['doctor', root, '--json'],
    ['request', root, '--text', '修复一下治理框架', '--json'],
  ]) {
    const result = run(args, { env });
    assert.equal(result.status, 0, result.stderr);
    const payload = JSON.parse(result.stdout);
    const doctorResult = payload.result ?? payload;
    assert.equal(doctorResult.checks.environmentCommandProbe, 'not-probed');
    assert.ok(doctorResult.agents.every((agent) => agent.availability === 'not-probed' || agent.availability === 'built-in'));
    assert.equal(fs.existsSync(marker), false);
    assert.deepEqual(treeSnapshot(root), before);
  }
});

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

test('chat requests refuse AI-assist configuration without invoking an agent', (context) => {
  const root = fixture('no-agent');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const answers = path.join(root, 'answers.json');
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

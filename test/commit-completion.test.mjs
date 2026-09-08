import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PRE_COMMIT_HOOK_MARKER } from '../src/commit-completion.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-completion-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function initialize(root) {
  const result = run(['init', root, '--yes', '--no-assist']);
  assert.equal(result.status, 0, result.stderr);
}

test('manual completion is read-only and runs only an explicitly discovered npm script', (context) => {
  const root = fixture('manual');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'completion-fixture',
    private: true,
    scripts: {
      verify: 'node --eval "process.exit(0)"',
      broken: 'node --eval "process.exit(7)"',
    },
  }, null, 2));
  const synced = run(['sync', root]);
  assert.equal(synced.status, 0, synced.stderr);
  const configPath = path.join(root, '.ai-governance', 'config.json');
  const before = fs.readFileSync(configPath, 'utf8');

  const passed = run(['complete', root, '--verify', 'npm run verify', '--json']);
  assert.equal(passed.status, 0, `${passed.stderr}\n${passed.stdout}`);
  const passedPayload = JSON.parse(passed.stdout);
  assert.equal(passedPayload.mode, 'manual');
  assert.equal(passedPayload.projectVerification.status, 'passed');
  assert.equal(passedPayload.generation.status, 'manual-only');
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const unknown = run(['complete', root, '--verify', 'npm run missing', '--json']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /exactly match a safely named npm script/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const failed = run(['complete', root, '--verify', 'npm run broken', '--json']);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).projectVerification.status, 'failed');
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('chat completion and the managed pre-commit hook validate only when explicitly invoked or committing', (context) => {
  const root = fixture('git-hook');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  assert.equal(git(root, ['config', 'user.email', 'aicg@example.test']).status, 0);
  assert.equal(git(root, ['config', 'user.name', 'AICG Test']).status, 0);
  initialize(root);
  assert.equal(git(root, ['add', '--all']).status, 0);
  assert.equal(git(root, ['commit', '-m', 'governance baseline']).status, 0);

  const completion = run(['request', root, '--text', '运行完成门禁', '--json']);
  assert.equal(completion.status, 0, completion.stderr);
  assert.equal(JSON.parse(completion.stdout).result.mode, 'manual');

  const completionInput = path.join(root, 'completion.json');
  fs.writeFileSync(completionInput, JSON.stringify({ verificationCommand: 'npm run verify' }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node --eval "process.exit(0)"' } }));
  assert.equal(run(['sync', root]).status, 0);
  const verifiedCompletion = run(['request', root, '--text', '运行完成门禁', '--config', completionInput, '--json']);
  assert.equal(verifiedCompletion.status, 0, verifiedCompletion.stderr);
  assert.equal(JSON.parse(verifiedCompletion.stdout).result.projectVerification.status, 'passed');

  const preview = run(['request', root, '--text', '安装 Git 提交门禁', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout).plan;
  assert.equal(plan.intent, 'governance.install-precommit');
  const installed = run(['request', root, '--text', '安装 Git 提交门禁', '--approve', plan.planHash, '--json']);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).installed.status, 'installed');

  const status = run(['hook', 'status', root, '--json']);
  assert.equal(status.status, 0, status.stderr);
  const hook = JSON.parse(status.stdout);
  assert.equal(hook.status, 'managed');
  assert.match(fs.readFileSync(hook.hookPath, 'utf8'), new RegExp(PRE_COMMIT_HOOK_MARKER));
  const chatStatus = run(['request', root, '--text', '查看提交门禁状态', '--json']);
  assert.equal(chatStatus.status, 0, chatStatus.stderr);
  assert.equal(JSON.parse(chatStatus.stdout).result.hookStatus, 'managed');

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'flat.ts'), 'export const flat = true;\n');
  assert.equal(git(root, ['add', 'src/flat.ts']).status, 0);
  const blocked = git(root, ['commit', '-m', 'blocked flat source']);
  assert.notEqual(blocked.status, 0, `${blocked.stdout}\n${blocked.stderr}`);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /architecture placement: src\/flat\.ts/);
  assert.match(git(root, ['diff', '--cached', '--name-only']).stdout, /src\/flat\.ts/);
});

test('pre-commit installation never overwrites a non-managed hook', (context) => {
  const root = fixture('hook-conflict');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hookPath, '#!/bin/sh\necho custom\n', { mode: 0o755 });

  const status = run(['hook', 'status', root, '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, 'conflict');
  const install = run(['hook', 'install', root, '--yes', '--json']);
  assert.equal(install.status, 2);
  assert.match(install.stderr, /Refuse to replace the existing pre-commit hook/);
  assert.equal(fs.readFileSync(hookPath, 'utf8'), '#!/bin/sh\necho custom\n');
});

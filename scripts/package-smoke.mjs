#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-package-smoke-'));
const packDirectory = path.join(fixture, 'pack');
const installDirectory = path.join(fixture, 'install');
const projectDirectory = path.join(fixture, 'project with 空格');
const npmCli = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

function runNpm(args, options = {}) {
  assert.ok(npmCli, 'npm_execpath is required; run this smoke test through npm run smoke:package.');
  return run(process.execPath, [npmCli, ...args], options);
}

try {
  fs.mkdirSync(packDirectory, { recursive: true });
  fs.mkdirSync(projectDirectory, { recursive: true });
  const packed = runNpm(['pack', '--json', '--pack-destination', packDirectory], { cwd: root });
  const packResult = JSON.parse(packed.stdout);
  const tarball = path.join(packDirectory, packResult[0].filename);
  assert.ok(fs.statSync(tarball).isFile());

  runNpm(['install', '--prefix', installDirectory, tarball, '--ignore-scripts', '--no-audit', '--no-fund']);
  const installedBin = path.join(installDirectory, 'node_modules', 'ai-code-governance', 'bin', 'aicg.js');
  assert.ok(fs.statSync(installedBin).isFile());
  const installedCommand = runNpm(['exec', '--prefix', installDirectory, '--', 'aicg', '--version']);
  assert.equal(installedCommand.stdout.trim(), packageVersion);
  const requestPlan = run(process.execPath, [installedBin, 'request', projectDirectory, '--text', '初始化治理框架', '--dry-run', '--json']);
  const requestPayload = JSON.parse(requestPlan.stdout);
  assert.equal(requestPayload.plan.intent, 'governance.initialize');
  assert.equal(fs.existsSync(path.join(projectDirectory, 'AGENTS.md')), false);
  run(process.execPath, [installedBin, 'request', projectDirectory, '--text', '初始化治理框架', `--approve=${requestPayload.plan.planHash}`, '--json']);
  assert.ok(fs.existsSync(path.join(projectDirectory, '.ai-governance', 'manifest.json')));
  run(process.execPath, [installedBin, 'init', projectDirectory, '--yes', '--no-assist']);
  const standardsPreview = run(process.execPath, [installedBin, 'standards', projectDirectory, '--json']);
  assert.equal(JSON.parse(standardsPreview.stdout).mode, 'read-only-preview');
  const chatStandardsPreview = run(process.execPath, [installedBin, 'request', projectDirectory, '--text', '生成技术规范预览', '--json']);
  assert.equal(JSON.parse(chatStandardsPreview.stdout).intent.id, 'technical-standards.preview');
  run(process.execPath, [installedBin, 'check', projectDirectory, '--json']);
  assert.ok(fs.existsSync(path.join(projectDirectory, '.ai-governance', 'manifest.json')));
  console.log('package_smoke=pass');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

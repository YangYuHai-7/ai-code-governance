#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-package-smoke-'));
const packDirectory = path.join(fixture, 'pack');
const installDirectory = path.join(fixture, 'install');
const projectDirectory = path.join(fixture, 'project with 空格');
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm';

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

try {
  fs.mkdirSync(packDirectory, { recursive: true });
  fs.mkdirSync(projectDirectory, { recursive: true });
  const packed = run(npmCommand, ['pack', '--json', '--pack-destination', packDirectory], { cwd: root });
  const packResult = JSON.parse(packed.stdout);
  const tarball = path.join(packDirectory, packResult[0].filename);
  assert.ok(fs.statSync(tarball).isFile());

  run(npmCommand, ['install', '--prefix', installDirectory, tarball, '--ignore-scripts', '--no-audit', '--no-fund']);
  const installedBin = path.join(installDirectory, 'node_modules', 'ai-code-governance', 'bin', 'aicg.mjs');
  assert.ok(fs.statSync(installedBin).isFile());
  run(process.execPath, [installedBin, 'init', projectDirectory, '--yes', '--no-assist']);
  run(process.execPath, [installedBin, 'check', projectDirectory, '--json']);
  assert.ok(fs.existsSync(path.join(projectDirectory, '.ai-governance', 'manifest.json')));
  console.log('package_smoke=pass');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

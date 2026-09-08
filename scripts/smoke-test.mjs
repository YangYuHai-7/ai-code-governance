#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-smoke-'));

try {
  fs.writeFileSync(path.join(fixture, 'package.json'), JSON.stringify({
    name: 'aicg-smoke-fixture',
    scripts: { test: 'node --test' },
    dependencies: { react: '19.0.0', express: '5.0.0' },
  }));
  for (const args of [
    ['init', fixture, '--yes', '--no-assist'],
    ['standards', fixture, '--json'],
    ['check', fixture, '--json'],
    ['sync', fixture, '--dry-run'],
  ]) {
    const result = spawnSync(process.execPath, [path.join(root, 'bin/aicg.js'), ...args], { encoding: 'utf8' });
    assert.equal(result.status, 0, `${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  }
  const noninteractive = path.join(fixture, 'noninteractive');
  fs.mkdirSync(noninteractive);
  const missingAnswers = spawnSync(process.execPath, [path.join(root, 'bin/aicg.js'), 'init', noninteractive], { encoding: 'utf8' });
  assert.equal(missingAnswers.status, 2);
  assert.equal(fs.existsSync(path.join(noninteractive, 'AGENTS.md')), false);
  const links = [];
  function visit(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isSymbolicLink()) links.push(target);
      else if (entry.isDirectory()) visit(target);
    }
  }
  visit(fixture);
  assert.deepEqual(links, []);
  console.log('smoke_test=pass');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

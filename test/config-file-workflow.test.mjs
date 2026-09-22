import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CLI = path.join(REPOSITORY_ROOT, 'bin', 'aicg.js');

function run(args) {
  return spawnSync(process.execPath, [CLI, ...args], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  });
}

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-config-file-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'package.json'), `${JSON.stringify({ name: 'existing-app', scripts: { test: 'node --test' } }, null, 2)}\n`);
  fs.writeFileSync(path.join(root, 'src', 'app.mjs'), 'export const ready = true;\n');
  return root;
}

test('configuration template is editable, valid, and idempotent', (t) => {
  const root = fixture(t);
  const relative = 'aicg.config.json';
  const absolute = path.join(root, relative);

  const created = run(['config', 'init', root, '--output', relative, '--yes', '--json']);
  assert.equal(created.status, 0, created.stderr);
  assert.equal(JSON.parse(created.stdout).status, 'created');
  const content = fs.readFileSync(absolute, 'utf8');
  const template = JSON.parse(content);
  assert.deepEqual(template.clients, ['codex']);
  assert.deepEqual(template.initialization, { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' });
  assert.equal(template.testing.caseFormat, 'aicg-json-v2');
  assert.equal(template.governanceFootprint, 'compact');

  const replay = run(['config', 'init', root, '--output', relative, '--yes', '--json']);
  assert.equal(replay.status, 0, replay.stderr);
  assert.equal(JSON.parse(replay.stdout).status, 'unchanged');
  assert.equal(fs.readFileSync(absolute, 'utf8'), content);

  const validated = run(['config', 'validate', root, '--config', absolute, '--json']);
  assert.equal(validated.status, 0, validated.stderr);
  const result = JSON.parse(validated.stdout);
  assert.equal(result.valid, true);
  assert.equal(result.lifecycle, 'existing');
  assert.ok(result.operationCount > 0);
});

test('configuration template refuses changed files and unsafe outputs', (t) => {
  const root = fixture(t);
  const absolute = path.join(root, 'aicg.config.json');
  fs.writeFileSync(absolute, '{"owner":"content"}\n');

  const conflict = run(['config', 'init', root, '--yes', '--json']);
  assert.equal(conflict.status, 2);
  assert.match(conflict.stderr, /Refuse to replace/);
  assert.equal(fs.readFileSync(absolute, 'utf8'), '{"owner":"content"}\n');

  const traversal = run(['config', 'init', root, '--output', '../outside.json', '--yes']);
  assert.equal(traversal.status, 2);
  assert.match(traversal.stderr, /safe repository-relative JSON file/);
});

test('configuration validation reports malformed input without blocking by default', (t) => {
  const root = fixture(t);
  const config = path.join(root, 'broken.json');
  fs.writeFileSync(config, '{broken');
  const result = run(['config', 'validate', root, '--config', config, '--json']);
  assert.equal(result.status, 0);
  assert.equal(JSON.parse(result.stdout).valid, false);
  assert.match(result.stdout, /JSON/);
});

test('configuration file does not change an empty project lifecycle on replay', (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-config-greenfield-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const first = run(['config', 'init', root, '--yes', '--json']);
  assert.equal(first.status, 0, first.stderr);
  assert.equal(JSON.parse(first.stdout).lifecycle, 'greenfield');
  const second = run(['config', 'init', root, '--yes', '--json']);
  assert.equal(second.status, 0, second.stderr);
  assert.equal(JSON.parse(second.stdout).status, 'unchanged');
  const config = path.join(root, 'aicg.config.json');
  const validated = run(['config', 'validate', root, '--config', config, '--json']);
  assert.equal(validated.status, 0, validated.stderr);
  assert.equal(JSON.parse(validated.stdout).lifecycle, 'greenfield');
});

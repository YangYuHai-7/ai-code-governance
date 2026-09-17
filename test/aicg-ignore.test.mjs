import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { walkFilesDetailed } from '../src/adapters/filesystem/index.mjs';
import { loadAicgIgnore } from '../src/modules/repository/aicg-ignore.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-ignore-${name}-`));
}

test('ignore policy exposes a stable digest and normalized auditable rules', (context) => {
  const root = fixture('policy');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.aicgignore'), '# generated output\n/target/\n!target/keep.txt\n');
  const ignore = loadAicgIgnore(root);
  assert.match(ignore.sha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(ignore.policy, [
    { line: 2, action: 'exclude', pattern: 'target', directoryOnly: true, anchored: true },
    { line: 3, action: 'include', pattern: 'target/keep.txt', directoryOnly: false, anchored: false },
  ]);
});

test('walker reports project-policy exclusions without hiding the policy file', (context) => {
  const root = fixture('matches');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'vendor'));
  fs.writeFileSync(path.join(root, 'vendor/bundle.js'), 'opaque\n');
  fs.writeFileSync(path.join(root, '.aicgignore'), 'vendor/**\n');
  const ignore = loadAicgIgnore(root);
  const excluded = [];
  const walked = walkFilesDetailed(root, {
    maxDepth: 8,
    shouldIgnorePath: ignore.shouldIgnore,
    onIgnoredPath: (entry) => excluded.push(entry.relative),
  });
  assert.ok(walked.files.some((entry) => entry.relative === '.aicgignore'));
  assert.deepEqual(excluded, ['vendor/bundle.js']);
  assert.equal(walked.files.some((entry) => entry.relative === 'vendor/bundle.js'), false);
});

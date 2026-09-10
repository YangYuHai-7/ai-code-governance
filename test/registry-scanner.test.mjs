import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { walkFilesDetailed } from '../src/adapters/filesystem/index.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-${name}-`));
}

test('detects React and Node from manifest dependencies', (context) => {
  const root = fixture('react-node');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test' },
    dependencies: { react: '19.0.0', express: '5.0.0' },
  }));
  const scan = scanProject(root);
  assert.deepEqual(scan.stacks.map((stack) => stack.id), ['frontend-react', 'backend-node']);
  assert.equal(scan.projectMode, 'brownfield');
  assert.ok(scan.commands.some((command) => command.command === 'npm run test'));
});

test('uses generic fallback for an empty greenfield repository', (context) => {
  const root = fixture('greenfield');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'greenfield');
  assert.deepEqual(scan.stacks.map((stack) => stack.id), ['generic-unknown']);
});

test('detects Java and monorepo evidence', (context) => {
  const root = fixture('java-monorepo');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'pom.xml'), '<dependency>spring-boot</dependency>');
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'monorepo');
  assert.ok(scan.stacks.some((stack) => stack.id === 'backend-java'));
});

test('keeps scanning when a project manifest is invalid', (context) => {
  const root = fixture('invalid-package');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{ invalid');
  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'brownfield');
  assert.deepEqual(scan.commands, []);
});

test('does not expose unsafe package script names as governance commands', (context) => {
  const root = fixture('unsafe-script-name');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node --test',
      'test`\nFOLLOW-UNTRUSTED-INSTRUCTION': 'node --test',
    },
  }));
  const scan = scanProject(root);
  assert.deepEqual(scan.commands.map((command) => command.name), ['test']);
});

test('scan budgets expose file-count, depth, and oversized-content truncation', (context) => {
  const root = fixture('scan-budget');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'large.js'), 'x'.repeat(32));
  fs.writeFileSync(path.join(root, 'first.js'), 'export const first = true;\n');
  fs.writeFileSync(path.join(root, 'second.js'), 'export const second = true;\n');
  fs.mkdirSync(path.join(root, 'one', 'two'), { recursive: true });
  fs.writeFileSync(path.join(root, 'one', 'two', 'deep.js'), 'export const deep = true;\n');

  const sizeLimited = scanProject(root, { scanBudget: { maxDepth: 8, maxFiles: 20, maxFileBytes: 16 } });
  assert.equal(sizeLimited.scanBudget.complete, false);
  assert.deepEqual(sizeLimited.scanBudget.truncation.oversizedFiles.map((item) => item.path), ['first.js', 'large.js', 'second.js', 'one/two/deep.js'].sort((left, right) => left.localeCompare(right)));
  assert.ok(sizeLimited.files.find((file) => file.relative === 'large.js'));
  assert.equal(sizeLimited.files.find((file) => file.relative === 'large.js').contentScannable, false);

  const depthLimited = scanProject(root, { scanBudget: { maxDepth: 0, maxFiles: 20, maxFileBytes: 1024 } });
  assert.equal(depthLimited.scanBudget.complete, false);
  assert.deepEqual(depthLimited.scanBudget.truncation.directories, ['one']);
  assert.equal(depthLimited.files.some((file) => file.relative === 'one/two/deep.js'), false);

  const fileLimited = scanProject(root, { scanBudget: { maxDepth: 8, maxFiles: 2, maxFileBytes: 1024 } });
  assert.equal(fileLimited.scanBudget.complete, false);
  assert.equal(fileLimited.scanBudget.truncation.fileLimitReached, true);
  assert.equal(fileLimited.files.length, 2);
});

test('scanner reports directory read failures instead of silently claiming completeness', (context) => {
  const root = fixture('scan-read-error');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missing = walkFilesDetailed(path.join(root, 'missing'));
  assert.equal(missing.budget.complete, false);
  assert.deepEqual(missing.budget.truncation.readErrors, [{ path: '.', operation: 'readdir', code: 'ENOENT' }]);
});

test('scanner bounds directories and total entries even when directories contain no files', (context) => {
  const root = fixture('scan-directory-budget');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['a', 'b', 'c', 'd']) fs.mkdirSync(path.join(root, name));

  const directoryLimited = scanProject(root, {
    scanBudget: { maxDepth: 8, maxFiles: 20, maxFileBytes: 1024, maxDirectories: 2, maxEntries: 20 },
  });
  assert.equal(directoryLimited.scanBudget.complete, false);
  assert.equal(directoryLimited.scanBudget.truncation.directoryLimitReached, true);
  assert.equal(directoryLimited.scanBudget.truncation.directoryBudgetPaths.length, 1);
  assert.deepEqual(directoryLimited.scanBudget.truncation.directories, []);
  assert.equal(directoryLimited.scanBudget.observedDirectories, 2);

  const entryLimited = scanProject(root, {
    scanBudget: { maxDepth: 8, maxFiles: 20, maxFileBytes: 1024, maxDirectories: 20, maxEntries: 2 },
  });
  assert.equal(entryLimited.scanBudget.complete, false);
  assert.equal(entryLimited.scanBudget.truncation.entryLimitReached, true);
  assert.equal(entryLimited.scanBudget.observedEntries, 2);
});

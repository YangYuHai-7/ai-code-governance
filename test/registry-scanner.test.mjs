import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';

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

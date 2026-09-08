import assert from 'node:assert/strict';
import test from 'node:test';
import { parseArgs } from '../src/args.mjs';
import { isSafeRelative, normalizeRelative } from '../src/utils.mjs';

test('parses init flags and a target with spaces', () => {
  const parsed = parseArgs(['init', 'project with spaces', '--yes', '--config=answers.json', '--migrate-links']);
  assert.deepEqual(parsed, {
    command: 'init',
    target: 'project with spaces',
    options: { yes: true, config: 'answers.json', 'migrate-links': true },
  });
});

test('rejects unknown options with a usage exit code', () => {
  assert.throws(() => parseArgs(['init', '--mystery']), (error) => error.exitCode === 2);
  assert.throws(() => parseArgs(['check', '--force']), (error) => error.exitCode === 2);
  assert.throws(() => parseArgs(['init', '.', 'second']), (error) => error.exitCode === 2);
});

test('keeps equals signs inside option values', () => {
  assert.equal(parseArgs(['init', '--config=path=with-equals.json']).options.config, 'path=with-equals.json');
});

test('parses the read-only technical standards command', () => {
  assert.deepEqual(parseArgs(['standards', 'project with spaces', '--json']), {
    command: 'standards',
    target: 'project with spaces',
    options: { json: true },
  });
  assert.throws(() => parseArgs(['standards', '--force']), (error) => error.exitCode === 2);
});

test('parses capability harvest only with its bounded write flags', () => {
  assert.deepEqual(parseArgs(['harvest', '.', '--dry-run', '--json']), {
    command: 'harvest',
    target: '.',
    options: { 'dry-run': true, json: true },
  });
  assert.throws(() => parseArgs(['harvest', '--config', 'answers.json']), (error) => error.exitCode === 2);
});

test('normalizes Windows separators without corrupting drive and UNC-like text', () => {
  assert.equal(normalizeRelative('docs\\ai\\rules\\00_always.mdc'), 'docs/ai/rules/00_always.mdc');
  assert.equal(normalizeRelative('C:\\repo\\AGENTS.md'), 'C:/repo/AGENTS.md');
  assert.equal(normalizeRelative('\\\\server\\share\\AGENTS.md'), '//server/share/AGENTS.md');
});

test('rejects absolute and parent-traversal managed paths', () => {
  assert.equal(isSafeRelative('docs/ai/README.md'), true);
  assert.equal(isSafeRelative('../outside.txt'), false);
  assert.equal(isSafeRelative('/tmp/outside.txt'), false);
  assert.equal(isSafeRelative('C:\\outside.txt'), false);
  assert.equal(isSafeRelative('\\\\server\\share\\outside.txt'), false);
});

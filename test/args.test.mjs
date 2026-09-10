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

test('parses the read-only team recommendation command without write authorization flags', () => {
  const parsed = parseArgs(['team', 'project', '--config', 'team-context.json', '--json']);
  assert.equal(parsed.command, 'team');
  assert.equal(parsed.target, 'project');
  assert.equal(parsed.options.config, 'team-context.json');
  assert.equal(parsed.options.json, true);
  assert.throws(() => parseArgs(['team', '--yes']), (error) => error.exitCode === 2);
});

test('parses capability harvest only with its bounded write flags', () => {
  assert.deepEqual(parseArgs(['harvest', '.', '--dry-run', '--json']), {
    command: 'harvest',
    target: '.',
    options: { 'dry-run': true, json: true },
  });
  assert.throws(() => parseArgs(['harvest', '--config', 'answers.json']), (error) => error.exitCode === 2);
});

test('parses capability promotion only with an explicit capability, entrypoint, and verification command', () => {
  assert.deepEqual(parseArgs(['promote', '.', '--id', 'project-http-client', '--entrypoint', 'src/http-client.ts', '--verify', 'npm run verify', '--yes']), {
    command: 'promote',
    target: '.',
    options: { id: 'project-http-client', entrypoint: 'src/http-client.ts', verify: 'npm run verify', yes: true },
  });
  assert.throws(() => parseArgs(['promote', '--force']), (error) => error.exitCode === 2);
});

test('parses manual completion and explicit pre-commit hook actions', () => {
  assert.deepEqual(parseArgs(['complete', 'project', '--verify', 'npm run test', '--json']), {
    command: 'complete',
    target: 'project',
    options: { verify: 'npm run test', json: true },
  });
  assert.deepEqual(parseArgs(['hook', 'install', 'project', '--yes']), {
    command: 'hook',
    action: 'install',
    target: 'project',
    options: { yes: true },
  });
  assert.throws(() => parseArgs(['hook', 'remove']), (error) => error.exitCode === 2);
  assert.throws(() => parseArgs(['complete', '--yes']), (error) => error.exitCode === 2);
});

test('parses the risk-tiered release acceptance command', () => {
  assert.deepEqual(parseArgs(['release-check', 'project', '--type', 'feature', '--evidence', 'docs/ai/release.json', '--replay', '--approve', 'plan-hash', '--json']), {
    command: 'release-check',
    target: 'project',
    options: { type: 'feature', evidence: 'docs/ai/release.json', replay: true, approve: 'plan-hash', json: true },
  });
  assert.throws(() => parseArgs(['release-check', '--yes']), (error) => error.exitCode === 2);
});

test('parses evidence actions and keeps recording explicitly authorized', () => {
  assert.deepEqual(parseArgs(['evidence', 'record', 'project', '--config', 'docs/ai/receipt.json', '--yes', '--json']), {
    command: 'evidence',
    action: 'record',
    target: 'project',
    options: { config: 'docs/ai/receipt.json', yes: true, json: true },
  });
  assert.deepEqual(parseArgs(['evidence', 'status', 'project', '--json']), {
    command: 'evidence',
    action: 'status',
    target: 'project',
    options: { json: true },
  });
  assert.throws(() => parseArgs(['evidence', 'certify']), (error) => error.exitCode === 2);
  assert.throws(() => parseArgs(['evidence', 'status', '--force']), (error) => error.exitCode === 2);
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

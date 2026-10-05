import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  createVerificationPolicy,
  runVerificationCommand,
  runVerificationPlan,
  selectVerificationCommands,
} from '../src/modules/delivery-core/index.mjs';
import { executeVerificationProcess } from '../src/adapters/process/index.mjs';
import { sha256 } from '../src/shared/index.mjs';

const digest = 'a'.repeat(64);

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-verify-runner-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{"scripts":{"test":"node --test"}}\n');
  return root;
}

function command(root, overrides = {}) {
  const source = overrides.source ?? { kind: 'npm-script', path: 'package.json', scriptName: 'test', sha256: sha256(fs.readFileSync(path.join(root, 'package.json'))) };
  return {
    schemaVersion: 1, id: 'root:test', unitId: 'root', cwd: '.', argv: [process.execPath, '-e', 'process.stdout.write("ok")'], source,
    purpose: ['test'], scopeGlobs: ['src/**'], sideEffects: [], trust: { level: 'structurally-trusted', reasons: [] }, ...overrides, source,
  };
}

function policy(overrides = {}) {
  return createVerificationPolicy({ production: true, timeoutMs: 1000, maxOutputBytes: 1024, allowedSideEffects: [], sessionId: 'session.verify', semanticDigest: digest, repositoryDigest: digest, ...overrides });
}

test('selection is deterministic, scope-aware, and fail-closed in production', () => {
  const trusted = { id: 'b', purpose: ['test'], scopeGlobs: ['src/**'], trust: { level: 'structurally-trusted' }, sideEffects: [], source: { sha256: digest }, argv: ['npm', 'test'], cwd: '.' };
  const declared = { ...trusted, id: 'a', trust: { level: 'declared' } };
  const production = selectVerificationCommands({ discovered: [trusted, declared], requiredPurposes: ['test'], changedPaths: ['src/app.mjs'], production: true });
  assert.deepEqual(production.selected.map((entry) => entry.id), ['b']);
  assert.ok(production.gaps.some((entry) => entry.commandId === 'a'));
  const advisory = selectVerificationCommands({ discovered: [trusted, declared], requiredPurposes: ['test'], changedPaths: ['src/app.mjs'], production: false });
  assert.deepEqual(advisory.selected.map((entry) => entry.id), ['a', 'b']);
  assert.ok(advisory.gaps.length > 0);
});

test('runner creates digest-bound evidence for pass, non-zero exit, timeout, and overflow', (context) => {
  const root = fixture(context), base = command(root);
  const passed = runVerificationCommand(root, base, policy(), () => ({ exitCode: 0, stdout: 'ok', stderr: '', durationMs: 3 }));
  assert.equal(passed.status, 'passed');
  assert.equal(passed.verificationLevel, 'verified');
  assert.match(passed.commandDigest, /^[a-f0-9]{64}$/);
  assert.match(passed.resultDigest, /^[a-f0-9]{64}$/);
  assert.equal(runVerificationCommand(root, base, policy(), () => ({ exitCode: 2, stdout: '', stderr: 'fail', durationMs: 3 })).status, 'failed');
  assert.equal(runVerificationCommand(root, base, policy(), () => ({ exitCode: null, stdout: '', stderr: '', timedOut: true, durationMs: 1000 })).status, 'blocked');
  assert.equal(runVerificationCommand(root, base, policy(), () => ({ exitCode: 0, stdout: 'x'.repeat(2048), stderr: '', outputOverflow: true })).status, 'blocked');
});

test('production rejects stale sources, side effects, shell composition, cwd escape, and unsupported trust', (context) => {
  const root = fixture(context), base = command(root);
  assert.throws(() => runVerificationCommand(root, { ...base, source: { ...base.source, sha256: 'b'.repeat(64) } }, policy(), () => ({ exitCode: 0 })), /source digest.*stale/i);
  assert.throws(() => runVerificationCommand(root, { ...base, sideEffects: ['network-access'] }, policy(), () => ({ exitCode: 0 })), /side effect/i);
  assert.throws(() => runVerificationCommand(root, { ...base, argv: ['node', '&&', 'echo'] }, policy(), () => ({ exitCode: 0 })), /shell composition/i);
  assert.throws(() => runVerificationCommand(root, { ...base, cwd: '../outside' }, policy(), () => ({ exitCode: 0 })), /cwd/i);
  assert.throws(() => runVerificationCommand(root, { ...base, trust: { level: 'declared', reasons: [] } }, policy(), () => ({ exitCode: 0 })), /trust/i);
  const advisory = runVerificationCommand(root, { ...base, trust: { level: 'declared', reasons: [] } }, policy({ production: false }), () => ({ exitCode: 0, stdout: '', stderr: '' }));
  assert.equal(advisory.verificationLevel, 'reachable');
});

test('plan order is deterministic and production fails fast', (context) => {
  const root = fixture(context), calls = [];
  const commands = [command(root, { id: 'z:test' }), command(root, { id: 'a:test' }), command(root, { id: 'm:test' })];
  const results = runVerificationPlan(root, commands, policy(), (_root, item) => { calls.push(item.id); return { exitCode: item.id === 'm:test' ? 1 : 0, stdout: '', stderr: '' }; });
  assert.deepEqual(calls, ['a:test', 'm:test']);
  assert.equal(results.status, 'failed');
  assert.equal(results.results.length, 2);
});

test('process adapter executes argv directly with bounded output and no shell', (context) => {
  const root = fixture(context), base = command(root);
  const result = executeVerificationProcess(root, base, policy());
  assert.equal(result.exitCode, 0);
  assert.equal(result.stdout, 'ok');
  assert.equal(result.shell, false);
  const missing = executeVerificationProcess(root, { ...base, argv: ['definitely-missing-aicg-command'] }, policy());
  assert.equal(missing.missingExecutable, true);
});

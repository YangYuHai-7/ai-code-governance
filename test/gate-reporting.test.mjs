import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';

const cli = path.resolve('bin/aicg.js');
const run = (args) => spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-gate-report-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('governance check reports failures to a private file without blocking by default', (context) => {
  const root = fixture(context);
  const reportPath = path.join(root, 'reports/aicg/latest-check.json');
  const advisory = run(['check', root, '--json']);
  assert.equal(advisory.status, 0, advisory.stderr);
  assert.equal(JSON.parse(advisory.stdout).ok, false);
  const report = JSON.parse(fs.readFileSync(reportPath, 'utf8'));
  assert.equal(report.passed, false);
  assert.equal(report.result.ok, false);
  assert.equal(fs.statSync(reportPath).mode & 0o777, 0o600);
  const enforced = run(['check', root, '--json', '--enforce']);
  assert.equal(enforced.status, 1);
  assert.equal(JSON.parse(enforced.stdout).gateMode, 'enforce');
});

test('completion keeps its failed evidence state while writing a nonblocking report', (context) => {
  const root = fixture(context);
  for (const args of [['init'], ['config', 'user.name', 'AICG Test'], ['config', 'user.email', 'aicg@example.invalid']]) {
    const done = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
    assert.equal(done.status, 0, done.stderr);
  }
  fs.writeFileSync(path.join(root, 'README.md'), '# Fixture\n');
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  assert.equal(spawnSync('git', ['-C', root, 'add', '-A']).status, 0);
  assert.equal(spawnSync('git', ['-C', root, 'commit', '-m', 'fixture']).status, 0);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/app.js'), 'export const value = true;\n');
  const advisory = run(['complete', root, '--task-level', 'L0', '--json']);
  assert.equal(advisory.status, 0, advisory.stderr);
  const result = JSON.parse(advisory.stdout);
  assert.equal(result.ok, false);
  assert.equal(result.gateMode, 'report');
  const report = JSON.parse(fs.readFileSync(path.join(root, result.reportPath), 'utf8'));
  assert.equal(report.result.ok, false);
  const enforced = run(['complete', root, '--task-level', 'L0', '--json', '--enforce']);
  assert.equal(enforced.status, 1, enforced.stderr);
});

test('invalid configuration and test-case JSON are reported without blocking', (context) => {
  const root = fixture(context);
  const badConfig = path.join(root, 'invalid-config.json');
  fs.writeFileSync(badConfig, '{bad');
  const config = run(['config', 'validate', root, '--config', badConfig, '--json']);
  assert.equal(config.status, 0, config.stderr);
  assert.equal(JSON.parse(config.stdout).valid, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'reports/aicg/latest-config.json'))).passed, false);
  const enforced = run(['config', 'validate', root, '--config', badConfig, '--json', '--enforce']);
  assert.equal(enforced.status, 1);
  const cases = run(['test-case', 'validate', root, '--manifest', 'missing.json']);
  assert.equal(cases.status, 0, cases.stderr);
  assert.equal(JSON.parse(cases.stdout).valid, false);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, 'reports/aicg/latest-test-case.json'))).passed, false);
});

test('doctor, work-unit, and release checks each persist advisory results', (context) => {
  const root = fixture(context);
  const scenarios = [
    ['doctor', ['doctor', root, '--json']],
    ['work-unit', ['work-unit', 'status', root, '--work-unit', 'missing.json']],
    ['release-check', ['release-check', root, '--type', 'feature', '--json']],
  ];
  for (const [command, args] of scenarios) {
    const result = run(args);
    assert.equal(result.status, 0, `${command}: ${result.stderr}`);
    const report = JSON.parse(fs.readFileSync(path.join(root, `reports/aicg/latest-${command}.json`)));
    assert.equal(report.command, command);
    assert.equal(report.mode, 'report');
    if (!report.passed) assert.equal(run([...args, '--enforce']).status, 1, command);
  }
});

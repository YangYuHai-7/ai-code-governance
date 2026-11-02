import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { doctor } from '../src/doctor.mjs';
import { scanProject } from '../src/scanner.mjs';
import { addReadOnlyGuidance } from '../src/cli/read-only-guidance.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-preflight-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
function git(root, ...args) {
  const result = spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
}
function repository(root) {
  git(root, 'init', '-q');
  fs.writeFileSync(path.join(root, 'README.md'), '# Sample\n');
  git(root, 'add', 'README.md');
  git(root, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'baseline');
}
function inspect(root, locale = 'en') {
  return doctor(scanProject(root, { probeEnvironment: true }), { locale });
}

test('doctor distinguishes missing repository and missing initial commit without creating either', (t) => {
  const root = fixture(t);
  assert.equal(inspect(root).preflight.gitBaseline.status, 'repository-required');
  assert.equal(fs.existsSync(path.join(root, '.git')), false);
  git(root, 'init', '-q');
  const result = inspect(root);
  assert.equal(result.preflight.gitBaseline.status, 'initial-commit-required');
  assert.equal(result.ok, true, 'formal completion prerequisite is not a doctor failure');
});

test('ignored nested project cannot borrow ancestor baseline', (t) => {
  const root = fixture(t);
  repository(root);
  fs.writeFileSync(path.join(root, '.gitignore'), 'local/\n');
  const child = path.join(root, 'local', 'sample-app');
  fs.mkdirSync(child, { recursive: true });
  const result = inspect(child);
  assert.equal(result.preflight.gitBaseline.status, 'project-boundary-required');
  assert.equal(result.preflight.gitBaseline.relationship, 'ancestor');
  assert.equal(fs.existsSync(path.join(child, '.git')), false);
});

test('tracked monorepo members retain ancestor baseline support', (t) => {
  const root = fixture(t);
  repository(root);
  const child = path.join(root, 'packages', 'member-app');
  fs.mkdirSync(child, { recursive: true });
  fs.writeFileSync(path.join(child, 'index.js'), 'export const value = 1;');
  git(root, 'add', 'packages');
  const result = inspect(child);
  assert.equal(result.preflight.gitBaseline.status, 'ready');
  assert.equal(result.preflight.gitBaseline.relationship, 'ancestor-tracked');
});

test('untracked nested project reports uncertain ownership rather than claiming a baseline', (t) => {
  const root = fixture(t);
  repository(root);
  const child = path.join(root, 'sample-app');
  fs.mkdirSync(child);
  assert.equal(inspect(child).preflight.gitBaseline.status, 'project-boundary-unverified');
});

test('no-probe route does not execute git and leaves prerequisite unknown', (t) => {
  const root = fixture(t);
  const result = doctor(scanProject(root, { probeEnvironment: false }));
  assert.equal(result.preflight.gitBaseline.status, 'not-probed');
});

test('dependency and database signals are advisory, never project execution or verified readiness', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    engines: { node: '>=99' }, dependencies: { pg: '^8' },
    scripts: { test: 'touch should-not-exist' },
  }));
  fs.writeFileSync(path.join(root, 'package-lock.json'), '{}');
  const result = inspect(root);
  assert.equal(result.ok, true);
  assert.equal(result.preflight.database.status, 'detected-unverified');
  assert.deepEqual(result.preflight.database.signals, ['postgresql']);
  assert.equal(result.preflight.dependencies[0].status, 'installation-not-observed');
  assert.equal(result.preflight.toolchains[0].requestedVersion, '>=99');
  assert.equal(result.preflight.toolchains[0].compatibility, 'not-verified');
  assert.equal(fs.existsSync(path.join(root, 'should-not-exist')), false);
  assert.equal(fs.existsSync(path.join(root, 'node_modules')), false);
});

test('existing dependency directory does not prove installed versions or database connection', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"sqlite3":"*"}}');
  fs.mkdirSync(path.join(root, 'node_modules'));
  const result = inspect(root);
  assert.equal(result.preflight.dependencies[0].status, 'directory-present-unverified');
  assert.equal(result.preflight.database.status, 'detected-unverified');
});

test('Java manifest gives toolchain and database uncertainty without connecting', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project><dependency><artifactId>postgresql</artifactId></dependency></project>');
  const result = inspect(root);
  assert.equal(result.preflight.toolchains[0].id, 'java');
  assert.equal(result.preflight.toolchains[0].status, 'not-probed');
  assert.equal(result.preflight.database.status, 'detected-unverified');
});

test('localized diagnostics explain cause, affected capability, and safe action in existing guidance', (t) => {
  const root = fixture(t);
  const scan = scanProject(root, { probeEnvironment: true });
  const result = addReadOnlyGuidance('doctor', doctor(scan), scan, { locale: 'zh-CN' });
  const diagnostic = result.preflight.diagnostics[0];
  assert.match(diagnostic.cause, /仓库/);
  assert.match(diagnostic.affectedCapability, /完成/);
  assert.match(diagnostic.nextSafeAction, /确认/);
  assert.ok(result.actionGuide.reason.includes(diagnostic.cause));
});

test('localized legacy guidance translates captured facts without rereading manifests', (t) => {
  const root = fixture(t);
  fs.writeFileSync(path.join(root, 'package.json'), '{"dependencies":{"pg":"*"}}');
  const scan = scanProject(root, { probeEnvironment: false });
  const result = doctor(scan);
  fs.unlinkSync(path.join(root, 'package.json'));
  const guided = addReadOnlyGuidance('doctor', result, scan, { locale: 'zh-CN' });
  assert.deepEqual(guided.preflight.toolchains, result.preflight.toolchains);
  assert.deepEqual(guided.preflight.database, result.preflight.database);
  assert.match(guided.preflight.diagnostics.find((entry) => entry.id === 'project-database').cause, /数据库/);
});

test('localized doctor CLI probes its baseline only once', (t) => {
  if (process.platform === 'win32') return t.skip('POSIX executable wrapper');
  const root = fixture(t);
  repository(root);
  const actualGit = spawnSync('which', ['git'], { encoding: 'utf8' }).stdout.trim();
  assert.ok(actualGit);
  const bin = path.join(root, 'probe-bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'baseline-probes.log');
  fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\n` +
    `const fs = require('node:fs'); const cp = require('node:child_process');\n` +
    `const args = process.argv.slice(2); if (args.includes('HEAD^{commit}')) fs.appendFileSync(${JSON.stringify(log)}, 'head\\n');\n` +
    `const r = cp.spawnSync(${JSON.stringify(actualGit)}, args, {stdio:'inherit'}); process.exit(r.status ?? 1);\n`, { mode: 0o755 });
  const result = spawnSync(process.execPath, [path.resolve('bin/aicg.js'), 'doctor', root, '--locale', 'zh-CN', '--json'], {
    encoding: 'utf8', env: { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}` },
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).preflight.gitBaseline.status, 'ready');
  assert.equal(fs.readFileSync(log, 'utf8'), 'head\n');
});

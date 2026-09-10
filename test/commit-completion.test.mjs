import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { PRE_COMMIT_HOOK_MARKER } from '../src/commit-completion.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-completion-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function git(root, args) {
  return spawnSync('git', ['-C', root, ...args], { encoding: 'utf8' });
}

function initialize(root) {
  const result = run(['init', root, '--clients', 'all', '--yes', '--no-assist']);
  assert.equal(result.status, 0, result.stderr);
}

function initializeWithConstraints(root, constraints, confirmedRiskSignals = ['authorization']) {
  const configPath = path.join(os.tmpdir(), `aicg-completion-config-${process.pid}-${Date.now()}-${Math.random()}.json`);
  fs.writeFileSync(configPath, JSON.stringify({
    governanceDepth: 'standard',
    domainConstraints: constraints,
    confirmedRiskSignals,
  }));
  try {
    const result = run(['init', root, '--clients', 'all', '--config', configPath, '--yes', '--no-assist']);
    assert.equal(result.status, 0, result.stderr);
  } finally {
    fs.rmSync(configPath, { force: true });
  }
}

test('manual completion is read-only and runs only an explicitly discovered npm script', (context) => {
  const root = fixture('manual');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const agentsBefore = fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'completion-fixture',
    private: true,
    scripts: {
      test: 'node --eval "process.exit(0)"',
      verify: 'node --eval "process.exit(0)"',
      'verify:broken': 'node --eval "process.exit(7)"',
    },
  }, null, 2));
  const configPath = path.join(root, '.ai-governance', 'config.json');
  const before = fs.readFileSync(configPath, 'utf8');
  const checked = run(['check', root, '--json']);
  assert.equal(checked.status, 0, `${checked.stderr}\n${checked.stdout}`);
  assert.equal(fs.readFileSync(path.join(root, 'AGENTS.md'), 'utf8'), agentsBefore);

  const shorthand = run(['complete', root, '--verify', 'npm test', '--json']);
  assert.equal(shorthand.status, 0, `${shorthand.stderr}\n${shorthand.stdout}`);
  assert.equal(JSON.parse(shorthand.stdout).projectVerification.command, 'npm run test');

  const passed = run(['complete', root, '--verify', 'npm run verify', '--json']);
  assert.equal(passed.status, 0, `${passed.stderr}\n${passed.stdout}`);
  const passedPayload = JSON.parse(passed.stdout);
  assert.equal(passedPayload.mode, 'manual');
  assert.equal(passedPayload.projectVerification.status, 'passed');
  assert.equal(passedPayload.generation.status, 'manual-only');
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const unknown = run(['complete', root, '--verify', 'npm run missing', '--json']);
  assert.equal(unknown.status, 2);
  assert.match(unknown.stderr, /Allowed commands: npm run test, npm run verify, npm run verify:broken/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);

  const injected = run(['complete', root, '--verify', 'npm test -- --watch', '--json']);
  assert.equal(injected.status, 2);
  assert.match(injected.stderr, /Allowed commands: npm run test, npm run verify, npm run verify:broken/);

  const failed = run(['complete', root, '--verify', 'npm run verify:broken', '--json']);
  assert.equal(failed.status, 1, failed.stderr);
  assert.equal(JSON.parse(failed.stdout).projectVerification.status, 'failed');
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);
});

test('completion exposes only verification scripts and never runs implicit npm lifecycle hooks', (context) => {
  const root = fixture('verification-command-boundary');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  const marker = path.join(root, 'implicit-hook-ran');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    name: 'completion-command-boundary',
    private: true,
    scripts: {
      pretest: 'node --eval "require(\'fs\').writeFileSync(\'implicit-hook-ran\', \'unexpected\')"',
      test: 'node --eval "process.exit(0)"',
      'test:unit': 'node --eval "process.exit(0)"',
      verify: 'node --eval "process.exit(0)"',
      start: 'node --eval "process.exit(0)"',
      deploy: 'node --eval "process.exit(0)"',
    },
  }, null, 2));

  const assessed = run(['assess', root, '--json']);
  assert.equal(assessed.status, 0, assessed.stderr);
  assert.deepEqual(JSON.parse(assessed.stdout).actionGuide.allowedVerificationCommands, [
    'npm run test:unit',
    'npm run verify',
  ]);

  const hooked = run(['complete', root, '--verify', 'npm test', '--json']);
  assert.equal(hooked.status, 2);
  assert.match(hooked.stderr, /Allowed commands: npm run test:unit, npm run verify/);
  assert.equal(fs.existsSync(marker), false, 'implicit pretest hook must not execute');

  const deploy = run(['complete', root, '--verify', 'npm run deploy', '--json']);
  assert.equal(deploy.status, 2);
  assert.equal(fs.existsSync(marker), false);

  const verified = run(['complete', root, '--verify', 'npm run verify', '--json']);
  assert.equal(verified.status, 0, verified.stderr);
  assert.equal(JSON.parse(verified.stdout).projectVerification.status, 'passed');
});

test('surface verification passes a reachable HTTP story through a discovered safe command', (context) => {
  const root = fixture('surface-http');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.mkdirSync(path.join(root, 'src', 'modules', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'modules', 'api', 'index.mjs'), "import http from 'node:http';\nexport const server = http.createServer();\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:http': 'node --eval "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'docs', 'ai', 'surface-verification.json'), JSON.stringify({
    schemaVersion: 1,
    stories: [{
      id: 'http-health',
      signalId: 'surface-node-http',
      profileId: 'http-contract',
      entrypoint: 'GET /health',
      reachability: 'reachable',
      environment: 'available',
      command: 'npm run test:http',
    }],
  }));
  const completed = run(['complete', root, '--verify', 'npm run test:http', '--json']);
  assert.equal(completed.status, 0, completed.stderr);
  const surface = JSON.parse(completed.stdout).surfaceVerification;
  assert.equal(surface.status, 'passed');
  assert.equal(surface.results[0].status, 'passed');
});

test('surface verification blocks an explicitly internal-only unreachable story', (context) => {
  const root = fixture('surface-internal-only');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.mkdirSync(path.join(root, 'src', 'modules', 'api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'modules', 'api', 'index.mjs'), "import http from 'node:http';\nexport const server = http.createServer();\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:http': 'node --eval "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'docs', 'ai', 'surface-verification.json'), JSON.stringify({
    schemaVersion: 1,
    stories: [{
      id: 'internal-handler-only',
      signalId: 'surface-node-http',
      profileId: 'http-contract',
      entrypoint: 'unmounted request handler',
      reachability: 'internal-only',
      environment: 'available',
      command: 'npm run test:http',
    }],
  }));
  const completed = run(['complete', root, '--verify', 'npm run test:http', '--json']);
  assert.equal(completed.status, 1, completed.stderr);
  const payload = JSON.parse(completed.stdout);
  assert.equal(payload.projectVerification.status, 'passed');
  assert.equal(payload.surfaceVerification.status, 'blocked');
  assert.match(payload.surfaceVerification.results[0].reason, /internal-only/);
});

test('unavailable browser verification remains unverified instead of passing or blocking', (context) => {
  const root = fixture('surface-browser-unavailable');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initialize(root);
  fs.writeFileSync(path.join(root, 'index.html'), '<button id="save">Save</button>\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:browser': 'node --eval "process.exit(0)"' } }));
  fs.writeFileSync(path.join(root, 'docs', 'ai', 'surface-verification.json'), JSON.stringify({
    schemaVersion: 1,
    stories: [{
      id: 'save-click',
      signalId: 'surface-browser-ui',
      profileId: 'browser-smoke',
      entrypoint: 'click #save',
      reachability: 'reachable',
      environment: 'unavailable',
      command: 'npm run test:browser',
    }],
  }));
  const completed = run(['complete', root, '--json']);
  assert.equal(completed.status, 0, completed.stderr);
  const surface = JSON.parse(completed.stdout).surfaceVerification;
  assert.equal(surface.status, 'unverified');
  assert.equal(surface.results[0].status, 'unverified');
  assert.match(surface.results[0].reason, /environment is unavailable/);
});

test('completion blocks production readiness when confirmed risk signals lack bound acceptance evidence', (context) => {
  const root = fixture('production-readiness-missing');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Only active members may access tenant issues.']);
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node --eval "process.exit(0)"' } }));
  assert.equal(run(['sync', root]).status, 0);

  const json = run(['complete', root, '--verify', 'npm run verify', '--json']);
  assert.equal(json.status, 0, json.stderr);
  const payload = JSON.parse(json.stdout);
  assert.equal(payload.ok, true);
  assert.equal(payload.productionReadiness.state, 'blocked');
  assert.equal(payload.productionReadiness.constraintEvidence.status, 'missing');
  assert.equal(payload.productionReadiness.constraintEvidence.declared, 1);
  assert.match(payload.claimBoundary, /does not establish production readiness/i);

  const human = run(['complete', root, '--verify', 'npm run verify']);
  assert.equal(human.status, 0, human.stderr);
  assert.match(human.stdout, /^PRODUCTION_READINESS=blocked constraint_evidence=missing/m);
  assert.equal(human.stdout.trimStart().startsWith('PRODUCTION_READINESS=blocked'), true);
});

test('completion blocks production readiness when owner-confirmed constraints lack evidence without risk signals', (context) => {
  const root = fixture('production-readiness-constraint-only');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['A completed reminder must be delivered at its scheduled time.'], []);

  const completed = run(['complete', root, '--json']);
  assert.equal(completed.status, 0, completed.stderr);
  const payload = JSON.parse(completed.stdout);
  assert.equal(payload.productionReadiness.state, 'blocked');
  assert.equal(payload.productionReadiness.constraintEvidence.status, 'missing');
  assert.equal(payload.productionReadiness.constraintEvidence.declared, 1);
  assert.match(payload.productionReadiness.reason, /business constraints or risk signals/i);
});

test('business acceptance evidence must bind the current stable constraint id, text, and hash', (context) => {
  const root = fixture('production-readiness-binding');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Every issue belongs to exactly one tenant.'], []);
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/business-constraints.json'), 'utf8'));
  const current = registry.constraints[0];
  const evidencePath = path.join(root, 'docs/ai/business-acceptance-results.json');
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: current.id,
      constraint: current.constraint,
      constraintHash: '0'.repeat(64),
      status: 'pass',
      successEvidence: 'npm run test: tenant-local path passed',
      failureOrBoundaryEvidence: 'cross-tenant negative path failed closed',
    }],
  }));
  const stale = run(['complete', root, '--json']);
  assert.equal(stale.status, 0, stale.stderr);
  const stalePayload = JSON.parse(stale.stdout);
  assert.equal(stalePayload.ok, true);
  assert.equal(stalePayload.productionReadiness.state, 'blocked');
  assert.equal(stalePayload.productionReadiness.constraintEvidence.status, 'invalid');
  assert.match(stalePayload.productionReadiness.constraintEvidence.issues.join('\n'), /constraintHash does not match/);

  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: current.id,
      constraint: current.constraint,
      constraintHash: current.constraintHash,
      status: 'pass',
      successEvidence: 'npm run test: tenant-local path passed',
      failureOrBoundaryEvidence: 'cross-tenant negative path failed closed',
    }],
  }));
  const recorded = run(['complete', root, '--json']);
  assert.equal(recorded.status, 0, recorded.stderr);
  const recordedPayload = JSON.parse(recorded.stdout);
  assert.equal(recordedPayload.productionReadiness.state, 'unverified');
  assert.equal(recordedPayload.productionReadiness.reviewEligibility, 'eligible-for-review');
  assert.equal(recordedPayload.productionReadiness.constraintEvidence.status, 'recorded-unverified');
  assert.equal(recordedPayload.productionReadiness.constraintEvidence.covered, 1);
  assert.match(recordedPayload.productionReadiness.reason, /does not replay or certify/i);
});

test('production readiness requires owner-confirmed negative and recovery evidence for confirmed risks', (context) => {
  const root = fixture('production-readiness-risk-evidence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeWithConstraints(root, ['Only a trusted actor may change the record.'], ['authorization']);
  const constraint = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/business-constraints.json'), 'utf8')).constraints[0];
  fs.writeFileSync(path.join(root, 'docs/ai/business-acceptance-results.json'), JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: constraint.id,
      constraint: constraint.constraint,
      constraintHash: constraint.constraintHash,
      status: 'pass',
      successEvidence: 'trusted actor success path passed',
      failureOrBoundaryEvidence: 'request-controlled actor was denied',
    }],
  }));
  const missing = run(['complete', root, '--json']);
  assert.equal(missing.status, 0, missing.stderr);
  const missingReadiness = JSON.parse(missing.stdout).productionReadiness;
  assert.equal(missingReadiness.state, 'blocked');
  assert.equal(missingReadiness.constraintEvidence.status, 'recorded-unverified');
  assert.equal(missingReadiness.riskEvidence.status, 'missing');

  fs.writeFileSync(path.join(root, 'docs/ai/risk-evidence.json'), JSON.stringify({
    schemaVersion: 1,
    owner: 'product-owner',
    source: 'owner-confirmed',
    risks: [{
      riskId: 'body-actor-identity',
      applicability: 'applicable',
      reason: 'Authorization depends on binding the actor to trusted authentication.',
      status: 'passed',
      entrypoint: 'npm run test:authorization',
      negativeDiagnostic: 'A request-controlled actor identity was rejected.',
      recoveryEvidence: 'A trusted authenticated actor completed the operation.',
      sourceFingerprint: missingReadiness.riskEvidence.sourceFingerprint,
      evidenceLevel: 'project-local-unverified',
    }],
  }));
  const recorded = run(['complete', root, '--json']);
  assert.equal(recorded.status, 0, recorded.stderr);
  const readiness = JSON.parse(recorded.stdout).productionReadiness;
  assert.equal(readiness.state, 'unverified');
  assert.equal(readiness.reviewEligibility, 'eligible-for-review');
  assert.equal(readiness.riskEvidence.status, 'recorded-unverified');
});

test('business acceptance evidence cannot traverse a symbolic link', (context) => {
  const root = fixture('production-readiness-symlink');
  const outside = fixture('production-readiness-outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  initializeWithConstraints(root, ['Every issue belongs to exactly one tenant.']);
  const registry = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/business-constraints.json'), 'utf8'));
  const current = registry.constraints[0];
  const outsideEvidence = path.join(outside, 'business-acceptance-results.json');
  fs.writeFileSync(outsideEvidence, JSON.stringify({
    schemaVersion: 1,
    constraints: [{
      id: current.id,
      constraint: current.constraint,
      constraintHash: current.constraintHash,
      status: 'pass',
      successEvidence: 'success',
      failureOrBoundaryEvidence: 'boundary',
    }],
  }));
  fs.symlinkSync(outsideEvidence, path.join(root, 'docs/ai/business-acceptance-results.json'));

  const completed = run(['complete', root, '--json']);
  assert.equal(completed.status, 0, completed.stderr);
  const readiness = JSON.parse(completed.stdout).productionReadiness;
  assert.equal(readiness.state, 'blocked');
  assert.equal(readiness.reviewEligibility, 'not-eligible');
  assert.equal(readiness.constraintEvidence.status, 'invalid');
  assert.match(readiness.constraintEvidence.issues.join('\n'), /symbolic link/);
});

test('chat completion and the managed pre-commit hook validate only when explicitly invoked or committing', (context) => {
  const root = fixture('git-hook');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  assert.equal(git(root, ['config', 'user.email', 'aicg@example.test']).status, 0);
  assert.equal(git(root, ['config', 'user.name', 'AICG Test']).status, 0);
  initialize(root);
  assert.equal(git(root, ['add', '--all']).status, 0);
  assert.equal(git(root, ['commit', '-m', 'governance baseline']).status, 0);

  const completion = run(['request', root, '--text', '运行完成门禁', '--json']);
  assert.equal(completion.status, 0, completion.stderr);
  assert.equal(JSON.parse(completion.stdout).result.mode, 'manual');

  const completionInput = path.join(root, 'completion.json');
  fs.writeFileSync(completionInput, JSON.stringify({ verificationCommand: 'npm run verify' }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { verify: 'node --eval "process.exit(0)"' } }));
  assert.equal(run(['sync', root]).status, 0);
  const verifiedCompletion = run(['request', root, '--text', '运行完成门禁', '--config', completionInput, '--json']);
  assert.equal(verifiedCompletion.status, 0, verifiedCompletion.stderr);
  assert.equal(JSON.parse(verifiedCompletion.stdout).result.projectVerification.status, 'passed');

  const preview = run(['request', root, '--text', '安装 Git 提交门禁', '--dry-run', '--json']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout).plan;
  assert.equal(plan.intent, 'governance.install-precommit');
  const installed = run(['request', root, '--text', '安装 Git 提交门禁', '--approve', plan.planHash, '--json']);
  assert.equal(installed.status, 0, installed.stderr);
  assert.equal(JSON.parse(installed.stdout).installed.status, 'installed');

  const status = run(['hook', 'status', root, '--json']);
  assert.equal(status.status, 0, status.stderr);
  const hook = JSON.parse(status.stdout);
  assert.equal(hook.status, 'managed');
  assert.match(fs.readFileSync(hook.hookPath, 'utf8'), new RegExp(PRE_COMMIT_HOOK_MARKER));
  const chatStatus = run(['request', root, '--text', '查看提交门禁状态', '--json']);
  assert.equal(chatStatus.status, 0, chatStatus.stderr);
  assert.equal(JSON.parse(chatStatus.stdout).result.hookStatus, 'managed');

  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'flat.ts'), 'export const flat = true;\n');
  assert.equal(git(root, ['add', 'src/flat.ts']).status, 0);
  const blocked = git(root, ['commit', '-m', 'blocked flat source']);
  assert.notEqual(blocked.status, 0, `${blocked.stdout}\n${blocked.stderr}`);
  assert.match(`${blocked.stdout}\n${blocked.stderr}`, /architecture placement: src\/flat\.ts/);
  assert.match(git(root, ['diff', '--cached', '--name-only']).stdout, /src\/flat\.ts/);
});

test('pre-commit installation never overwrites a non-managed hook', (context) => {
  const root = fixture('hook-conflict');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.equal(git(root, ['init']).status, 0);
  const hookPath = path.join(root, '.git', 'hooks', 'pre-commit');
  fs.writeFileSync(hookPath, '#!/bin/sh\necho custom\n', { mode: 0o755 });

  const status = run(['hook', 'status', root, '--json']);
  assert.equal(status.status, 0, status.stderr);
  assert.equal(JSON.parse(status.stdout).status, 'conflict');
  const install = run(['hook', 'install', root, '--yes', '--json']);
  assert.equal(install.status, 2);
  assert.match(install.stderr, /Refuse to replace the existing pre-commit hook/);
  assert.equal(fs.readFileSync(hookPath, 'utf8'), '#!/bin/sh\necho custom\n');
});

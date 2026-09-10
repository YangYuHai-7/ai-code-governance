import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkProject } from '../src/checker.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { assessmentSummary, buildDecisionLedger, classifyProject, resolveInitializationDecision } from '../src/project-assessment.mjs';
import { scanProject } from '../src/scanner.mjs';
import { detectSurfaceSignals, validateSurfaceVerificationContract } from '../src/modules/repository/index.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-assessment-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('an empty project remains greenfield after governance generation', (context) => {
  const root = fixture('greenfield');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const before = scanProject(root);
  const config = defaultConfig(before);
  const beforeLedger = buildDecisionLedger(before, config);
  assert.equal(classifyProject(before).codebase.kind, 'greenfield-empty');
  const artifacts = buildArtifacts(config, before);
  const ledger = artifacts.find((artifact) => artifact.path === 'docs/ai/decision-ledger.json');
  assert.ok(ledger);
  assert.deepEqual(JSON.parse(ledger.content), beforeLedger);
  applyArtifactPlan(root, planArtifacts(root, artifacts), { transactional: true });
  const after = scanProject(root);
  assert.equal(classifyProject(after).codebase.kind, 'greenfield-empty');
  assert.equal(buildArtifacts(config, after).find((artifact) => artifact.path === 'docs/ai/decision-ledger.json').content, ledger.content);
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const app = true;\n');
  const grown = scanProject(root);
  assert.equal(classifyProject(grown).codebase.lifecycle.value, 'existing');
  assert.equal(buildArtifacts(config, grown).find((artifact) => artifact.path === 'docs/ai/decision-ledger.json').content, ledger.content);
  const result = checkProject(grown);
  assert.equal(result.ok, true);
  assert.ok(result.warnings.some((warning) => warning.includes('legacy-unconfirmed initialization decision')));
});

test('assessment summary exposes incomplete repository scans', (context) => {
  const root = fixture('incomplete-summary');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'first.ts'), 'export const first = true;\n');
  fs.writeFileSync(path.join(root, 'second.ts'), 'export const second = true;\n');
  const result = assessmentSummary(scanProject(root, { scanBudget: { maxFiles: 1 } }));
  assert.equal(result.assessmentStatus, 'incomplete');
  assert.equal(result.scanBudget.complete, false);
});

test('surface signals classify native browser, node HTTP, and file persistence without claiming support', (context) => {
  const browserRoot = fixture('surface-browser');
  const httpRoot = fixture('surface-http');
  const fileRoot = fixture('surface-file');
  const mixedRoot = fixture('surface-mixed');
  const emptyRoot = fixture('surface-empty');
  context.after(() => {
    for (const root of [browserRoot, httpRoot, fileRoot, mixedRoot, emptyRoot]) fs.rmSync(root, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(browserRoot, 'index.html'), '<button id="save">Save</button>\n');
  fs.writeFileSync(path.join(httpRoot, 'server.mjs'), "import { createServer } from 'node:http';\nexport const server = createServer();\n");
  fs.writeFileSync(path.join(fileRoot, 'store.mjs'), "import { writeFileSync } from 'node:fs';\nexport const save = writeFileSync;\n");
  fs.writeFileSync(path.join(mixedRoot, 'index.html'), '<main>App</main>\n');
  fs.writeFileSync(path.join(mixedRoot, 'server.mjs'), "import http from 'node:http';\nimport fs from 'node:fs';\nexport { http, fs };\n");

  assert.deepEqual(detectSurfaceSignals(scanProject(browserRoot)).map((signal) => signal.kind), ['browser-ui']);
  assert.deepEqual(detectSurfaceSignals(scanProject(httpRoot)).map((signal) => signal.kind), ['node-http']);
  assert.deepEqual(detectSurfaceSignals(scanProject(fileRoot)).map((signal) => signal.kind), ['file-persistence']);
  assert.deepEqual(detectSurfaceSignals(scanProject(mixedRoot)).map((signal) => signal.kind), ['browser-ui', 'node-http', 'file-persistence']);
  assert.deepEqual(detectSurfaceSignals(scanProject(emptyRoot)), []);

  const summary = assessmentSummary(scanProject(mixedRoot));
  assert.equal(summary.surfaceSignals.length, 3);
  for (const signal of summary.surfaceSignals) {
    assert.match(signal.id, /^surface-/);
    assert.equal(signal.source.type, 'static-repository-evidence');
    assert.ok(signal.source.paths.length > 0);
    assert.ok(['high', 'medium'].includes(signal.confidence));
    assert.equal(signal.evidenceLevel, 'detected-unverified');
    assert.ok(signal.gaps.length > 0);
    assert.ok(signal.suggestedVerificationProfile);
  }
});

test('surface verification contract rejects malformed kinds and evidence levels', () => {
  const valid = {
    schemaVersion: 1,
    signalKinds: ['browser-ui', 'node-http', 'file-persistence'],
    requiredSignalFields: ['id', 'kind', 'source', 'confidence', 'evidenceLevel', 'gaps'],
    confidenceLevels: ['high', 'medium', 'low'],
    evidenceLevels: ['detected-unverified'],
    verificationProfiles: ['http-contract', 'dom-smoke', 'browser-smoke', 'file-recovery'],
  };
  assert.equal(validateSurfaceVerificationContract(valid), true);
  assert.throws(() => validateSurfaceVerificationContract({ ...valid, signalKinds: ['browser-ui'] }), /signalKinds/);
  assert.throws(() => validateSurfaceVerificationContract({ ...valid, evidenceLevels: ['certified'] }), /evidenceLevels/);
});

test('zh-CN read-only guidance exposes detected surface boundaries and a declaration CTA', (context) => {
  const root = fixture('surface-guidance-zh');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'server.mjs'), "import { createServer } from 'node:http';\nexport const server = createServer();\n");
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ scripts: { 'test:http': 'node --test' } }));
  const assessed = run(['assess', root, '--locale', 'zh-CN', '--json']);
  assert.equal(assessed.status, 0, assessed.stderr);
  const payload = JSON.parse(assessed.stdout);
  assert.equal(payload.actionGuide.surfaceVerification.state, 'detected-unverified');
  assert.deepEqual(payload.actionGuide.surfaceVerification.signals.map((signal) => signal.id), ['surface-node-http']);
  const action = payload.nextSteps.find((step) => step.id === 'declare-surface-verification');
  assert.ok(action);
  assert.match(action.description, /尚未验证/);
  assert.match(action.description, /surface-verification\.json/);
});

test('an existing codebase requires an explicit existing-code strategy', (context) => {
  const root = fixture('brownfield');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/App.tsx'), 'export const App = () => null;\n');
  const scan = scanProject(root);
  const assessment = classifyProject(scan);
  assert.equal(assessment.codebase.kind, 'existing-application');
  assert.equal(assessment.codebase.lifecycle.value, 'existing');
  assert.equal(assessment.implementationBoundary, 'preserve-existing-code-until-an-explicit-migration-strategy-is-approved');
  assert.deepEqual(assessment.requiredDecisions[0].options, ['keep-existing', 'new-code-standard', 'staged-migration']);
  const ledger = buildDecisionLedger(scan, defaultConfig(scan));
  assert.equal(ledger.decisions.find((item) => item.id === 'implementation-boundary').status, 'requires-user-confirmation');
});

test('a confirmed existing-code strategy resolves the ledger without authorizing an automatic migration', (context) => {
  const root = fixture('confirmed-existing');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), 'export const App = () => null;\n');
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  config.initialization = resolveInitializationDecision(scan, {
    ...config,
    initialization: { lifecycle: 'existing', existingCodeStrategy: 'staged-migration' },
  }, { source: 'config' });
  const ledger = buildDecisionLedger(scan, config);
  assert.equal(ledger.pendingDecisions.length, 0);
  assert.deepEqual(ledger.decisions.find((item) => item.id === 'existing-code-strategy'), {
    id: 'existing-code-strategy',
    value: 'staged-migration',
    source: 'config',
    status: 'confirmed',
  });
  assert.match(ledger.decisions.find((item) => item.id === 'implementation-boundary').value, /separately-approved-staged-migration-plan/);
  assert.equal(ledger.decisions.find((item) => item.id === 'implementation-boundary').status, 'applied');
});

test('a manifest-only scaffold remains ambiguous instead of being silently treated as existing code', (context) => {
  const root = fixture('manifest-only');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'scaffold' }));
  const assessment = classifyProject(scanProject(root));
  assert.equal(assessment.codebase.lifecycle.value, 'ambiguous');
  assert.equal(assessment.requiredDecisions[0].id, 'project-lifecycle-confirmation');
});

test('an ambiguous scaffold cannot resolve without lifecycle confirmation and records a confirmed choice', (context) => {
  const root = fixture('confirmed-ambiguous');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'scaffold' }));
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  assert.throws(() => resolveInitializationDecision(scan, config, { source: 'config' }), /lifecycle is ambiguous/);
  config.initialization = resolveInitializationDecision(scan, {
    ...config,
    initialization: { lifecycle: 'greenfield', existingCodeStrategy: null },
  }, { source: 'config' });
  const ledger = buildDecisionLedger(scan, config);
  assert.equal(ledger.pendingDecisions.length, 0);
  assert.deepEqual(ledger.decisions.find((item) => item.id === 'project-lifecycle'), {
    id: 'project-lifecycle',
    value: 'greenfield',
    source: 'config',
    status: 'confirmed',
  });
});

test('persisted initialization records reject incomplete relationships and invalid decision sources', (context) => {
  const root = fixture('invalid-persisted-decision');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const base = defaultConfig(scanProject(root));
  for (const [initialization, expected] of [
    [{ lifecycle: null, existingCodeStrategy: 'keep-existing', source: null }, /existingCodeStrategy requires/],
    [{ lifecycle: 'existing', existingCodeStrategy: null, source: 'config' }, /existingCodeStrategy is required/],
    [{ lifecycle: 'greenfield', existingCodeStrategy: null, source: 'untrusted' }, /initialization.source must be one of/],
    [{ lifecycle: 'greenfield', existingCodeStrategy: null, source: null }, /initialization.source is required/],
  ]) {
    assert.throws(() => validateConfig({ ...base, initialization }), expected);
  }
});

test('Gradle and JavaScript build configuration files alone are not substantive source evidence', (context) => {
  const gradleRoot = fixture('gradle-only');
  const configRoot = fixture('config-only');
  context.after(() => {
    fs.rmSync(gradleRoot, { recursive: true, force: true });
    fs.rmSync(configRoot, { recursive: true, force: true });
  });
  fs.writeFileSync(path.join(gradleRoot, 'build.gradle.kts'), 'plugins { kotlin("jvm") version "2.0.0" }\n');
  fs.writeFileSync(path.join(configRoot, 'package.json'), JSON.stringify({ name: 'scaffold' }));
  fs.writeFileSync(path.join(configRoot, 'vite.config.ts'), 'export default {};\n');
  const gradle = classifyProject(scanProject(gradleRoot));
  const configOnly = classifyProject(scanProject(configRoot));
  assert.equal(gradle.codebase.lifecycle.value, 'ambiguous');
  assert.deepEqual(gradle.codebase.evidence.sourceFiles, []);
  assert.equal(configOnly.codebase.lifecycle.value, 'ambiguous');
  assert.deepEqual(configOnly.codebase.evidence.sourceFiles, []);
});

test('unrecognized product files are never silently classified as high-confidence greenfield', (context) => {
  const staticRoot = fixture('static-product');
  const docsSiteRoot = fixture('docs-site');
  const docsOnlyRoot = fixture('docs-only');
  const infrastructureRoot = fixture('infrastructure-product');
  context.after(() => {
    fs.rmSync(staticRoot, { recursive: true, force: true });
    fs.rmSync(docsSiteRoot, { recursive: true, force: true });
    fs.rmSync(docsOnlyRoot, { recursive: true, force: true });
    fs.rmSync(infrastructureRoot, { recursive: true, force: true });
  });
  fs.mkdirSync(path.join(staticRoot, 'public'));
  fs.writeFileSync(path.join(staticRoot, 'public', 'index.html'), '<main>existing application</main>\n');
  fs.mkdirSync(path.join(docsSiteRoot, 'docs'));
  fs.writeFileSync(path.join(docsSiteRoot, 'docs', 'index.html'), '<main>documentation site</main>\n');
  fs.writeFileSync(path.join(docsOnlyRoot, 'README.md'), '# Proposal\n');
  fs.mkdirSync(path.join(docsOnlyRoot, 'docs'));
  fs.writeFileSync(path.join(docsOnlyRoot, 'docs', 'scope.md'), '# Scope\n');
  fs.mkdirSync(path.join(infrastructureRoot, 'infra'));
  fs.writeFileSync(path.join(infrastructureRoot, 'infra', 'main.tf'), 'terraform {}\n');

  const staticAssessment = classifyProject(scanProject(staticRoot));
  const docsSiteAssessment = classifyProject(scanProject(docsSiteRoot));
  const docsOnlyAssessment = classifyProject(scanProject(docsOnlyRoot));
  const infrastructureAssessment = classifyProject(scanProject(infrastructureRoot));
  assert.equal(staticAssessment.codebase.lifecycle.value, 'ambiguous');
  assert.deepEqual(staticAssessment.codebase.evidence.unexplainedPaths, ['public/index.html']);
  assert.equal(docsSiteAssessment.codebase.lifecycle.value, 'ambiguous');
  assert.deepEqual(docsSiteAssessment.codebase.evidence.unexplainedPaths, ['docs/index.html']);
  assert.equal(docsOnlyAssessment.codebase.lifecycle.value, 'greenfield');
  assert.equal(infrastructureAssessment.codebase.lifecycle.value, 'existing');
});

test('first sync of a legacy config persists its baseline and preserves it after source growth', (context) => {
  const root = fixture('legacy-config');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialScan = scanProject(root);
  const legacyConfig = defaultConfig(initialScan);
  delete legacyConfig.initialClassification;
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(legacyConfig, initialScan)), { transactional: true });
  const persisted = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  assert.equal(persisted.initialClassification.codebase.lifecycle.value, 'greenfield');
  const beforeLedger = fs.readFileSync(path.join(root, 'docs/ai/decision-ledger.json'), 'utf8');
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const app = true;\n');
  const grown = scanProject(root);
  assert.equal(classifyProject(grown).codebase.lifecycle.value, 'existing');
  const syncPlan = planArtifacts(root, buildArtifacts(persisted, grown));
  applyArtifactPlan(root, syncPlan, { transactional: true });
  assert.equal(fs.readFileSync(path.join(root, 'docs/ai/decision-ledger.json'), 'utf8'), beforeLedger);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8')).initialClassification.codebase.lifecycle.value, 'greenfield');
});

test('configured project identity survives a copy to a checkout with a different basename', (context) => {
  const root = fixture('configured-name-source');
  const cloneParent = fixture('configured-name-clone-parent');
  const copiedRoot = path.join(cloneParent, 'different-checkout-name');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(cloneParent, { recursive: true, force: true });
  });

  const initialized = run(['init', root, '--clients', 'all', '--yes', '--no-assist']);
  assert.equal(initialized.status, 0, initialized.stderr);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  const originalLedger = fs.readFileSync(path.join(root, 'docs/ai/decision-ledger.json'), 'utf8');
  assert.notEqual(config.projectName, path.basename(copiedRoot));

  fs.cpSync(root, copiedRoot, { recursive: true });
  const checked = run(['check', copiedRoot, '--json']);
  assert.equal(checked.status, 0, checked.stderr);
  assert.equal(JSON.parse(checked.stdout).ok, true);

  const synced = run(['sync', copiedRoot]);
  assert.equal(synced.status, 0, synced.stderr);
  assert.match(synced.stdout, /"changed": \[\]/);
  const copiedLedger = fs.readFileSync(path.join(copiedRoot, 'docs/ai/decision-ledger.json'), 'utf8');
  assert.equal(copiedLedger, originalLedger);
  assert.equal(JSON.parse(copiedLedger).project.name, config.projectName);
});

test('assess and its exact chat intent are read-only', (context) => {
  const root = fixture('read-only');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const direct = run(['assess', root, '--json']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(JSON.parse(direct.stdout).classification.codebase.kind, 'greenfield-empty');
  const chat = run(['request', root, '--text', '评估项目治理路径', '--json']);
  assert.equal(chat.status, 0, chat.stderr);
  assert.equal(JSON.parse(chat.stdout).intent.id, 'project.assess');
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
});

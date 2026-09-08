import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkProject } from '../src/checker.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { buildDecisionLedger, classifyProject, resolveInitializationDecision } from '../src/project-assessment.mjs';
import { scanProject } from '../src/scanner.mjs';

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

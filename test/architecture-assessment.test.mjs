import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { assessArchitecture, resolveArchitectureApproval } from '../src/architecture-assessment.mjs';
import { scanProject } from '../src/scanner.mjs';

const cli = path.resolve('bin/aicg.js');

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-architecture-${name}-`));
}

function run(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

test('a new project receives module-first blueprints without file generation', (context) => {
  const root = fixture('new');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const result = assessArchitecture(scanProject(root));
  assert.equal(result.sourceSummary.sourceFileCount, 0);
  assert.equal(result.migrationOptions[0].id, 'module-first');
  assert.ok(result.recommendedBlueprints[0].directories.includes('src/modules/<domain>'));
  assert.equal(fs.existsSync(path.join(root, 'src')), false);
});

test('a flat existing source root produces bounded migration options', (context) => {
  const root = fixture('flat');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0', '@nestjs/core': '11.0.0' } }));
  fs.mkdirSync(path.join(root, 'src'));
  for (const name of ['user.controller', 'user.service', 'user.repository', 'user.component', 'user.store', 'billing.service', 'billing.repository', 'dashboard.component']) {
    fs.writeFileSync(path.join(root, 'src', `${name}.ts`), 'export const value = true;\n');
  }
  const result = assessArchitecture(scanProject(root));
  assert.ok(result.findings.some((finding) => finding.id === 'flat-source-root'));
  assert.ok(result.findings.some((finding) => finding.id === 'mixed-layer-root'));
  assert.deepEqual(result.migrationOptions.map((option) => option.id), ['advice-only', 'new-code-standard', 'staged-migration', 'keep-current']);
  assert.equal(result.migrationOptions.find((option) => option.id === 'staged-migration').writesBusinessCode, true);
  assert.equal(fs.readdirSync(path.join(root, 'src')).length, 8);
});

test('architecture command and exact chat intent are read-only', (context) => {
  const root = fixture('cli');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const direct = run(['architecture', root, '--json']);
  assert.equal(direct.status, 0, direct.stderr);
  assert.equal(JSON.parse(direct.stdout).boundary.includes('does not move files'), true);
  const chat = run(['request', root, '--text', '评估项目目录结构', '--json']);
  assert.equal(chat.status, 0, chat.stderr);
  assert.equal(JSON.parse(chat.stdout).intent.id, 'architecture.assess');
  assert.equal(fs.existsSync(path.join(root, '.ai-governance')), false);
});

test('an ambiguous scaffold must confirm lifecycle before receiving a directory policy', (context) => {
  const root = fixture('ambiguous');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'scaffold' }));
  fs.writeFileSync(path.join(root, 'vite.config.ts'), 'export default {};\n');
  const result = assessArchitecture(scanProject(root));
  assert.deepEqual(result.migrationOptions.map((option) => option.id), ['confirm-project-lifecycle']);
  assert.equal(result.migrationOptions[0].writesBusinessCode, false);
  assert.equal(result.recommendedBlueprints.every((blueprint) => blueprint.status === 'conditional'), true);
  assert.equal(result.recommendedBlueprints.every((blueprint) => blueprint.appliesWhen.includes('confirms a greenfield')), true);
});

test('an incomplete repository scan cannot produce an approvable architecture plan', (context) => {
  const root = fixture('incomplete-scan');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'first.ts'), 'export const first = true;\n');
  fs.writeFileSync(path.join(root, 'second.ts'), 'export const second = true;\n');
  const scan = scanProject(root, { scanBudget: { maxFiles: 1 } });
  const result = assessArchitecture(scan);
  assert.equal(result.assessmentStatus, 'incomplete');
  assert.equal(result.scanBudget.complete, false);
  assert.equal(result.adoptionPlan, null);
  assert.equal(result.adoptionConfigShape, null);
  assert.deepEqual(result.migrationOptions, []);
  assert.equal(result.recommendedBlueprints.every((blueprint) => blueprint.status === 'blocked'), true);
  assert.ok(result.findings.some((finding) => finding.id === 'repository-scan-incomplete' && finding.severity === 'blocking'));
  assert.throws(() => resolveArchitectureApproval(scan, { planId: 'architecture-adoption-v1' }), /scan is incomplete/);
});

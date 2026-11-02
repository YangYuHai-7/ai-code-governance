import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { defaultConfig, buildArtifacts } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { defaultTestCaseManifest } from '../src/modules/testing/index.mjs';

const bin = path.resolve('bin/aicg.js');
function fixture(t, configured = true) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-task-guide-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  if (configured) {
    const scan = scanProject(root);
    const config = defaultConfig(scan);
    config.clients = ['codex', 'cursor'];
    config.initialization = { lifecycle: 'existing', existingCodeStrategy: 'keep-existing', source: 'config' };
    applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  }
  return root;
}
function invoke(root, ...args) {
  return spawnSync(process.execPath, [bin, 'handoff', root, ...args], { encoding: 'utf8' });
}
function guide(root, text, ...args) {
  const result = invoke(root, '--text', text, '--scope', 'STOCK', '--json', ...args);
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

test('task handoff tells unconfigured users what to decide without selecting a client or writing files', (t) => {
  const root = fixture(t, false);
  const result = guide(root, 'Add stock business rules');
  assert.equal(result.status, 'needs-setup');
  assert.deepEqual(result.clients, []);
  assert.equal(result.nextAction.id, 'configure-project');
  assert.equal(result.verification, 'unverified');
  assert.deepEqual(fs.readdirSync(root), []);
  assert.notEqual(invoke(root, '--json').status, 0);
});

test('explicit read-only questions need no setup in an unconfigured repository', (t) => {
  const root = fixture(t, false);
  const result = guide(root, 'Explain only the inventory module');
  assert.equal(result.nextAction.id, 'inspect-and-answer');
  assert.equal(result.route.level, 'L0');
  assert.deepEqual(result.preparation.files, []);
  assert.deepEqual(result.clients, []);
  assert.deepEqual(fs.readdirSync(root), []);
  assert.equal(guide(root, 'Explain only the module but add inventory business rules').status, 'needs-setup');
  assert.equal(guide(root, 'Explain only the inventory module', '--paths', 'src/inventory.mjs').status, 'needs-setup');
});

test('business task guide previews scoped gaps without generating drafts or changing selected clients', (t) => {
  const root = fixture(t);
  const before = fs.readdirSync(root, { recursive: true });
  const result = guide(root, 'Add inventory business rules', '--paths', 'src/inventory.mjs');
  assert.equal(result.route.level, 'L2');
  assert.deepEqual(result.clients, ['codex', 'cursor']);
  assert.equal(result.status, 'needs-content');
  assert.equal(result.preparation.files.find((file) => file.id === 'ba').path, 'docs/changes/STOCK/ba.md');
  assert.equal(result.assessment.readiness, 'needs-content');
  assert.equal(result.assessment.acceptance, 'not-assessed');
  assert.equal(result.execution, 'not-run');
  assert.equal(result.readOnly, true);
  assert.deepEqual(fs.readdirSync(root, { recursive: true }), before);
});

test('repeated task guide retains owner documents and identifies their actual content gaps', (t) => {
  const root = fixture(t);
  const first = guide(root, 'Add inventory business rules');
  const ba = path.join(root, first.preparation.files.find((file) => file.id === 'ba').path);
  fs.mkdirSync(path.dirname(ba), { recursive: true });
  fs.writeFileSync(ba, '# Owner draft\nTODO: confirm actors');
  const next = guide(root, 'Add inventory business rules');
  assert.equal(next.preparation.files.find((file) => file.id === 'ba').action, 'keep');
  assert.ok(next.assessment.findings.some((finding) => finding.path === 'docs/changes/STOCK/ba.md' && finding.code === 'placeholder'));
  assert.deepEqual(next.preparation.files.map((file) => file.path), first.preparation.files.map((file) => file.path));
  assert.equal(fs.readFileSync(ba, 'utf8'), '# Owner draft\nTODO: confirm actors');
});

test('read-only tasks select no BA or test ceremony and do not imply verified code', (t) => {
  const root = fixture(t);
  const result = guide(root, 'Explain only the inventory module');
  assert.equal(result.route.level, 'L0');
  assert.deepEqual(result.preparation.files, []);
  assert.equal(result.assessment.readiness, 'not-required');
  assert.equal(result.nextAction.id, 'inspect-and-answer');
  assert.equal(result.verification, 'unverified');
});

test('UI tasks reference the existing design instead of creating a duplicate', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/design-system.md'), '# Design\nOriginal component tokens');
  const result = guide(root, 'Add inventory page');
  assert.equal(result.preparation.references.find((file) => file.id === 'product-design').path, 'docs/design-system.md');
  assert.equal(result.preparation.files.some((file) => ['product-design', 'visual-preview'].includes(file.id)), false);
});

test('Chinese human guide leads with a next action and retains explicit unverified boundaries', (t) => {
  const root = fixture(t);
  const result = invoke(root, '--text', '新增库存业务规则', '--scope', 'STOCK', '--locale', 'zh-CN');
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /下一步/);
  assert.match(result.stdout, /未执行/);
  assert.match(result.stdout, /L2/);
  assert.match(result.stdout, /docs\/changes\/STOCK\/ba.md/);
});

test('missing scope and unsafe scope reject task handoff rather than creating implicit state', (t) => {
  const root = fixture(t);
  assert.notEqual(invoke(root, '--text', 'Add business rules', '--json').status, 0);
  assert.notEqual(invoke(root, '--text', 'Add business rules', '--scope', '../escape', '--json').status, 0);
});

test('saved base choices stay setup-only until governance is applied', (t) => {
  const root = fixture(t, false);
  fs.writeFileSync(path.join(root, 'aicg.config.json'), JSON.stringify({ clients: ['cursor'], interactionLanguage: 'en' }));
  const result = guide(root, 'Add inventory business rules');
  assert.equal(result.status, 'needs-setup');
  assert.equal(result.phase, 'configured');
  assert.equal(result.nextAction.id, 'apply-existing-config');
  assert.deepEqual(result.clients, ['cursor']);
  assert.equal(result.route, null);
});

test('L1 and bounded bugfix paths omit business documents and preserve opt-in workflow defaults', (t) => {
  const root = fixture(t);
  const light = guide(root, 'Correct spelling', '--paths', 'docs/guide.md');
  assert.equal(light.route.level, 'L1');
  assert.deepEqual(light.preparation.files.map((file) => file.id), ['verification-report']);
  const bug = guide(root, 'Fix inventory count', '--paths', 'src/inventory.mjs', '--task-kind', 'bugfix', '--bugfix', JSON.stringify({ reproducible: true, boundedFix: true, publicContract: false, behaviorBeyondDefect: false, dataMigration: false }));
  assert.equal(bug.route.level, 'L1.5');
  assert.equal(bug.preparation.files.some((file) => ['ba', 'development-plan', 'product-design'].includes(file.id)), false);
  assert.deepEqual(bug.delivery.defaults, { worktree: false, multiAgent: false, mandatoryTdd: false });
});

test('OpenSpec task handoff references the exact existing change rather than creating second authorities', (t) => {
  const root = fixture(t);
  const integration = path.join(root, 'docs/ai/integrations/workflow-integrations.yaml');
  fs.mkdirSync(path.dirname(integration), { recursive: true });
  fs.writeFileSync(integration, 'authority:\n  active_change: openspec/changes/stock\n  implementation_task_list: openspec/changes/stock/tasks.md\n');
  fs.mkdirSync(path.join(root, 'openspec/changes/stock'), { recursive: true });
  fs.writeFileSync(path.join(root, 'openspec/changes/stock/proposal.md'), '# Scope\nOwner change');
  fs.writeFileSync(path.join(root, 'openspec/changes/stock/tasks.md'), '# Tasks\nExisting plan');
  const result = guide(root, 'Add inventory business rules');
  assert.deepEqual(result.preparation.references.map((file) => file.path), ['openspec/changes/stock/proposal.md', 'openspec/changes/stock/tasks.md']);
  assert.equal(result.preparation.files.some((file) => ['ba', 'development-plan'].includes(file.id)), false);
  assert.equal(fs.existsSync(path.join(root, 'docs/changes')), false);
});

test('corrected scoped content prepares a guide but cannot upgrade execution or owner acceptance', (t) => {
  const root = fixture(t);
  assert.equal(guide(root, 'Add inventory business rules').status, 'needs-content');
  const write = (relative, source) => {
    fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
    fs.writeFileSync(path.join(root, relative), source);
  };
  write('docs/changes/STOCK/ba.md', '# Inventory\n## Actors\nOperators reserve inventory.\n## Business rules\nSTOCK-001: Reject nonpositive quantity without changing stock.\n## Acceptance\nA zero reservation leaves the count unchanged and shows an error.\n');
  write('docs/changes/STOCK/development-plan.md', '# Plan\n## Module responsibilities\nInventory module validates quantity before saving.\n## Verification\nRun node --test test/inventory.test.mjs and confirm invalid requests do not change stock.\n');
  const manifest = defaultTestCaseManifest({ scope: 'STOCK' });
  manifest.shared.actors.operator = { role: 'Operator', goal: 'Reserve stock', authority: 'May reserve', familiarity: 'Daily', platform: 'Mac', accessibility: 'Keyboard' };
  manifest.shared.environments.mac = { platform: 'macOS', entry: 'local module', requirements: [] };
  manifest.cases = [{ id: 'STOCK-TC-001', title: 'Reject zero quantity', priority: 'P1', layer: 'unit', tags: ['smoke', 'negative_input'], sourceIds: ['STOCK-001'], ctx: { actor: 'operator', environment: 'mac', data: [] }, pre: [], steps: [{ do: 'input', target: 'quantity', see: ['Error shown, stock unchanged'] }], final: [], evidence: [], cleanup: [], automation: { kind: 'agent', runPolicy: 'manual-confirmation', driver: 'terminal' } }];
  manifest.coverageDimensions.smoke = { status: 'COVERED', caseIds: ['STOCK-TC-001'], rationale: 'Zero quantity is the scoped smoke case.' };
  write('docs/ai/testing/STOCK-test-cases.json', JSON.stringify(manifest));
  const result = guide(root, 'Add inventory business rules');
  assert.equal(result.status, 'prepared-for-agent', JSON.stringify(result.assessment));
  assert.equal(result.assessment.readiness, 'structurally-ready');
  assert.equal(result.assessment.acceptance, 'not-assessed');
  assert.equal(result.verification, 'unverified');
  assert.equal(result.approval, 'not-assessed');
  assert.equal(result.execution, 'not-run');
  assert.equal(result.nextAction.id, 'review-scope-and-proceed');
});

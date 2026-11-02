import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { planTask } from '../src/cli/commands/task-plan.mjs';
import { buildDeliveryCapabilityPlan, readDeliveryAuthority } from '../src/modules/governance/delivery-capabilities.mjs';

const plan = (level, options = {}) => buildDeliveryCapabilityPlan({ route: { level }, ...options });
const ids = (result) => result.artifacts.map((artifact) => artifact.id);

test('read-only and small changes avoid business documentation and bugfixes retain diagnosis', () => {
  assert.deepEqual(ids(plan('L0', { text: 'Explain the UI architecture' })), []);
  assert.deepEqual(ids(plan('L1', { text: 'Change a README' })), ['verification-report']);
  assert.deepEqual(ids(plan('L1.5', { text: 'Fix a reproducible crash' })), ['reproduction', 'root-cause', 'module-test-cases', 'verification-report']);
});

test('behavior changes plan BA and reusable tests while backend changes avoid UI artifacts', () => {
  const result = plan('L2', { text: 'Implement order validation', paths: ['src/orders/service.py'] });
  assert.deepEqual(ids(result), ['ba', 'development-plan', 'module-test-cases', 'verification-report']);
  assert.equal(result.routing, 'conditional');
  assert.deepEqual(result.defaults, { worktree: false, multiAgent: false, mandatoryTdd: false });
  assert.ok(result.capabilities.every((capability) => capability.reason));
  assert.ok(!ids(plan('L2', { text: 'Implement the backend cache component' })).includes('product-design'));
});

test('authority reading ignores nested provider settings and retains legacy ownership', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-capability-authority-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(readDeliveryAuthority(root), {});
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/ai/workflow-integrations.yaml'), 'providers:\n  active_change: openspec\nauthority:\n  active_change: project-native\n  implementation_task_list: openspec-change-governance # owner selected\nnext:\n  active_change: openspec\n');
  assert.deepEqual(readDeliveryAuthority(root), { active_change: 'project-native', implementation_task_list: 'openspec-change-governance' });
  const result = plan('L3', { authority: readDeliveryAuthority(root) });
  assert.equal(result.artifacts.find((entry) => entry.id === 'ba').mode, 'create-or-update');
  assert.equal(result.artifacts.find((entry) => entry.id === 'development-plan').mode, 'reference');
});

test('OpenSpec references retain the selected change and precise task document', () => {
  const result = plan('L3', { authority: { active_change: 'openspec/changes/add-orders', implementation_task_list: 'openspec/changes/add-orders/tasks.md' } });
  assert.equal(result.artifacts.find((entry) => entry.id === 'ba').path, 'openspec/changes/add-orders/proposal.md');
  assert.equal(result.artifacts.find((entry) => entry.id === 'technical-design').path, 'openspec/changes/add-orders/design.md');
  assert.equal(result.artifacts.find((entry) => entry.id === 'development-plan').path, 'openspec/changes/add-orders/tasks.md');
  assert.throws(() => plan('L2', { authority: { active_change: 'openspec/../../outside' } }), /repository-relative/);
});

test('authority reading rejects symlinks and oversized mappings before reading content', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-authority-bounds-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  const source = path.join(root, 'source.yaml');
  fs.writeFileSync(source, 'authority:\n  active_change: openspec\n');
  const target = path.join(root, 'docs/ai/workflow-integrations.yaml');
  fs.symlinkSync(source, target);
  assert.throws(() => readDeliveryAuthority(root), /symlink/);
  fs.unlinkSync(target);
  fs.writeFileSync(target, 'x'.repeat(65537));
  assert.throws(() => readDeliveryAuthority(root), /64 KiB/);
});

test('UI work inherits existing design documentation without inventing a competing preview', () => {
  const result = plan('L2', { text: 'Implement order page', paths: ['apps/web/src/orders.tsx'], config: { initialization: { lifecycle: 'existing' } }, scan: { files: ['docs/design-system.md'] } });
  const design = result.artifacts.find((artifact) => artifact.id === 'product-design');
  assert.equal(design.mode, 'reference');
  assert.equal(design.path, 'docs/design-system.md');
  assert.ok(!ids(result).includes('visual-preview'));
});

test('existing design inheritance consumes real scanner file records', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-design-inheritance-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'docs'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/design-system.md'), '# Original design system\n');
  const result = plan('L2', { text: 'Implement order page', scan: scanProject(root) });
  assert.equal(result.artifacts.find((entry) => entry.id === 'product-design').path, 'docs/design-system.md');
  assert.ok(!ids(result).includes('visual-preview'));
});

test('greenfield UI gets baseline and preview while high risk backend gets technical design only', () => {
  const ui = plan('L2', { text: 'Build a new dashboard', config: { initialization: { lifecycle: 'greenfield' } } });
  assert.equal(ui.lifecycle, 'greenfield');
  assert.ok(ids(ui).includes('product-design'));
  assert.ok(ids(ui).includes('visual-preview'));
  assert.ok(ids(ui).includes('technical-design'));
  const backend = plan('L3', { text: 'Migrate database authentication', paths: ['services/api/auth.go'] });
  assert.ok(ids(backend).includes('technical-design'));
  assert.ok(!ids(backend).includes('product-design'));
});

test('explicit OpenSpec ownership reuses requirements and tasks while detection alone does not select it', () => {
  const options = { scan: { externalWorkflows: ['openspec-change-governance'] } };
  assert.equal(plan('L2', options).artifacts[0].authority, 'project-native');
  const selected = plan('L3', { ...options, authority: { active_change: 'openspec', implementation_task_list: 'openspec' } });
  for (const id of ['ba', 'development-plan', 'technical-design']) {
    const artifact = selected.artifacts.find((entry) => entry.id === id);
    assert.equal(artifact.mode, 'reference');
    assert.equal(artifact.authority, 'openspec');
  }
  assert.throws(() => plan('L8'), /Unsupported task level/);
});

test('task route includes capability plan and honors the existing OpenSpec authority mapping', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-capability-route-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'standard' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  fs.mkdirSync(path.join(root, 'docs/ai/integrations'), { recursive: true });
  fs.writeFileSync(path.join(root, 'docs/ai/integrations/workflow-integrations.yaml'), 'schema_version: 1\nauthority:\n  active_change: openspec\n  implementation_task_list: "openspec"\n');
  const result = planTask(root, { text: 'Implement order validation', paths: ['src/orders/service.py'] });
  assert.ok(result.delivery, 'route exposes conditional delivery requirements');
  assert.equal(result.delivery.level, result.route.level);
  const artifacts = result.delivery.artifacts;
  assert.equal(artifacts.find((artifact) => artifact.id === 'ba').mode, 'reference');
  assert.equal(artifacts.find((artifact) => artifact.id === 'development-plan').authority, 'openspec');
  assert.equal(artifacts.find((artifact) => artifact.id === 'module-test-cases').authority, 'project-native');
  assert.equal(planTask(root, { text: 'Explain current design' }).delivery.artifacts.length, 0);
});

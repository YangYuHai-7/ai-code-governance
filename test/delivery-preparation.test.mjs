import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { prepareDeliveryArtifacts } from '../src/modules/governance/delivery-preparation.mjs';
import { buildDeliveryCapabilityPlan } from '../src/modules/governance/delivery-capabilities.mjs';
import { buildWorkflowArtifacts } from '../src/modules/governance/workflow.mjs';
import { buildGovernanceHandoff } from '../src/modules/governance/handoff-prompt.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-prepare-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('preparation previews and creates conditional drafts; repeated preparation retains owner edits', (t) => {
  const root = fixture(t);
  const delivery = buildDeliveryCapabilityPlan({ text: 'Add inventory page', route: { level: 'L2' }, config: { initialization: { lifecycle: 'greenfield' } } });
  const options = { delivery, scope: 'INVENTORY', text: 'Add inventory page' };
  assert.equal(prepareDeliveryArtifacts(root, options).status, 'preview');
  assert.deepEqual(fs.readdirSync(root), []);
  const result = prepareDeliveryArtifacts(root, { ...options, write: true });
  assert.equal(result.files.length, 8);
  assert.ok(result.files.some((file) => file.id === 'architecture'));
  assert.equal(result.readiness, 'unverified');
  const ba = path.join(root, 'docs/changes/INVENTORY/ba.md');
  fs.writeFileSync(ba, 'Owner requirements');
  assert.ok(prepareDeliveryArtifacts(root, { ...options, write: true }).files.every((file) => file.action === 'keep'));
  assert.equal(fs.readFileSync(ba, 'utf8'), 'Owner requirements');
  const cases = JSON.parse(fs.readFileSync(path.join(root, 'docs/ai/testing/INVENTORY-test-cases.json')));
  assert.deepEqual(cases.cases, []);
});
test('read-only work creates nothing and references never create a second canonical design', (t) => {
  const root = fixture(t);
  const light = buildDeliveryCapabilityPlan();
  assert.equal(prepareDeliveryArtifacts(root, { delivery: light, scope: 'READ', write: true }).files.length, 0);
  fs.mkdirSync(path.join(root, 'docs'));
  fs.writeFileSync(path.join(root, 'docs/design-system.md'), 'Existing tokens');
  const delivery = buildDeliveryCapabilityPlan({ text: 'Add page', route: { level: 'L2' }, scan: { files: ['docs/design-system.md'] } });
  const result = prepareDeliveryArtifacts(root, { delivery, scope: 'PAGE', text: 'Add page', write: true });
  assert.equal(result.references[0].path, 'docs/design-system.md');
  assert.equal(result.files.some((file) => file.id === 'product-design' || file.id === 'visual-preview'), false);
});
test('unsafe paths, missing authority and link ancestors fail before any drafts are written', (t) => {
  const root = fixture(t);
  const delivery = buildDeliveryCapabilityPlan({ route: { level: 'L2' } });
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery, scope: '../BAD', write: true }));
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery, scope: 'SAFE', caseRoot: '../escape', write: true }));
  assert.deepEqual(fs.readdirSync(root), []);
  const reference = { level: 'L2', artifacts: [{ id: 'ba', mode: 'reference', path: 'missing.md' }] };
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery: reference, scope: 'SAFE', write: true }), /Missing authoritative/);
  fs.symlinkSync(os.tmpdir(), path.join(root, 'docs'));
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery, scope: 'SAFE', write: true }));
});
test('workflow and handoff expose dynamic preparation and reusable cases in both languages', () => {
  for (const language of ['en', 'zh-CN']) {
    const config = { artifactLanguage: language, interactionLanguage: language };
    assert.match(buildWorkflowArtifacts(config).artifacts[0].content, /delivery prepare/);
    assert.match(buildWorkflowArtifacts(config).artifacts[0].content, /imports/);
    assert.match(buildGovernanceHandoff({ root: '/sample/member-app', config }).prompt, /delivery prepare/);
  }
});

test('preparation rejects directories as authority and case-variant git metadata before writes', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'existing-design'));
  const delivery = { level: 'L2', artifacts: [{ id: 'product-design', mode: 'reference', path: 'existing-design' }] };
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery, scope: 'SAFE', write: true }), /regular file/);
  const native = buildDeliveryCapabilityPlan({ route: { level: 'L2' } });
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery: native, scope: 'SAFE', caseRoot: '.GIT/cases', write: true }), /safe repository-relative/);
  assert.deepEqual(fs.readdirSync(root), ['existing-design']);
});

test('CLI preparation honors markdown-plus-json and preserves both configured test artifacts on retry', (t) => {
  const root = fixture(t);
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  config.testing = { ...config.testing, caseFormat: 'markdown-plus-json', caseRoot: 'qa/modules' };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const args = [path.resolve('bin/aicg.js'), 'delivery', 'prepare', root, '--scope', 'STOCK', '--text', 'Add inventory business workflow', '--yes'];
  const first = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(first.status, 0, first.stderr);
  const execution = path.join(root, 'qa/modules/STOCK-execution.json');
  const baseline = path.join(root, 'qa/modules/STOCK-test-cases.md');
  assert.equal(fs.existsSync(execution), true);
  assert.equal(JSON.parse(fs.readFileSync(execution, 'utf8')).schemaVersion, 2);
  assert.match(fs.readFileSync(baseline, 'utf8'), /STOCK-execution.json/);
  fs.writeFileSync(baseline, 'Owner-authored test cases');
  fs.writeFileSync(execution, 'Owner-authored manifest');
  assert.equal(spawnSync(process.execPath, args, { encoding: 'utf8' }).status, 0);
  assert.equal(fs.readFileSync(baseline, 'utf8'), 'Owner-authored test cases');
  assert.equal(fs.readFileSync(execution, 'utf8'), 'Owner-authored manifest');
});

test('markdown baseline destination is prevalidated before creating any preparation artifacts', (t) => {
  const root = fixture(t);
  fs.mkdirSync(path.join(root, 'qa/STOCK-test-cases.md'), { recursive: true });
  const delivery = buildDeliveryCapabilityPlan({ route: { level: 'L2' } });
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery, scope: 'STOCK', caseRoot: 'qa', caseFormat: 'markdown-plus-json', write: true }), /regular file/);
  assert.equal(fs.existsSync(path.join(root, 'docs')), false);
  assert.deepEqual(fs.readdirSync(path.join(root, 'qa')), ['STOCK-test-cases.md']);
});

test('provider-only OpenSpec authority requires a specific change before preparation writes', (t) => {
  const root = fixture(t);
  const delivery = buildDeliveryCapabilityPlan({ route: { level: 'L2' }, authority: { active_change: 'openspec', implementation_task_list: 'openspec' } });
  assert.equal(delivery.artifacts.find((entry) => entry.id === 'ba').authority, 'openspec');
  assert.throws(() => prepareDeliveryArtifacts(root, { delivery, scope: 'ORDERS', write: true }), /OpenSpec authority is unresolved.*specific change/);
  assert.deepEqual(fs.readdirSync(root), []);
});

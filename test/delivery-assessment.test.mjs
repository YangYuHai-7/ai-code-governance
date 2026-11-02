import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { prepareDeliveryArtifacts } from '../src/modules/governance/delivery-preparation.mjs';
import { assessDeliveryArtifacts } from '../src/modules/governance/delivery-assessment.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { defaultTestCaseManifest } from '../src/modules/testing/index.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-assess-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
const delivery = { level: 'L2', artifacts: ['ba', 'development-plan', 'product-design', 'module-test-cases', 'verification-report'].map((id) => ({ id, mode: 'create-or-update' })) };
const options = { delivery, scope: 'MEMBERS', text: 'Add member page' };
function write(root, relative, content) {
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
}
const ba = '# Members\n\n## Actors and permissions\nOperators may add members; visitors cannot.\n\n## Business rules\nREQ-MEM-1: A member name cannot be blank.\n\n## Acceptance criteria\nSubmitting a blank name shows an inline error and leaves the list unchanged.\n';
const plan = '# Implementation\n\n## Module and file responsibilities\nMember module: `src/members.js` validates names before storing a record.\n\n## Verification commands and expected results\nRun `node --test test/members.test.js`; blank names produce no record and all cases pass.\n';

test('fresh generated scaffolds and empty cases cannot count as prepared content', (t) => {
  const root = fixture(t);
  prepareDeliveryArtifacts(root, { ...options, write: true });
  const before = fs.readFileSync(path.join(root, 'docs/changes/MEMBERS/ba.md'));
  const result = assessDeliveryArtifacts(root, options);
  assert.equal(result.readiness, 'needs-content');
  assert.ok(result.findings.some((finding) => finding.code === 'placeholder'));
  assert.ok(result.findings.some((finding) => finding.code === 'empty-cases'));
  assert.equal(result.acceptance, 'not-assessed');
  assert.deepEqual(fs.readFileSync(path.join(root, 'docs/changes/MEMBERS/ba.md')), before);
});

test('copying a filled generic body into distinct artifacts is reported', (t) => {
  const root = fixture(t);
  prepareDeliveryArtifacts(root, { ...options, write: true });
  for (const id of ['ba', 'product-design', 'development-plan']) write(root, `docs/changes/MEMBERS/${id}.md`, `# ${id}\n\nImplemented according to source and tests.\n`);
  const result = assessDeliveryArtifacts(root, options);
  assert.ok(result.findings.some((finding) => finding.code === 'duplicate-body'));
  assert.ok(result.findings.some((finding) => finding.code === 'missing-actors'));
  assert.ok(result.findings.some((finding) => finding.code === 'missing-verification'));
});

test('a scoped BA and plan pass structural review without being called accepted', (t) => {
  const root = fixture(t);
  const selected = { ...delivery, artifacts: delivery.artifacts.filter((entry) => ['ba', 'development-plan', 'verification-report'].includes(entry.id)) };
  write(root, 'docs/changes/MEMBERS/ba.md', ba);
  write(root, 'docs/changes/MEMBERS/development-plan.md', plan);
  const result = assessDeliveryArtifacts(root, { ...options, delivery: selected });
  assert.equal(result.readiness, 'structurally-ready', JSON.stringify(result));
  assert.equal(result.acceptance, 'not-assessed');
  assert.match(result.limitations.join(' '), /authenticity/);
  assert.equal(result.artifacts.some((entry) => entry.id === 'verification-report'), false);
});

test('design inheritance uses original authority and rejects missing local evidence links', (t) => {
  const root = fixture(t);
  const selected = { level: 'L2', artifacts: [{ id: 'product-design', mode: 'reference', path: 'docs/design-system.md' }] };
  write(root, 'docs/design-system.md', '# Existing design\n\n## Tokens\nColor #123456; spacing 8px; labels use 16px text.\n\n## Components and states\nInputs display validation errors inline; buttons expose focus rings.\n');
  assert.equal(assessDeliveryArtifacts(root, { ...options, delivery: selected }).readiness, 'structurally-ready');
  write(root, 'docs/design-system.md', '# Design\n\nUse [source](../src/missing.css).\n');
  assert.ok(assessDeliveryArtifacts(root, { ...options, delivery: selected }).findings.some((entry) => entry.code === 'missing-source'));
  assert.equal(fs.existsSync(path.join(root, 'docs/changes')), false);
});

test('light routes need no documents; malformed scope and symlink evidence are refused', (t) => {
  const root = fixture(t);
  assert.equal(assessDeliveryArtifacts(root, { scope: 'READ', delivery: { level: 'L0', artifacts: [] } }).readiness, 'not-required');
  assert.throws(() => assessDeliveryArtifacts(root, { ...options, scope: '../BAD' }));
  write(root, 'outside.md', ba);
  fs.mkdirSync(path.join(root, 'docs/changes/MEMBERS'), { recursive: true });
  fs.symlinkSync(path.join(root, 'outside.md'), path.join(root, 'docs/changes/MEMBERS/ba.md'));
  assert.throws(() => assessDeliveryArtifacts(root, options), /symlink|link/i);
});

test('CLI assessment stays report-only by default and enforce returns failure for drafts', (t) => {
  const root = fixture(t);
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  const before = fs.readdirSync(root);
  const args = [path.resolve('bin/aicg.js'), 'delivery', 'assess', root, '--scope', 'MEMBERS', '--text', 'Add member business workflow'];
  const result = spawnSync(process.execPath, args, { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).readiness, 'needs-content');
  assert.equal(spawnSync(process.execPath, [...args, '--enforce'], { encoding: 'utf8' }).status, 1);
  assert.deepEqual(fs.readdirSync(root), before);
  assert.equal(fs.existsSync(path.join(root, 'docs/changes')), false);
});

test('case source IDs must resolve in the selected BA and context imports stay validated', (t) => {
  const root = fixture(t);
  write(root, 'docs/changes/MEMBERS/ba.md', ba);
  const selected = { level: 'L2', artifacts: delivery.artifacts.filter((entry) => ['ba', 'module-test-cases'].includes(entry.id)) };
  const manifest = defaultTestCaseManifest({ scope: 'MEMBERS' });
  manifest.shared.actors.reader = { role: 'Operator', goal: 'Register a member', authority: 'May add', familiarity: 'Daily', platform: 'Mac', accessibility: 'Keyboard' };
  manifest.shared.environments.mac = { platform: 'macOS', entry: 'http://localhost:3000', requirements: [] };
  manifest.cases = [{ id: 'MEMBERS-TC-001', title: 'Reject blank member name', priority: 'P1', layer: 'unit', tags: ['negative_input'], sourceIds: ['REQ-MISSING'], ctx: { actor: 'reader', environment: 'mac', data: [] }, pre: [], steps: [{ do: 'input', target: 'Name', see: ['Error shown'] }], final: [], evidence: [], cleanup: [], automation: { kind: 'agent', runPolicy: 'manual-confirmation', driver: 'browser' } }];
  manifest.cases[0].tags.push('smoke');
  manifest.coverageDimensions.smoke = { status: 'COVERED', caseIds: ['MEMBERS-TC-001'], rationale: 'Invalid name is the scoped smoke case.' };
  const save = () => write(root, 'docs/ai/testing/MEMBERS-test-cases.json', JSON.stringify(manifest));
  save();
  assert.ok(assessDeliveryArtifacts(root, { ...options, delivery: selected }).findings.some((entry) => entry.code === 'unresolved-requirement'));
  manifest.cases[0].sourceIds = ['REQ-MEM-1'];
  save();
  assert.equal(assessDeliveryArtifacts(root, { ...options, delivery: selected }).readiness, 'structurally-ready');
  manifest.cases[0].tags = ['negative_input'];
  save();
  assert.ok(assessDeliveryArtifacts(root, { ...options, delivery: selected }).findings.some((entry) => entry.code === 'invalid-cases' && /Smoke coverage/.test(entry.message)));
  manifest.cases[0].tags.push('smoke');
  write(root, 'docs/changes/MEMBERS/ba.md', ba.replace('# Members', '# Todo title validation').replace('REQ-MEM-1', 'TODO-001'));
  manifest.cases[0].sourceIds = ['TODO-001'];
  save();
  assert.equal(assessDeliveryArtifacts(root, { ...options, delivery: selected }).readiness, 'structurally-ready');
  manifest.imports = [{ path: 'qa/context.json', sha256: '0'.repeat(64) }];
  write(root, 'qa/context.json', JSON.stringify({ schemaVersion: 1, shared: { actors: {}, environments: {}, data: {} } }));
  save();
  assert.ok(assessDeliveryArtifacts(root, { ...options, delivery: selected }).findings.some((entry) => entry.code === 'invalid-cases' && /stale/.test(entry.message)));
});

test('domain requirement IDs work without a fixed prefix; incidental mentions are not definitions', (t) => {
  const root = fixture(t);
  const selected = { level: 'L2', artifacts: [{ id: 'ba', mode: 'create-or-update' }] };
  write(root, 'docs/changes/MEMBERS/ba.md', ba.replace('REQ-MEM-1:', '**MEMBER_NAME**:'));
  assert.equal(assessDeliveryArtifacts(root, { ...options, delivery: selected }).readiness, 'structurally-ready');
  write(root, 'docs/changes/MEMBERS/ba.md', ba.replace('REQ-MEM-1:', 'The test refers to MEMBER_NAME;'));
  assert.ok(assessDeliveryArtifacts(root, { ...options, delivery: selected }).findings.some((entry) => entry.code === 'missing-requirement-ids'));
});

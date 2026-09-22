import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { checkProject } from '../src/checker.mjs';
import { sha256 } from '../src/shared/index.mjs';
import { buildProjectionReceipt, PROJECTION_TEMPLATE_VERSION } from '../src/modules/governance/projections.mjs';

const COPILOT = 'github-copilot';
const COPILOT_ENTRY = '.github/copilot-instructions.md';
const COPILOT_SKILL = '.github/skills/generic-unknown/SKILL.md';
const COPILOT_CANONICAL_SKILL = 'docs/ai/skills/generic-unknown/SKILL.md';
const RUNTIME_PATH = '.ai-governance/state/client-runtime-verifications.json';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-checker-${name}-`));
}

/** Generate a real Copilot project on disk: projection receipts, adapters and canonical seeds. */
function initializeCopilotFixture(root) {
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: [COPILOT], stacks: ['generic-unknown'] };
  const artifacts = buildArtifacts(config, scan);
  applyArtifactPlan(root, planArtifacts(root, artifacts));
  return config;
}

function readManifest(root) {
  return JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
}

function copilotResult(root) {
  const result = checkProject(scanProject(root));
  return { result, coverage: result.clientCoverage.find((entry) => entry.clientId === COPILOT) };
}

function writeRuntimeReceipt(root, overrides = {}) {
  const entry = (readManifest(root).projections ?? [])
    .find((item) => item.clientId === COPILOT && item.surfaceId === 'repository-instructions');
  const evidence = 'docs/ai/evidence/runtime/copilot-cli.json';
  fs.mkdirSync(path.dirname(path.join(root, evidence)), { recursive: true });
  fs.writeFileSync(path.join(root, evidence), JSON.stringify({ probe: 'copilot-cli', observed: 'repository-instructions loaded' }));
  fs.mkdirSync(path.dirname(path.join(root, RUNTIME_PATH)), { recursive: true });
  fs.writeFileSync(path.join(root, RUNTIME_PATH), JSON.stringify({
    schema_version: 1,
    receipts: [{
      clientId: COPILOT,
      surface: 'repository-instructions',
      canonicalSha256: entry.canonicalSha256,
      projectionSha256: entry.projectionSha256,
      templateVersion: entry.templateVersion,
      timestamp: new Date().toISOString(),
      evidence,
      ...overrides,
    }],
  }, null, 2));
  return entry;
}

test('buildProjectionReceipt binds canonical and projection hashes to the template version', () => {
  const receipt = buildProjectionReceipt({
    clientId: 'example',
    surfaceId: 'repository-instructions',
    path: 'EXAMPLE.md',
    canonicalPath: 'AGENTS.md',
    content: 'projected',
    canonicalContent: 'canonical',
    templateVersion: PROJECTION_TEMPLATE_VERSION,
  });
  assert.deepEqual(receipt, {
    clientId: 'example',
    surfaceId: 'repository-instructions',
    path: 'EXAMPLE.md',
    canonicalPath: 'AGENTS.md',
    canonicalSha256: sha256('canonical'),
    projectionSha256: sha256('projected'),
    templateVersion: PROJECTION_TEMPLATE_VERSION,
  });
});

test('structural pass records projection receipts without claiming runtime verification', (context) => {
  const root = fixture('structural');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);

  const manifest = readManifest(root);
  assert.ok(Array.isArray(manifest.projections));
  const receipts = manifest.projections.filter((entry) => entry.clientId === COPILOT);
  const entryReceipt = receipts.find((entry) => entry.path === COPILOT_ENTRY);
  const skillReceipt = receipts.find((entry) => entry.path === COPILOT_SKILL);
  assert.ok(entryReceipt, 'copilot entry projection receipt is recorded');
  assert.ok(skillReceipt, 'copilot skill adapter projection receipt is recorded');
  for (const receipt of [entryReceipt, skillReceipt]) {
    assert.equal(receipt.surfaceId, receipt.path === COPILOT_ENTRY ? 'repository-instructions' : 'skills');
    assert.match(receipt.canonicalSha256, /^[a-f0-9]{64}$/);
    assert.match(receipt.projectionSha256, /^[a-f0-9]{64}$/);
    assert.equal(receipt.templateVersion, PROJECTION_TEMPLATE_VERSION);
  }
  assert.equal(entryReceipt.canonicalPath, 'AGENTS.md');
  assert.equal(skillReceipt.canonicalPath, COPILOT_CANONICAL_SKILL);

  const { result, coverage } = copilotResult(root);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(coverage.declared, true);
  assert.equal(coverage.projected, true);
  assert.equal(coverage.checked, true);
  assert.equal(coverage.runtimeVerified, false);
  assert.ok(coverage.findings.some((finding) => /runtime verification is not recorded/.test(finding)));
});

test('tampered Copilot projection fails checked without changing declared state', (context) => {
  const root = fixture('drift');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  fs.appendFileSync(path.join(root, COPILOT_ENTRY), 'drift\n');

  const { result, coverage } = copilotResult(root);
  assert.equal(coverage.declared, true);
  assert.equal(coverage.checked, false);
  assert.match(coverage.findings.join('\n'), /projection drift/);
  assert.equal(result.ok, false);
});

test('a missing Copilot entry projection reports a missing-projection finding', (context) => {
  const root = fixture('missing');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  fs.rmSync(path.join(root, COPILOT_ENTRY));

  const { coverage } = copilotResult(root);
  assert.equal(coverage.projected, true);
  assert.equal(coverage.checked, false);
  assert.match(coverage.findings.join('\n'), /missing projection .*copilot-instructions\.md/);
});

test('a linked Copilot entry is reported and cannot be managed', (context) => {
  const root = fixture('link-entry');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  const target = path.join(root, 'user-notes.md');
  fs.writeFileSync(target, '# user notes\n');
  fs.rmSync(path.join(root, COPILOT_ENTRY));
  fs.symlinkSync(target, path.join(root, COPILOT_ENTRY));

  const { coverage } = copilotResult(root);
  assert.equal(coverage.checked, false);
  const findings = coverage.findings.join('\n');
  assert.match(findings, /is a link|traverses link/);
  assert.match(findings, /cannot be managed/);
});

test('a linked Copilot Skill adapter is reported and cannot be managed', (context) => {
  const root = fixture('link-skill');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  const target = path.join(root, 'docs/ai/elsewhere-skill.md');
  fs.writeFileSync(target, '# elsewhere\n');
  fs.rmSync(path.join(root, COPILOT_SKILL));
  fs.symlinkSync(target, path.join(root, COPILOT_SKILL));

  const { coverage } = copilotResult(root);
  assert.equal(coverage.checked, false);
  const findings = coverage.findings.join('\n');
  assert.match(findings, /is a link|traverses link/);
  assert.match(findings, /cannot be managed/);
});

test('a tampered managed canonical Skill source is reported as a source mismatch', (context) => {
  const root = fixture('source');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  const manifest = readManifest(root);
  const managed = new Set((manifest.files ?? []).map((entry) => entry.path));
  const receipt = (manifest.projections ?? []).find((entry) => entry.clientId === COPILOT
    && entry.surfaceId === 'skills' && managed.has(entry.canonicalPath));
  assert.ok(receipt, 'the fixture exposes a managed canonical Skill');
  fs.appendFileSync(path.join(root, receipt.canonicalPath), '\ntampered canonical source\n');

  const { coverage } = copilotResult(root);
  assert.equal(coverage.checked, false);
  assert.match(coverage.findings.join('\n'), /source mismatch/);
});

test('an owner-edited canonical seed body does not break projection coverage', (context) => {
  const root = fixture('seed-edit');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  fs.appendFileSync(path.join(root, COPILOT_CANONICAL_SKILL), '\nProject-specific canonical guidance.\n');

  const { result, coverage } = copilotResult(root);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(coverage.checked, true);
  assert.equal(coverage.runtimeVerified, false);
});

test('a matching runtime receipt flips runtimeVerified true while checked stays independent', (context) => {
  const root = fixture('runtime-match');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  writeRuntimeReceipt(root);

  const { result, coverage } = copilotResult(root);
  assert.equal(result.ok, true, result.errors.join('; '));
  assert.equal(coverage.checked, true);
  assert.equal(coverage.runtimeVerified, true);
  assert.equal(coverage.findings.some((finding) => /runtime verification is not recorded/.test(finding)), false);
});

test('a mismatched runtime receipt hash keeps runtimeVerified false', (context) => {
  const root = fixture('runtime-mismatch');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  initializeCopilotFixture(root);
  writeRuntimeReceipt(root, { projectionSha256: '0'.repeat(64) });

  const { coverage } = copilotResult(root);
  assert.equal(coverage.checked, true);
  assert.equal(coverage.runtimeVerified, false);
  assert.ok(coverage.findings.some((finding) => /runtime verification is not recorded/.test(finding)));
});

test('a link at the runtime receipt store is a structural failure, never a verification claim', (context) => {
  const root = fixture('runtime-link');
  const outside = fixture('runtime-link-outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  initializeCopilotFixture(root);
  const evidence = path.join(outside, 'receipts.json');
  fs.writeFileSync(evidence, JSON.stringify({ schema_version: 1, receipts: [] }));
  fs.mkdirSync(path.dirname(path.join(root, RUNTIME_PATH)), { recursive: true });
  fs.symlinkSync(evidence, path.join(root, RUNTIME_PATH));

  const { result, coverage } = copilotResult(root);
  assert.equal(coverage.runtimeVerified, false);
  assert.equal(result.ok, false);
  assert.ok(result.errors.some((error) => error.includes(RUNTIME_PATH) && /link/.test(error)));
});

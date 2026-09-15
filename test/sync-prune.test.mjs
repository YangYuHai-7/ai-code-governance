import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { GENERATED_MARKER, MANIFEST_SCHEMA_VERSION, TEMPLATE_VERSION, TOOL_NAME } from '../src/constants.mjs';
import { planArtifacts, validateManifestRemovalAuthority } from '../src/modules/governance/index.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-sync-prune-${name}-`));
}

function sha256(content) {
  return createHash('sha256').update(content).digest('hex');
}

function writeManifest(root, manifest) {
  fs.mkdirSync(path.join(root, '.ai-governance'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-governance/manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
}

function run(args) {
  return spawnSync(process.execPath, [path.join(process.cwd(), 'bin/aicg.js'), ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
}

test('ordinary sync retains stale artifacts and foreign manifests have no removal authority', (context) => {
  const root = fixture('ordinary-retention');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stalePath = 'docs/ai/legacy-generated.md';
  const staleContent = `<!-- ${GENERATED_MARKER} -->\n# Legacy generated artifact\n`;
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  writeManifest(root, {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    templateVersion: TEMPLATE_VERSION,
    files: [{
      path: stalePath,
      ownership: 'full',
      kind: 'documentation',
      source: 'template:legacy-generated',
      sha256: sha256(staleContent),
    }],
  });

  const ordinary = planArtifacts(root, []);
  assert.equal(ordinary.operations.some((item) => item.remove), false);
  assert.deepEqual(ordinary.retained.map((item) => item.path), [stalePath]);

  const foreignManifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: 'Foreign Governance Tool',
    templateVersion: TEMPLATE_VERSION,
    files: [{
      path: stalePath,
      ownership: 'foreign',
      kind: 'documentation',
      sha256: sha256(staleContent),
    }],
  };
  const forged = validateManifestRemovalAuthority(root, foreignManifest);
  assert.equal(forged.trusted, false);
  assert.match(forged.errors.join('\n'), /generatedBy|source|ownership/);
});

test('explicit stale removal rejects a foreign manifest before planning deletes', (context) => {
  const root = fixture('foreign-removal');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stalePath = 'docs/ai/legacy-generated.md';
  const staleContent = `<!-- ${GENERATED_MARKER} -->\n# Legacy generated artifact\n`;
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  writeManifest(root, {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: 'Foreign Governance Tool',
    templateVersion: TEMPLATE_VERSION,
    files: [{
      path: stalePath,
      ownership: 'full',
      kind: 'documentation',
      source: 'template:legacy-generated',
      sha256: sha256(staleContent),
    }],
  });

  const plan = planArtifacts(root, [], { allowStaleRemoval: true });
  assert.equal(plan.operations.some((item) => item.remove), false);
  assert.deepEqual(plan.retained.map((item) => item.path), [stalePath]);
  assert.match(plan.conflicts.join('\n'), /generatedBy/);
});

test('trusted manifests retain explicit stale removal authority', (context) => {
  const root = fixture('trusted-removal');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stalePath = 'docs/ai/legacy-generated.md';
  const staleContent = `<!-- ${GENERATED_MARKER} -->\n# Legacy generated artifact\n`;
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  writeManifest(root, {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    templateVersion: TEMPLATE_VERSION,
    files: [{
      path: stalePath,
      ownership: 'full',
      kind: 'surface-verification-profiles',
      source: 'asset:surface-verification-contract',
      sha256: sha256(staleContent),
    }],
  });

  const plan = planArtifacts(root, [], { allowStaleRemoval: true });
  assert.deepEqual(plan.conflicts, []);
  assert.deepEqual(plan.retained, []);
  assert.equal(plan.operations.filter((item) => item.remove).length, 1);
});

test('force cannot authorize removal of a drifted stale artifact', (context) => {
  const root = fixture('drifted-removal');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stalePath = 'docs/ai/surface-verification-profiles.json';
  const original = `<!-- ${GENERATED_MARKER} -->\noriginal\n`;
  const drifted = `${original}user change\n`;
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), drifted);
  writeManifest(root, {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    templateVersion: TEMPLATE_VERSION,
    files: [{
      path: stalePath,
      ownership: 'full',
      kind: 'surface-verification-profiles',
      source: 'asset:surface-verification-contract',
      sha256: sha256(original),
    }],
  });

  const plan = planArtifacts(root, [], { allowStaleRemoval: true, force: true });
  assert.equal(plan.operations.some((item) => item.remove), false);
  assert.deepEqual(plan.retained.map((item) => item.path), [stalePath]);
  assert.match(plan.conflicts.join('\n'), /stale managed content changed/);
});

test('unknown or mismatched kind and source relationships have no removal authority', (context) => {
  const root = fixture('unknown-relation');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const stalePath = 'docs/ai/surface-verification-profiles.json';
  const staleContent = `<!-- ${GENERATED_MARKER} -->\nunknown relation\n`;
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    templateVersion: TEMPLATE_VERSION,
    files: [{
      path: stalePath,
      ownership: 'full',
      kind: 'mystery-kind',
      source: 'mystery-source',
      sha256: sha256(staleContent),
    }],
  };
  writeManifest(root, manifest);

  const authority = validateManifestRemovalAuthority(root, manifest);
  assert.equal(authority.trusted, false);
  assert.match(authority.errors.join('\n'), /kind|source|ownership/);
  const mismatched = structuredClone(manifest);
  mismatched.files[0].kind = 'adapter';
  mismatched.files[0].source = 'confirmed-decisions';
  assert.equal(validateManifestRemovalAuthority(root, mismatched).trusted, false);
  const plan = planArtifacts(root, [], { allowStaleRemoval: true });
  assert.equal(plan.operations.some((item) => item.remove), false);
  assert.deepEqual(plan.retained.map((item) => item.path), [stalePath]);
});

test('sync JSON reports retained stale artifacts without removing them', (context) => {
  const root = fixture('cli-retention');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialized = run(['init', root, '--yes', '--no-assist', '--clients', 'codex']);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const stalePath = 'docs/ai/legacy-generated.md';
  const staleContent = `<!-- ${GENERATED_MARKER} -->\n# Legacy generated artifact\n`;
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files.push({
    path: stalePath,
    ownership: 'full',
    kind: 'documentation',
    source: 'template:legacy-generated',
    sha256: sha256(staleContent),
  });
  writeManifest(root, manifest);

  const synced = run(['sync', root, '--dry-run']);
  assert.equal(synced.status, 0, synced.stderr || synced.stdout);
  const output = JSON.parse(synced.stdout);
  assert.ok(Array.isArray(output.changed));
  assert.deepEqual(output.retained, [stalePath]);
  assert.ok(fs.existsSync(path.join(root, stalePath)));
});

test('real sync preserves trusted retained provenance for the next sync', (context) => {
  const root = fixture('persistent-retention');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialized = run(['init', root, '--yes', '--no-assist', '--clients', 'codex']);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const stalePath = '.cursor/rules/ai-code-governance.mdc';
  const staleContent = `/* ${GENERATED_MARKER} */\nretained adapter\n`;
  fs.mkdirSync(path.dirname(path.join(root, stalePath)), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.files.push({
    path: stalePath,
    ownership: 'full',
    kind: 'adapter',
    source: 'docs/ai/rules/00_always.mdc',
    sha256: sha256(staleContent),
  });
  writeManifest(root, manifest);

  const first = run(['sync', root]);
  assert.equal(first.status, 0, first.stderr || first.stdout);
  const persisted = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(persisted.files.some((entry) => entry.path === stalePath));

  const second = run(['sync', root]);
  assert.equal(second.status, 0, second.stderr || second.stdout);
  const persistedAgain = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.ok(persistedAgain.files.some((entry) => entry.path === stalePath));

  const preview = run(['sync', root, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  assert.deepEqual(JSON.parse(preview.stdout).retained, [stalePath]);
});

test('real sync never launders foreign retained records into its trusted manifest', (context) => {
  const root = fixture('foreign-persistence');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const initialized = run(['init', root, '--yes', '--no-assist', '--clients', 'codex']);
  assert.equal(initialized.status, 0, initialized.stderr || initialized.stdout);

  const stalePath = '.cursor/rules/ai-code-governance.mdc';
  const staleContent = `/* ${GENERATED_MARKER} */\nforeign adapter\n`;
  fs.mkdirSync(path.dirname(path.join(root, stalePath)), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  manifest.generatedBy = 'Foreign Governance Tool';
  manifest.files.push({
    path: stalePath,
    ownership: 'full',
    kind: 'adapter',
    source: 'docs/ai/rules/00_always.mdc',
    sha256: sha256(staleContent),
  });
  writeManifest(root, manifest);

  const synced = run(['sync', root]);
  assert.equal(synced.status, 0, synced.stderr || synced.stdout);
  const persisted = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(persisted.generatedBy, TOOL_NAME);
  assert.equal(persisted.files.some((entry) => entry.path === stalePath), false);
  assert.ok(fs.existsSync(path.join(root, stalePath)));
});

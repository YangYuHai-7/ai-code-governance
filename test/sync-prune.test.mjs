import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { GENERATED_MARKER, MANIFEST_SCHEMA_VERSION, TEMPLATE_VERSION, TOOL_NAME, TOOL_VERSION } from '../src/constants.mjs';
import { planArtifacts, validateManifestRemovalAuthority } from '../src/modules/governance/index.mjs';
import { applyArtifactPlan } from '../src/managed-files.mjs';
import { managedContentHash } from '../src/modules/governance/manifest.mjs';
import { renderManagedBlock } from '../src/modules/governance/managed-block.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';

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

function snapshotTree(root) {
  const result = {};
  function visit(dir) {
    for (const name of fs.readdirSync(dir).sort()) {
      const absolute = path.join(dir, name);
      const stat = fs.lstatSync(absolute);
      const relative = path.relative(root, absolute);
      result[relative] = stat.isSymbolicLink() ? { link: fs.readlinkSync(absolute) }
        : stat.isDirectory() ? { directory: true, mode: stat.mode & 0o777 }
          : { bytes: fs.readFileSync(absolute).toString('base64'), mode: stat.mode & 0o777 };
      if (stat.isDirectory()) visit(absolute);
    }
  }
  visit(root);
  return result;
}

function legacyFixture(context, version = 2) {
  const root = fixture(`v${version}`);
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = { ...defaultConfig(scan), clients: ['codex'], clientSupport: { mode: 'selected', selectedClients: ['codex'], source: 'user' } };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
  manifest.templateVersion = version;
  const content = `/* ${GENERATED_MARKER} */\nlegacy adapter\n`;
  const relative = '.cursor/rules/ai-code-governance.mdc';
  fs.mkdirSync(path.dirname(path.join(root, relative)), { recursive: true });
  fs.writeFileSync(path.join(root, relative), content);
  manifest.files.push({ path: relative, ownership: 'full', kind: 'adapter', source: 'docs/ai/rules/00_always.mdc', sha256: sha256(content) });
  writeManifest(root, manifest);
  return { root, manifest, relative };
}

for (const version of [1, 2]) {
  test(`v${version} prune previews without writes and requires exact fresh approval`, (context) => {
    const { root, relative } = legacyFixture(context, version);
    const before = snapshotTree(root);
    const preview = run(['sync', root, '--prune', '--dry-run']);
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const output = JSON.parse(preview.stdout);
    assert.match(output.planHash, /^[a-f0-9]{64}$/);
    assert.ok(output.operations.some((item) => item.path === relative && item.action === 'remove-owned'));
    assert.deepEqual(output.manualCleanupCandidates, []);
    assert.deepEqual(snapshotTree(root), before);
    for (const flags of [[], ['--approve', 'wrong'], ['--force'], ['--force', '--approve', 'wrong']]) {
      assert.equal(run(['sync', root, '--prune', ...flags]).status, 2);
      assert.deepEqual(snapshotTree(root), before);
    }
    assert.equal(run(['sync', root, '--approve', output.planHash]).status, 2);
    assert.deepEqual(snapshotTree(root), before);
    const approved = run(['sync', root, '--prune', '--approve', output.planHash]);
    assert.equal(approved.status, 0, approved.stderr || approved.stdout);
    assert.equal(fs.existsSync(path.join(root, relative)), false);
    const updated = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
    assert.equal(updated.schemaVersion, 1);
    assert.equal(updated.templateVersion, 3);
  });

  test(`v${version} ordinary sync retains historical provenance with warning`, (context) => {
    const { root, relative, manifest } = legacyFixture(context, version);
    const before = fs.readFileSync(path.join(root, relative));
    const synced = run(['sync', root]);
    assert.equal(synced.status, 0, synced.stderr || synced.stdout);
    assert.match(synced.stdout + synced.stderr, /retained.*historical|historical.*retained/i);
    assert.deepEqual(fs.readFileSync(path.join(root, relative)), before);
    const updated = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
    assert.deepEqual(updated.files.find((item) => item.path === relative), manifest.files.find((item) => item.path === relative));
  });
}

for (const changedInput of ['config', 'manifest', 'managed', 'source', 'mode', 'deep-source']) {
  test(`prune invalidates approval after ${changedInput} changes without writing`, (context) => {
    const { root, relative } = legacyFixture(context);
    const preview = run(['sync', root, '--prune', '--dry-run']);
    assert.equal(preview.status, 0, preview.stderr || preview.stdout);
    const { planHash } = JSON.parse(preview.stdout);
    if (changedInput === 'config') fs.appendFileSync(path.join(root, '.ai-governance/config.json'), '\n');
    if (changedInput === 'manifest') fs.appendFileSync(path.join(root, '.ai-governance/manifest.json'), '\n');
    if (changedInput === 'managed') fs.appendFileSync(path.join(root, relative), 'user edit\n');
    if (changedInput === 'source') fs.writeFileSync(path.join(root, 'source.js'), 'export const value = 1;\n');
    if (changedInput === 'mode') fs.chmodSync(path.join(root, relative), 0o600);
    if (changedInput === 'deep-source') {
      fs.mkdirSync(path.join(root, 'a/b/c/d/e/f'), { recursive: true });
      fs.writeFileSync(path.join(root, 'a/b/c/d/e/f/source.js'), 'export const value = 1;\n');
    }
    const before = snapshotTree(root);
    const result = run(['sync', root, '--prune', '--force', '--approve', planHash]);
    assert.equal(result.status, 2, result.stderr || result.stdout);
    assert.deepEqual(snapshotTree(root), before);
  });
}

test('prune reports stale seed files as manual cleanup candidates and preserves them', (context) => {
  const { root } = legacyFixture(context);
  const relative = 'docs/ai/lifecycle.md';
  fs.writeFileSync(path.join(root, relative), '# User lifecycle notes\n');
  const before = snapshotTree(root);
  const preview = run(['sync', root, '--prune', '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const output = JSON.parse(preview.stdout);
  assert.ok(output.manualCleanupCandidates.some((item) => item.path === relative && item.ownership === 'seed'));
  assert.equal(output.operations.some((item) => item.path === relative && item.action === 'remove-owned'), false);
  assert.deepEqual(snapshotTree(root), before);
  const approved = run(['sync', root, '--prune', '--approve', output.planHash]);
  assert.equal(approved.status, 0, approved.stderr || approved.stdout);
  assert.equal(fs.readFileSync(path.join(root, relative), 'utf8'), '# User lifecycle notes\n');
});

test('prune removes only unchanged managed blocks and retains CRLF user content', (context) => {
  const { root, manifest } = legacyFixture(context);
  const block = renderManagedBlock('@AGENTS.md').replaceAll('\n', '\r\n');
  const current = `# User instructions\r\n\r\n${block}\r\nKeep this footer.\r\n`;
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), current);
  manifest.files.push({ path: 'CLAUDE.md', ownership: 'managed-block', kind: 'adapter', source: 'AGENTS.md', sha256: managedContentHash(current, 'managed-block') });
  writeManifest(root, manifest);
  const preview = run(['sync', root, '--prune', '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const output = JSON.parse(preview.stdout);
  assert.ok(output.operations.some((item) => item.path === 'CLAUDE.md' && item.action === 'update-managed-block'));
  const approved = run(['sync', root, '--prune', '--approve', output.planHash]);
  assert.equal(approved.status, 0, approved.stderr || approved.stdout);
  assert.equal(fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8'), '# User instructions\r\n\r\n\r\nKeep this footer.\r\n');
});

test('checker failure rolls approved removals back including manifest bytes and file modes', (context) => {
  const { root, relative } = legacyFixture(context);
  fs.chmodSync(path.join(root, relative), 0o600);
  const before = snapshotTree(root);
  const config = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/config.json'), 'utf8'));
  const plan = planArtifacts(root, buildArtifacts(config, scanProject(root)), { allowStaleRemoval: true });
  assert.ok(plan.operations.some((item) => item.path === relative && item.remove));
  assert.throws(() => applyArtifactPlan(root, plan, { transactional: true, verify: () => ({ ok: false }) }), /Post-apply verification failed/);
  assert.deepEqual(snapshotTree(root), before);
});

for (const untrusted of ['foreign', 'future-template', 'future-tool', 'missing-tool', 'unknown-source', 'prototype-kind', 'wrong-path', 'duplicate-path', 'seed-forgery']) {
  test(`prune rejects ${untrusted} provenance with zero writes`, (context) => {
    const { root, manifest, relative } = legacyFixture(context);
    if (untrusted === 'foreign') manifest.generatedBy = 'foreign';
    if (untrusted === 'future-template') manifest.templateVersion = 999;
    if (untrusted === 'future-tool') manifest.toolVersion = '999.0.0';
    if (untrusted === 'missing-tool') delete manifest.toolVersion;
    if (untrusted === 'unknown-source') manifest.files.at(-1).source = 'mystery-source';
    if (untrusted === 'prototype-kind') manifest.files.at(-1).kind = 'toString';
    if (untrusted === 'duplicate-path') manifest.files.push({ ...manifest.files.at(-1) });
    if (untrusted === 'wrong-path' || untrusted === 'seed-forgery') {
      const wrongPath = untrusted === 'wrong-path' ? 'user-notes.md' : 'docs/ai/lifecycle.md';
      fs.copyFileSync(path.join(root, relative), path.join(root, wrongPath));
      manifest.files.at(-1).path = wrongPath;
    }
    writeManifest(root, manifest);
    const before = snapshotTree(root);
    const preview = run(['sync', root, '--prune', '--dry-run', '--force']);
    assert.equal(preview.status, 2, preview.stderr || preview.stdout);
    assert.deepEqual(snapshotTree(root), before);
  });
}

test('trusted historical JSON full artifacts can be pruned without a comment marker', (context) => {
  const { root, manifest } = legacyFixture(context);
  const relative = 'docs/ai/surface-verification-profiles.json';
  const content = '{"schemaVersion":1,"profiles":[]}\n';
  fs.writeFileSync(path.join(root, relative), content);
  manifest.files.push({ path: relative, ownership: 'full', kind: 'surface-verification-profiles', source: 'asset:surface-verification-contract', sha256: sha256(content) });
  writeManifest(root, manifest);
  const plan = planArtifacts(root, [], { allowStaleRemoval: true });
  assert.deepEqual(plan.conflicts, []);
  assert.ok(plan.operations.some((item) => item.path === relative && item.remove));
});

test('drifted managed blocks cannot be pruned even with force and retain user text', (context) => {
  const { root, manifest } = legacyFixture(context);
  const original = renderManagedBlock('@AGENTS.md');
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), `User text\n${original.replace('@AGENTS.md', 'user edit')}\n`);
  manifest.files.push({ path: 'CLAUDE.md', ownership: 'managed-block', kind: 'adapter', source: 'AGENTS.md', sha256: managedContentHash(original, 'managed-block') });
  writeManifest(root, manifest);
  const before = snapshotTree(root);
  const preview = run(['sync', root, '--prune', '--dry-run', '--force']);
  assert.equal(preview.status, 2, preview.stderr || preview.stdout);
  assert.match(preview.stderr, /stale managed content changed/);
  assert.deepEqual(snapshotTree(root), before);
});

test('prune cannot remove a stale symlink ancestor even with migrate-links', (context) => {
  const { root, relative } = legacyFixture(context);
  const originalDirectory = path.join(root, '.cursor/rules');
  const movedDirectory = path.join(root, 'user-rules');
  fs.renameSync(originalDirectory, movedDirectory);
  fs.symlinkSync(movedDirectory, originalDirectory, process.platform === 'win32' ? 'junction' : 'dir');
  const before = snapshotTree(root);
  const preview = run(['sync', root, '--prune', '--dry-run', '--migrate-links']);
  assert.equal(preview.status, 2, preview.stderr || preview.stdout);
  assert.deepEqual(snapshotTree(root), before);
  assert.ok(fs.existsSync(path.join(root, relative)));
});

test('approved CLI prune rolls back when the real checker rejects user-owned context', (context) => {
  const { root, relative } = legacyFixture(context);
  const contextPath = path.join(root, 'docs/ai/context-map.yaml');
  fs.writeFileSync(contextPath, fs.readFileSync(contextPath, 'utf8').replace('    extends: base', '    extends: missing_base'));
  fs.chmodSync(path.join(root, relative), 0o600);
  const preview = run(['sync', root, '--prune', '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr || preview.stdout);
  const before = snapshotTree(root);
  const approved = run(['sync', root, '--prune', '--approve', JSON.parse(preview.stdout).planHash]);
  assert.equal(approved.status, 1, approved.stderr || approved.stdout);
  assert.match(approved.stderr, /Post-apply verification failed/);
  assert.deepEqual(snapshotTree(root), before);
});

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
  const stalePath = 'docs/ai/surface-verification-profiles.json';
  const staleContent = `<!-- ${GENERATED_MARKER} -->\n# Legacy generated artifact\n`;
  fs.mkdirSync(path.join(root, 'docs/ai'), { recursive: true });
  fs.writeFileSync(path.join(root, stalePath), staleContent);
  writeManifest(root, {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
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
    toolVersion: TOOL_VERSION,
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

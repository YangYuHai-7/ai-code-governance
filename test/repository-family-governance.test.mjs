import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { checkProject } from '../src/checker.mjs';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { sha256 } from '../src/shared/index.mjs';
import { syncCommand } from '../src/cli/commands/governance.mjs';
import { prepareInit } from '../src/cli/commands/init.mjs';

const cli = path.resolve('bin/aicg.js');

function runCli(args) {
  return spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
}

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `aicg-${name}-`));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function write(root, relative, content) {
  const absolute = path.join(root, relative);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, content);
}

function makeFamily(root) {
  write(root, '.gitmodules', '[submodule "frontend"]\n  path = modules/frontend\n  url = https://example.invalid/frontend.git\n');
  write(root, 'modules/frontend/.git', 'gitdir: ../../.git/modules/modules/frontend\n');
  write(root, 'modules/frontend/package.json', JSON.stringify({ scripts: { test: 'node --test' }, dependencies: { react: '19.0.0' } }));
  write(root, 'modules/frontend/src/App.tsx', 'export const App = () => null;\n');
}

test('repository-family governance is a stable orchestrator index and does not emit a generic implementation Skill', (context) => {
  const root = fixture(context, 'family-artifact');
  makeFamily(root);
  const scan = scanProject(root);
  const artifacts = buildArtifacts({ ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'complete' }, scan);
  assert.equal(artifacts.some((entry) => entry.path === 'docs/ai/skills/generic-unknown/SKILL.md'), false);
  const artifact = artifacts.find((entry) => entry.path === '.ai-governance/state/repository-family.json');
  assert.ok(artifact);
  const family = JSON.parse(artifact.content);
  assert.equal(family.role, 'orchestrator');
  assert.equal(family.boundaries.parentOwnsMemberFiles, false);
  assert.deepEqual(family.authority, { root: 'orchestrator', members: 'autonomous' });
  assert.deepEqual(family.members, [{
    id: 'frontend', path: 'modules/frontend', repositoryKind: 'git-submodule', governanceMode: 'autonomous', members: [],
  }]);
  assert.equal(Object.hasOwn(family, 'units'), false);
  assert.equal(JSON.stringify(family).includes('child-first-parent-pointer-second'), false);
  assert.equal(JSON.stringify(family).includes('explicit-only'), false);

  write(root, 'modules/frontend/src/AAA.tsx', 'export const AAA = () => null;\n');
  const changedScan = scanProject(root);
  const changedArtifact = buildArtifacts({ ...defaultConfig(changedScan), clients: ['codex'], governanceDepth: 'complete' }, changedScan)
    .find((entry) => entry.path === '.ai-governance/state/repository-family.json');
  assert.equal(changedArtifact.content, artifact.content);
});

test('family init binds root and autonomous members to one approved plan', (context) => {
  const root = fixture(context, 'family-init');
  makeFamily(root);
  const baseArgs = ['init', root, '--family', '--yes', '--clients', 'codex', '--no-assist'];
  const preview = runCli([...baseArgs, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.family, true);
  assert.deepEqual(plan.units.map((unit) => unit.path), ['modules/frontend', '.']);
  assert.match(plan.planHash, /^[a-f0-9]{64}$/);
  assert.equal(fs.existsSync(path.join(root, 'AGENTS.md')), false);
  assert.equal(fs.existsSync(path.join(root, 'modules/frontend/AGENTS.md')), false);

  const applied = runCli([...baseArgs, '--approve', plan.planHash]);
  assert.equal(applied.status, 0, applied.stderr);
  const result = JSON.parse(applied.stdout);
  assert.equal(result.units.every((unit) => unit.governanceCheck === 'pass'), true);
  assert.equal(checkProject(scanProject(root)).ok, true);
  assert.equal(checkProject(scanProject(path.join(root, 'modules/frontend'))).ok, true);
  const parentManifest = JSON.parse(fs.readFileSync(path.join(root, '.ai-governance/manifest.json'), 'utf8'));
  assert.equal(parentManifest.files.some((entry) => entry.path.startsWith('modules/frontend/')), false);
});

test('implicit init and a chat request govern a checked-out family without being told it is one', (context) => {
  const root = fixture(context, 'family-implicit');
  makeFamily(root);
  const preview = runCli(['init', root, '--yes', '--clients', 'codex', '--no-assist', '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.equal(plan.family, true);
  assert.deepEqual(plan.units.map((unit) => unit.path), ['modules/frontend', '.']);

  const requested = runCli(['request', root, '--text', '根据aicg完成项目治理框架', '--dry-run', '--json', '--clients', 'codex']);
  assert.equal(requested.status, 0, requested.stderr);
  const payload = JSON.parse(requested.stdout);
  assert.equal(payload.intent.id, 'governance.initialize');
  assert.equal(payload.family, true);
  assert.equal(payload.plan.planHash, plan.planHash);

  // The operator can still ask for the orchestrator alone: --no-family opts out of the
  // implicit decision, so the ordinary single-repository lifecycle rules apply again.
  const lifecycle = path.join(root, 'lifecycle.json');
  fs.writeFileSync(lifecycle, JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  const single = runCli(['init', root, '--yes', '--clients', 'codex', '--no-assist', '--no-family', '--config', lifecycle, '--dry-run']);
  assert.equal(single.status, 0, single.stderr);
  assert.equal(single.stdout.includes('"family": true'), false);
});

test('family init skips declared submodules that are not checked out', (context) => {
  const root = fixture(context, 'family-uninitialized');
  makeFamily(root);
  write(root, '.gitmodules', '[submodule "frontend"]\n  path = modules/frontend\n  url = https://example.invalid/frontend.git\n[submodule "optional"]\n  path = modules/optional\n  url = https://example.invalid/optional.git\n');
  fs.mkdirSync(path.join(root, 'modules/optional'), { recursive: true });
  const baseArgs = ['init', root, '--family', '--yes', '--clients', 'codex', '--no-assist'];
  const preview = runCli([...baseArgs, '--dry-run']);
  assert.equal(preview.status, 0, preview.stderr);
  const plan = JSON.parse(preview.stdout);
  assert.deepEqual(plan.units.map((unit) => unit.path), ['modules/frontend', '.']);
  const applied = runCli([...baseArgs, '--approve', plan.planHash]);
  assert.equal(applied.status, 0, applied.stderr);
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, true, JSON.stringify(checked.errors));
  assert.ok(checked.warnings.some((warning) => warning.includes('modules/optional: uninitialized')));
  assert.equal(fs.existsSync(path.join(root, 'modules/optional/AGENTS.md')), false);
});

test('check requires migration when a previously single repository becomes a repository family', (context) => {
  const root = fixture(context, 'family-migration');
  write(root, 'src/app.ts', 'export const app = true;\n');
  const originalScan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(originalScan), originalScan)));
  makeFamily(root);
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('migration-required')));
});

test('ordinary sync and implicit init refuse a repository-family topology migration', async (context) => {
  const root = fixture(context, 'family-migration-commands');
  write(root, 'src/app.ts', 'export const app = true;\n');
  const originalScan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(originalScan), originalScan)));
  makeFamily(root);
  await assert.rejects(() => syncCommand(root, { 'dry-run': true }), /Topology migration required/);
  await assert.rejects(() => prepareInit(root, { yes: true, 'dry-run': true, 'no-assist': true }), /Topology migration required/);
  write(root, 'migration-decisions.json', JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  const migrated = await prepareInit(root, { config: path.join(root, 'migration-decisions.json'), yes: true, 'dry-run': true, 'no-assist': true });
  assert.equal(migrated.config.projectMode, 'repository-family');
  assert.equal(migrated.config.initialization.lifecycle, 'existing');
  assert.equal(migrated.plan.requireTopologyApproval, true);
  assert.deepEqual(migrated.config.initialClassification.codebase.evidence.repositoryMembers.map((entry) => entry.path), ['modules/frontend']);
});

test('an explicit config decision still requires exact planHash approval before topology migration', (context) => {
  const root = fixture(context, 'family-migration-exact-approval');
  write(root, 'src/app.ts', 'export const app = true;\n');
  const originalScan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(originalScan), originalScan)));
  const configPath = path.join(root, '.ai-governance/config.json');
  const before = fs.readFileSync(configPath, 'utf8');
  makeFamily(root);
  write(root, 'migration-decisions.json', JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  const args = ['init', root, '--config', path.join(root, 'migration-decisions.json'), '--yes', '--no-assist'];

  const preview = runCli(args);
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /"approvalRequired": true/);
  const planHash = preview.stdout.match(/"planHash": "([a-f0-9]{64})"/)?.[1];
  assert.match(planHash, /^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(configPath, 'utf8'), before);
  assert.equal(fs.existsSync(path.join(root, '.ai-governance/state/repository-family.json')), false);

  const applied = runCli([...args, '--approve', planHash]);
  assert.equal(applied.status, 0, applied.stderr);
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).projectMode, 'repository-family');
});

test('family-to-single topology changes require the same explicit migration decision', async (context) => {
  const root = fixture(context, 'family-to-single-migration');
  makeFamily(root);
  write(root, 'src/app.ts', 'export const app = true;\n');
  const familyScan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(familyScan), familyScan)));
  fs.rmSync(path.join(root, '.gitmodules'));
  fs.rmSync(path.join(root, 'modules'), { recursive: true });
  const singleScan = scanProject(root);
  assert.notEqual(singleScan.projectMode, 'repository-family');
  const checked = checkProject(singleScan);
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('migration-required')));
  await assert.rejects(() => syncCommand(root, { 'dry-run': true }), /Topology migration required/);
  await assert.rejects(() => prepareInit(root, { yes: true, 'dry-run': true, 'no-assist': true }), /Topology migration required/);
  write(root, 'migration-decisions.json', JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  const migrated = await prepareInit(root, { config: path.join(root, 'migration-decisions.json'), yes: true, 'dry-run': true, 'no-assist': true });
  assert.equal(migrated.config.projectMode, singleScan.projectMode);
  assert.equal(migrated.plan.requireTopologyApproval, true);
  assert.equal(Object.hasOwn(migrated.config.initialClassification.codebase.evidence, 'repositoryMembers'), false);
});

test('repository-family member additions require an explicit exact migration plan', async (context) => {
  const root = fixture(context, 'family-member-migration');
  makeFamily(root);
  const originalScan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(originalScan), originalScan)));
  write(root, '.gitmodules', '[submodule "frontend"]\n  path = modules/frontend\n  url = https://example.invalid/frontend.git\n[submodule "backend"]\n  path = modules/backend\n  url = https://example.invalid/backend.git\n');
  write(root, 'modules/backend/.git', 'gitdir: ../../.git/modules/modules/backend\n');
  write(root, 'modules/backend/go.mod', 'module example.invalid/backend\n\ngo 1.23\n');
  write(root, 'modules/backend/main.go', 'package main\nfunc main() {}\n');

  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('migration-required')));
  await assert.rejects(() => syncCommand(root, { 'dry-run': true }), /Topology migration required/);
  await assert.rejects(() => prepareInit(root, { yes: true, 'dry-run': true, 'no-assist': true }), /Topology migration required/);

  write(root, 'migration-decisions.json', JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  const migrated = await prepareInit(root, { config: path.join(root, 'migration-decisions.json'), yes: true, 'dry-run': true, 'no-assist': true });
  assert.equal(migrated.plan.requireTopologyApproval, true);
  assert.deepEqual(migrated.config.initialClassification.codebase.evidence.repositoryMembers.map((entry) => entry.path), ['modules/backend', 'modules/frontend']);
});

test('repository-family member removals require an explicit exact migration plan', async (context) => {
  const root = fixture(context, 'family-member-removal');
  makeFamily(root);
  write(root, '.gitmodules', '[submodule "frontend"]\n  path = modules/frontend\n[submodule "backend"]\n  path = modules/backend\n');
  write(root, 'modules/backend/.git', 'gitdir: ../../.git/modules/modules/backend\n');
  write(root, 'modules/backend/go.mod', 'module example.invalid/backend\n\ngo 1.23\n');
  const originalScan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(originalScan), originalScan)));

  write(root, '.gitmodules', '[submodule "frontend"]\n  path = modules/frontend\n');
  fs.rmSync(path.join(root, 'modules/backend'), { recursive: true, force: true });
  const changedScan = scanProject(root);
  const checked = checkProject(changedScan);
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('migration-required')));
  await assert.rejects(() => syncCommand(root, { 'dry-run': true }), /Topology migration required/);
  await assert.rejects(() => prepareInit(root, { yes: true, 'dry-run': true, 'no-assist': true }), /Topology migration required/);

  write(root, 'migration-decisions.json', JSON.stringify({ initialization: { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' } }));
  const migrated = await prepareInit(root, { config: path.join(root, 'migration-decisions.json'), yes: true, 'dry-run': true, 'no-assist': true });
  assert.equal(migrated.plan.requireTopologyApproval, true);
  assert.deepEqual(migrated.config.initialClassification.codebase.evidence.repositoryMembers.map((entry) => entry.path), ['modules/frontend']);
});

test('parent manifest cannot claim files inside a member repository', (context) => {
  const root = fixture(context, 'family-ownership');
  makeFamily(root);
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  const manifestPath = path.join(root, '.ai-governance/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const content = fs.readFileSync(path.join(root, 'modules/frontend/package.json'), 'utf8');
  manifest.files.push({ path: 'modules/frontend/package.json', ownership: 'full', kind: 'configuration', source: 'invalid-parent-claim', sha256: sha256(content) });
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('parent manifest crosses repository boundary')));
});

test('check fails closed when .aicgignore hides product source', (context) => {
  const root = fixture(context, 'ignore-source');
  write(root, 'src/app.ts', 'export const app = true;\n');
  const scan = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  write(root, '.aicgignore', 'src/app.ts\n');
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('unverified scan exclusion: src/app.ts')));
});

test('check fails closed when .aicgignore hides data, infrastructure, or YAML sources', (context) => {
  const root = fixture(context, 'ignore-high-impact-sources');
  write(root, 'src/app.ts', 'export const app = true;\n');
  const initial = scanProject(root);
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(initial), initial)));
  const excluded = [
    ['db/schema.sql', 'CREATE TABLE payments (id BIGINT);\n', 'infrastructure-or-data-source'],
    ['infra/main.tf', 'resource "example" "service" {}\n', 'infrastructure-or-data-source'],
    ['infra/policy.hcl', 'policy = "restricted"\n', 'infrastructure-or-data-source'],
    ['deploy/service.yaml', 'apiVersion: v1\nkind: Service\n', 'configuration-or-contract'],
    ['deploy/service.yml', 'services:\n  api: {}\n', 'configuration-or-contract'],
    ['docs/ai/local-policy.yaml', 'policy: local\n', 'governance-or-repository-boundary'],
  ];
  for (const [relative, content] of excluded) write(root, relative, content);
  write(root, '.aicgignore', `${excluded.map(([relative]) => relative).join('\n')}\n`);

  const scan = scanProject(root);
  assert.deepEqual(
    Object.fromEntries(scan.scanIgnore.unverifiedExclusions.map((entry) => [entry.path, entry.category])),
    Object.fromEntries(excluded.map(([relative, _content, category]) => [relative, category])),
  );
  const checked = checkProject(scan);
  assert.equal(checked.ok, false);
  for (const [relative] of excluded) {
    assert.ok(checked.errors.some((entry) => entry.includes(`unverified scan exclusion: ${relative}`)), relative);
  }
});

test('an exact evidence-bound exclusion approval permits the current policy only', (context) => {
  const root = fixture(context, 'ignore-approved');
  write(root, 'src/app.ts', 'export const app = true;\n');
  write(root, '.aicgignore', 'src/app.ts\n');
  const scan = scanProject(root);
  const exclusion = scan.scanIgnore.unverifiedExclusions[0];
  const config = {
    ...defaultConfig(scan),
    scanExclusions: {
      schemaVersion: 1,
      policySha256: scan.scanIgnore.sha256,
      approvals: [{ path: exclusion.path, reason: 'Owner confirmed this generated fixture is not product source.', evidenceHash: exclusion.evidenceHash }],
    },
  };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  write(root, '.aicgignore', 'src/**\n');
  const changed = checkProject(scanProject(root));
  assert.equal(changed.ok, false);
  assert.ok(changed.errors.some((entry) => entry.includes('unverified scan exclusion')));
});

test('a directory exclusion is reviewable and cannot hide a product subtree by default', (context) => {
  const root = fixture(context, 'ignore-directory');
  write(root, 'src/app.ts', 'export const app = true;\n');
  write(root, '.aicgignore', 'src/\n');
  const scan = scanProject(root);
  assert.equal(scan.scanIgnore.unverifiedExclusions[0].category, 'directory-subtree');
  assert.equal(scan.scanIgnore.unverifiedExclusions[0].evidenceStatus, 'complete');
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(defaultConfig(scan), scan)));
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('unverified scan exclusion: src')));
});

test('an exclusion approval is invalidated when hidden content changes', (context) => {
  const root = fixture(context, 'ignore-content-change');
  write(root, 'src/app.ts', 'export const app = true;\n');
  write(root, '.aicgignore', 'src/\n');
  const scan = scanProject(root);
  const exclusion = scan.scanIgnore.unverifiedExclusions[0];
  const config = {
    ...defaultConfig(scan),
    scanExclusions: {
      schemaVersion: 1,
      policySha256: scan.scanIgnore.sha256,
      approvals: [{ path: exclusion.path, reason: 'Owner reviewed this exact hidden fixture snapshot.', evidenceHash: exclusion.evidenceHash }],
    },
  };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  assert.equal(checkProject(scanProject(root)).ok, true);
  write(root, 'src/app.ts', 'export const app = false;\n');
  const changed = checkProject(scanProject(root));
  assert.equal(changed.ok, false);
  assert.ok(changed.errors.some((entry) => entry.includes('unverified scan exclusion: src')));
});

test('scan exclusions fail closed when the bounded review list overflows', (context) => {
  const root = fixture(context, 'ignore-overflow');
  const rules = [];
  for (let index = 0; index < 33; index += 1) {
    const relative = `hidden/file-${index}.ts`;
    write(root, relative, `export const value${index} = true;\n`);
    rules.push(relative);
  }
  write(root, '.aicgignore', `${rules.join('\n')}\n`);
  const scan = scanProject(root);
  assert.equal(scan.scanIgnore.unverifiedExclusionCount, 33);
  assert.equal(scan.scanIgnore.unverifiedExclusionsTruncated, true);
  const config = {
    ...defaultConfig(scan),
    scanExclusions: {
      schemaVersion: 1,
      policySha256: scan.scanIgnore.sha256,
      approvals: scan.scanIgnore.unverifiedExclusions.map((entry) => ({ path: entry.path, reason: 'Reviewed fixture.', evidenceHash: entry.evidenceHash })),
    },
  };
  applyArtifactPlan(root, planArtifacts(root, buildArtifacts(config, scan)));
  const checked = checkProject(scanProject(root));
  assert.equal(checked.ok, false);
  assert.ok(checked.errors.some((entry) => entry.includes('review budget')));
});

test('.aicgignore treats database, infrastructure and schema files as reviewable production scope', (context) => {
  const root = fixture(context, 'ignore-production-formats');
  for (const relative of ['db/schema.sql', 'infra/main.tf', 'deploy/app.yaml', 'schema/api.graphql']) write(root, relative, 'production_definition = true\n');
  write(root, '.aicgignore', 'db/schema.sql\ninfra/main.tf\ndeploy/app.yaml\nschema/api.graphql\n');
  const scan = scanProject(root);
  assert.equal(scan.scanIgnore.unverifiedExclusionCount, 4);
  // The walk reads directory entries in filesystem order, so assert the exclusion set and its
  // per-path classification instead of an incidental macOS-specific traversal order.
  const categoriesByPath = Object.fromEntries(scan.scanIgnore.unverifiedExclusions.map((entry) => [entry.path, entry.category]));
  assert.deepEqual(categoriesByPath, {
    'db/schema.sql': 'infrastructure-or-data-source',
    'deploy/app.yaml': 'configuration-or-contract',
    'infra/main.tf': 'infrastructure-or-data-source',
    'schema/api.graphql': 'product-source',
  });
});

test('.aicgignore evidence snapshots enforce one aggregate byte budget', (context) => {
  const root = fixture(context, 'ignore-byte-budget');
  const rules = [];
  const payload = Buffer.alloc(2 * 1024 * 1024 - 1, 'x');
  for (let index = 0; index < 9; index += 1) {
    const relative = `db/part-${index}.sql`;
    const absolute = path.join(root, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, payload);
    rules.push(relative);
  }
  write(root, '.aicgignore', `${rules.join('\n')}\n`);
  const scan = scanProject(root);
  assert.equal(scan.scanIgnore.unverifiedExclusionCount, 9);
  assert.ok(scan.scanIgnore.evidenceBytes <= 16 * 1024 * 1024);
  assert.ok(scan.scanIgnore.unverifiedExclusions.some((entry) => entry.evidenceStatus === 'incomplete' && entry.evidenceReason.includes('aggregate')));
});

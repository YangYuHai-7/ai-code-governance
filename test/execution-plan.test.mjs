import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from '../src/execution-plan.mjs';
import { defaultConfig, buildArtifacts } from '../src/generator.mjs';
import { planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { scanInputDescriptor } from '../src/modules/repository/input-fingerprint.mjs';
import { sha256 } from '../src/shared/index.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-execution-plan-${name}-`));
}

const initializeIntent = { id: 'governance.initialize', handler: 'init', mode: 'write' };
const pruneIntent = { id: 'governance.prune', handler: 'sync', mode: 'write' };

for (const object of ['root', 'directory', 'file']) for (const [name, bit] of [['sticky', 0o1000], ['setgid', 0o2000], ['setuid', 0o4000]]) {
  test(`prune approval binds ${name} on ${object}`, (context) => {
    const root = fixture(`${object}-${name}`);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const target = object === 'root' ? root : path.join(root, 'nested');
    if (object === 'directory') fs.mkdirSync(target);
    if (object === 'file') fs.writeFileSync(target, 'Inert fixture content.\n');
    fs.chmodSync(target, 0o755);
    const plan = buildExecutionPlan({ intent: pruneIntent, scan: scanProject(root) });
    try { fs.chmodSync(target, 0o755 | bit); } catch (error) {
      if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP', 'ENOSYS', 'EINVAL'].includes(error.code)) throw error;
      context.skip(`${process.platform} cannot set ${name} on ${object}: ${error.code}`);
      return;
    }
    if ((fs.lstatSync(target).mode & 0o7777) !== (0o755 | bit)) {
      context.skip(`${process.platform} filesystem does not preserve ${name} on ${object}`);
      return;
    }
    assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /stale/.test(error.message));
    assert.notEqual(buildExecutionPlan({ intent: pruneIntent, scan: scanProject(root) }).planHash, plan.planHash);
  });
}

for (const change of ['add-empty-directory', 'remove-empty-directory', 'directory-mode', 'root-mode', 'file-to-directory', 'directory-to-file', 'directory-to-symlink']) {
  test(`prune approval becomes stale after ${change}`, (context) => {
    const root = fixture(change);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const entry = path.join(root, 'content');
    if (change === 'file-to-directory') fs.writeFileSync(entry, 'content');
    else fs.mkdirSync(entry, { mode: 0o755 });
    const plan = buildExecutionPlan({ intent: pruneIntent, scan: scanProject(root) });
    if (change === 'add-empty-directory') fs.mkdirSync(path.join(root, 'new-empty'));
    if (change === 'remove-empty-directory') fs.rmdirSync(entry);
    if (change === 'directory-mode') fs.chmodSync(entry, 0o700);
    if (change === 'root-mode') fs.chmodSync(root, 0o755);
    if (change === 'file-to-directory') { fs.unlinkSync(entry); fs.mkdirSync(entry); }
    if (change === 'directory-to-file') { fs.rmdirSync(entry); fs.writeFileSync(entry, 'content'); }
    if (change === 'directory-to-symlink') { fs.rmdirSync(entry); fs.symlinkSync(root, entry, process.platform === 'win32' ? 'junction' : 'dir'); }
    assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /stale/.test(error.message));
    assert.notEqual(buildExecutionPlan({ intent: pruneIntent, scan: scanProject(root) }).planHash, plan.planHash);
  });
}

test('prune approval excludes git metadata and its internal directories', (context) => {
  const root = fixture('git-metadata');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const plan = buildExecutionPlan({ intent: pruneIntent, scan: scanProject(root) });
  fs.mkdirSync(path.join(root, '.git/objects'), { recursive: true });
  fs.writeFileSync(path.join(root, '.git/HEAD'), 'ref: refs/heads/main\n');
  fs.chmodSync(path.join(root, '.git'), 0o700);
  assert.equal(assertPlanFresh(plan), true);
  assert.equal(buildExecutionPlan({ intent: pruneIntent, scan: scanProject(root) }).planHash, plan.planHash);
});

test('execution plans reject stale preimages before apply', (context) => {
  const root = fixture('stale');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'AGENTS.md'), '# User-managed entry\n');
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  fs.appendFileSync(path.join(root, 'AGENTS.md'), 'changed after planning\n');
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /stale/.test(error.message));
});

test('execution plans reject repository input changes and altered desired content', (context) => {
  const root = fixture('inputs');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.1' } }));
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /repository inputs changed/.test(error.message));

  const refreshedScan = scanProject(root);
  const refreshedConfig = defaultConfig(refreshedScan);
  const refreshedArtifactPlan = planArtifacts(root, buildArtifacts(refreshedConfig, refreshedScan));
  const refreshedPlan = buildExecutionPlan({ intent: initializeIntent, scan: refreshedScan, artifactPlan: refreshedArtifactPlan, config: refreshedConfig });
  refreshedArtifactPlan.operations.find((operation) => operation.path === 'AGENTS.md').desired += '\nchanged after approval\n';
  assert.throws(() => assertArtifactPlanMatches(refreshedPlan, root, refreshedArtifactPlan), (error) => error.exitCode === 2 && /approved artifact plan/.test(error.message));
});

test('execution plans bind effective deep scan inputs but ignore built-in runtime logs', (context) => {
  const root = fixture('effective-scan-inputs');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const deepDirectory = path.join(root, 'src/a/b/c/d/e/f');
  fs.mkdirSync(deepDirectory, { recursive: true });
  const deepSource = path.join(deepDirectory, 'feature.mjs');
  fs.writeFileSync(deepSource, 'export const value = 1;\n');
  fs.mkdirSync(path.join(root, 'logs'));
  fs.writeFileSync(path.join(root, 'logs/runtime.log'), 'first\n');

  const scan = scanProject(root);
  const plan = buildExecutionPlan({ intent: initializeIntent, scan });
  fs.writeFileSync(path.join(root, 'logs/runtime.log'), 'second\n');
  assert.equal(assertPlanFresh(plan), true);

  fs.writeFileSync(deepSource, 'export const value = 2;\n');
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /repository inputs changed/.test(error.message));
});

test('execution input descriptors bind visible regular-file bytes and link targets', (context) => {
  const root = fixture('content-digests');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const content = 'export const visible = true;\n';
  fs.writeFileSync(path.join(root, 'visible.mjs'), content);
  fs.symlinkSync('visible.mjs', path.join(root, 'visible-link.mjs'));

  const descriptor = scanInputDescriptor(scanProject(root));
  const file = descriptor.files.find((entry) => entry.path === 'visible.mjs');
  const link = descriptor.files.find((entry) => entry.path === 'visible-link.mjs');
  assert.equal(file.sha256, sha256(content));
  assert.equal(link.target, 'visible.mjs');
  assert.equal(Object.hasOwn(link, 'sha256'), false);
});

test('execution plans bind the project ignore policy itself', (context) => {
  const root = fixture('ignore-policy');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'public'));
  fs.writeFileSync(path.join(root, 'public/vendor.js'), '/* vendor */\n');
  fs.writeFileSync(path.join(root, '.aicgignore'), 'public/vendor.js\n');
  const plan = buildExecutionPlan({ intent: initializeIntent, scan: scanProject(root) });
  assert.equal(assertPlanFresh(plan), true);
  fs.writeFileSync(path.join(root, '.aicgignore'), 'public/**\n');
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /repository inputs changed/.test(error.message));
});

test('execution plans explicitly bind deterministic manifest content', (context) => {
  const root = fixture('manifest');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  const operation = plan.operations.find((item) => item.path === '.ai-governance/manifest.json');
  assert.ok(operation);
  assert.equal(operation.action, 'create');
  assert.equal(operation.afterSha256.length, 64);
  artifactPlan.manifest.content = `${artifactPlan.manifest.content}\n`;
  assert.throws(() => assertArtifactPlanMatches(plan, root, artifactPlan), (error) => error.exitCode === 2 && /approved artifact plan/.test(error.message));
});

test('execution plans reject a symlink inserted after planning', (context) => {
  const root = fixture('symlink');
  const outside = fixture('symlink-outside');
  context.after(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });
  const scan = scanProject(root);
  const config = defaultConfig(scan);
  const artifactPlan = planArtifacts(root, buildArtifacts(config, scan));
  const plan = buildExecutionPlan({ intent: initializeIntent, scan, artifactPlan, config });
  fs.symlinkSync(outside, path.join(root, '.cursor'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => assertPlanFresh(plan), (error) => error.exitCode === 2 && /repository inputs changed/.test(error.message));
  assert.equal(fs.readdirSync(outside).length, 0);
});

test('execution plans bind the exact user content remaining after managed block removal', (context) => {
  const root = fixture('block-removal-output');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'CLAUDE.md'), '# User content\n');
  const scan = scanProject(root);
  const artifactPlan = planArtifacts(root, []);
  artifactPlan.operations.push({ path: 'CLAUDE.md', ownership: 'managed-block', kind: 'adapter', source: 'AGENTS.md', changed: true, remove: true, deleteWhenEmpty: false, desired: '# User content\n' });
  const plan = buildExecutionPlan({ intent: { id: 'governance.prune', handler: 'sync', mode: 'write' }, scan, artifactPlan });
  artifactPlan.operations[0].desired = '# Lost user content\n';
  assert.throws(() => assertArtifactPlanMatches(plan, root, artifactPlan), (error) => error.exitCode === 2 && /approved artifact plan/.test(error.message));
});

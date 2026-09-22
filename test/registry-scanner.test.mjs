import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { scanProject } from '../src/scanner.mjs';
import { walkFilesDetailed } from '../src/adapters/filesystem/index.mjs';
import { allBuiltInClientIds, loadAgentRegistry } from '../src/catalogs/index.mjs';
import { defaultConfig, validateConfig } from '../src/generator.mjs';

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-${name}-`));
}

test('fresh all-client scope includes Copilot but legacy selection remains unchanged', (context) => {
  const root = fixture('all-client-scope');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  assert.deepEqual(allBuiltInClientIds(loadAgentRegistry()), [
    'codex', 'claude-code', 'cursor', 'github-copilot',
  ]);
  const legacy = { ...defaultConfig(scan), clients: ['codex', 'claude-code', 'cursor'] };
  assert.deepEqual(validateConfig(legacy).clients, legacy.clients);
  assert.equal(defaultConfig(scan).governanceFootprint, 'compact');
});

test('an existing managed configuration defaults to the preserve footprint', (context) => {
  const root = fixture('legacy-footprint');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.ai-governance'), { recursive: true });
  fs.writeFileSync(path.join(root, '.ai-governance', 'config.json'), '{}\n');
  const scan = scanProject(root);
  assert.equal(defaultConfig(scan).governanceFootprint, 'preserve');
  const legacy = { ...defaultConfig(scan) };
  delete legacy.governanceFootprint;
  assert.equal(validateConfig(legacy).governanceFootprint, 'preserve');
});

test('detects React and Node from manifest dependencies', (context) => {
  const root = fixture('react-node');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: { test: 'node --test' },
    dependencies: { react: '19.0.0', express: '5.0.0' },
  }));
  const scan = scanProject(root);
  assert.deepEqual(scan.stacks.map((stack) => stack.id), ['frontend-react', 'backend-node']);
  assert.equal(scan.projectMode, 'brownfield');
  const testCommand = scan.commands.find((command) => command.command === 'npm run test');
  assert.equal(testCommand.verification.trust.level, 'structurally-trusted');
  assert.deepEqual(testCommand.verification.argv, ['npm', 'run', 'test']);
});

test('uses generic fallback for an empty greenfield repository', (context) => {
  const root = fixture('greenfield');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'greenfield');
  assert.deepEqual(scan.stacks.map((stack) => stack.id), ['generic-unknown']);
});

test('discovers git submodules as a repository family and excludes child contents from root facts', (context) => {
  const root = fixture('repository-family');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "frontend"]\n\tpath = modules/frontend\n\turl = https://example.invalid/frontend.git\n');
  fs.mkdirSync(path.join(root, 'modules/frontend'), { recursive: true });
  fs.writeFileSync(path.join(root, 'modules/frontend/.git'), 'gitdir: ../../.git/modules/modules/frontend\n');
  fs.writeFileSync(path.join(root, 'modules/frontend/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.writeFileSync(path.join(root, 'modules/frontend/App.tsx'), 'export const App = () => null;\n');

  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'repository-family');
  assert.deepEqual(scan.repositoryFamily, {
    kind: 'git-submodules',
    source: '.gitmodules',
    members: [{ id: 'frontend', path: 'modules/frontend', repositoryKind: 'git-submodule', initialized: true }],
    issues: [],
  });
  assert.equal(scan.files.some((file) => file.relative.startsWith('modules/frontend/')), false);
  assert.deepEqual(scan.stacks.map((stack) => stack.id), ['generic-unknown']);
  assert.deepEqual(scan.packageDependencies, {});
  assert.equal(scan.governanceUnits.length, 1);
  assert.equal(scan.governanceUnits[0].path, 'modules/frontend');
  assert.deepEqual(scan.governanceUnits[0].stacks.map((stack) => stack.id), ['frontend-react']);
});

test('rejects submodule paths that differ only by case on every platform', (context) => {
  const root = fixture('repository-family-case-collision');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.gitmodules'), [
    '[submodule "frontend-lower"]',
    '  path = modules/frontend',
    '[submodule "frontend-upper"]',
    '  path = Modules/Frontend',
    '',
  ].join('\n'));

  const scan = scanProject(root);
  assert.equal(scan.repositoryFamily.members.length, 1);
  assert.match(scan.repositoryFamily.issues.join('\n'), /duplicate submodule identity or path/);
});

test('discovers an ordinary nested Git repository and excludes it from root facts', (context) => {
  const root = fixture('nested-git-family');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'services/api/.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'services/api/.git/HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, 'services/api/package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
  fs.writeFileSync(path.join(root, 'services/api/App.tsx'), 'export const App = () => null;\n');

  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'repository-family');
  assert.deepEqual(scan.repositoryFamily.members.map(({ initialized, ...member }) => member), [{
    id: 'services/api', path: 'services/api', repositoryKind: 'nested-git',
  }]);
  assert.equal(scan.repositoryFamily.members[0].initialized, true);
  assert.equal(scan.files.some((file) => file.relative.startsWith('services/api/')), false);
  assert.deepEqual(scan.stacks.map((stack) => stack.id), ['generic-unknown']);
  assert.deepEqual(scan.governanceUnits[0].stacks.map((stack) => stack.id), ['frontend-react']);
});

test('first-level members are governed as their own single repository and do not recurse into nested family boundaries', (context) => {
  const root = fixture('nested-family-layers');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "child"]\n  path = child\n');
  fs.mkdirSync(path.join(root, 'child/vendor/grand/.git'), { recursive: true });
  fs.writeFileSync(path.join(root, 'child/.git'), 'gitdir: ../.git/modules/child\n');
  fs.writeFileSync(path.join(root, 'child/package.json'), '{}\n');
  fs.writeFileSync(path.join(root, 'child/vendor/grand/.git/HEAD'), 'ref: refs/heads/main\n');
  fs.writeFileSync(path.join(root, 'child/vendor/grand/package.json'), JSON.stringify({
    scripts: { test: 'node --test' }, dependencies: { react: '19.0.0' },
  }));
  fs.writeFileSync(path.join(root, 'child/vendor/grand/App.tsx'), 'export const App = () => null;\n');

  // A first-level member is governed as its own single repository: nested `.git`
  // directories inside it are visible as ordinary source files but the scanner does not
  // recurse into them, so the member's `projectMode` stays `brownfield` and it owns the
  // grandchild's source manifest as its own inventory.
  const scan = scanProject(root);
  const child = scan.governanceUnits[0];
  assert.equal(child.projectMode, 'brownfield');
  assert.equal(child.sourceFiles.some((file) => file.path.startsWith('vendor/grand/')), true);
  assert.equal(child.manifests.includes('vendor/grand/package.json'), true);
  assert.equal(child.stacks.some((stack) => stack.id === 'frontend-react'), true);
});

test('reports a declared repository cycle without recursing', (context) => {
  const root = fixture('repository-family-cycle');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, '.git'));
  fs.writeFileSync(path.join(root, '.gitmodules'), '[submodule "loop"]\n  path = loop\n');
  try {
    fs.symlinkSync(process.platform === 'win32' ? root : '.', path.join(root, 'loop'), process.platform === 'win32' ? 'junction' : 'dir');
  } catch (error) {
    context.skip(`directory links are unavailable: ${error.code ?? error.message}`);
    return;
  }

  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'repository-family');
  assert.equal(scan.governanceUnits[0].status, 'cycle');
});

test('scan exclusions are audited and source-hiding rules remain unverified', (context) => {
  const root = fixture('aicg-ignore-audit');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'));
  fs.writeFileSync(path.join(root, 'src/app.ts'), 'export const app = true;\n');
  fs.writeFileSync(path.join(root, '.aicgignore'), 'src/app.ts\n');
  const scan = scanProject(root);
  assert.match(scan.scanIgnore.sha256, /^[a-f0-9]{64}$/);
  assert.equal(scan.scanIgnore.matchedCount, 1);
  assert.equal(scan.scanIgnore.unverifiedExclusions.length, 1);
  assert.deepEqual({ ...scan.scanIgnore.unverifiedExclusions[0], evidenceHash: undefined }, {
    path: 'src/app.ts', type: 'file', line: 1, pattern: 'src/app.ts', category: 'product-source', evidenceStatus: 'complete',
    contentSha256: scan.scanIgnore.unverifiedExclusions[0].contentSha256, evidenceHash: undefined,
  });
  assert.match(scan.scanIgnore.unverifiedExclusions[0].contentSha256, /^[a-f0-9]{64}$/);
  assert.match(scan.scanIgnore.unverifiedExclusions[0].evidenceHash, /^[a-f0-9]{64}$/);
});

test('local review and report manifests cannot change repository facts', (context) => {
  const root = fixture('local-output-facts');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'reviews'), { recursive: true });
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/package.json'), JSON.stringify({
    dependencies: { axios: '1.12.0', express: '5.1.0', react: '19.1.1' },
  }));
  fs.writeFileSync(path.join(root, 'reviews/pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  fs.mkdirSync(path.join(root, 'reports/a/b/c'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/a/b/c/deep.log'), 'local diagnostic\n');

  const scan = scanProject(root, { scanBudget: { maxDepth: 1 } });
  assert.equal(scan.projectMode, 'greenfield');
  assert.deepEqual(scan.stacks.map((stack) => stack.id), ['generic-unknown']);
  assert.deepEqual(scan.packageDependencies, {});
  assert.equal(scan.files.some((file) => /^(?:reviews|reports)\//.test(file.relative)), false);
  assert.equal(scan.scanBudget.complete, true);
});

test('only root local-output directories are excluded from repository scanning', (context) => {
  const root = fixture('nested-reports-source');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src/reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/reports/index.mjs'), 'export const report = true;\n');

  const scan = scanProject(root);
  assert.ok(scan.files.some((file) => file.relative === 'src/reports/index.mjs'));
});

test('.aicgignore excludes matching paths and supports root-relative negation', (context) => {
  const root = fixture('aicg-ignore');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, '.aicgignore'), '# generated files\ncache/\ngenerated/cache/\n*.log\n!/cache/keep.js\n/root-only.txt\n');
  fs.mkdirSync(path.join(root, 'cache'), { recursive: true });
  fs.mkdirSync(path.join(root, 'nested'), { recursive: true });
  fs.writeFileSync(path.join(root, 'cache/drop.js'), 'export const drop = true;\n');
  fs.writeFileSync(path.join(root, 'cache/keep.js'), 'export const keep = true;\n');
  fs.writeFileSync(path.join(root, 'nested/runtime.log'), 'ignored\n');
  fs.mkdirSync(path.join(root, 'generated/cache'), { recursive: true });
  fs.writeFileSync(path.join(root, 'generated/cache/drop.js'), 'export const generated = true;\n');
  fs.writeFileSync(path.join(root, 'nested/root-only.txt'), 'kept\n');
  fs.writeFileSync(path.join(root, 'root-only.txt'), 'ignored\n');

  const scan = scanProject(root);
  assert.equal(scan.scanIgnore.ruleCount, 5);
  assert.equal(scan.files.some((file) => file.relative === 'cache/drop.js'), false);
  assert.equal(scan.files.some((file) => file.relative === 'cache/keep.js'), true);
  assert.equal(scan.files.some((file) => file.relative === 'nested/runtime.log'), false);
  assert.equal(scan.files.some((file) => file.relative === 'generated/cache/drop.js'), false);
  assert.equal(scan.files.some((file) => file.relative === 'nested/root-only.txt'), true);
  assert.equal(scan.files.some((file) => file.relative === 'root-only.txt'), false);
  assert.equal(scan.files.some((file) => file.relative === '.aicgignore'), true);
});

test('filesystem root-only ignores do not hide nested directories with the same name', (context) => {
  const root = fixture('root-only-ignore');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'reports'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src/reports'), { recursive: true });
  fs.writeFileSync(path.join(root, 'reports/local.log'), 'local\n');
  fs.writeFileSync(path.join(root, 'src/reports/index.mjs'), 'export const report = true;\n');

  const walked = walkFilesDetailed(root, { maxDepth: 4, ignoredAtRoot: ['reports'] });
  assert.equal(walked.files.some((file) => file.relative === 'reports/local.log'), false);
  assert.equal(walked.files.some((file) => file.relative === 'src/reports/index.mjs'), true);
});

test('detects Java and monorepo evidence', (context) => {
  const root = fixture('java-monorepo');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'pom.xml'), '<project><dependencies><dependency><groupId>org.springframework.boot</groupId><artifactId>spring-boot-starter</artifactId><version>3.5.1</version></dependency></dependencies></project>');
  fs.writeFileSync(path.join(root, 'pnpm-workspace.yaml'), 'packages:\n  - apps/*\n');
  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'monorepo');
  assert.ok(scan.stacks.some((stack) => stack.id === 'backend-java'));
  fs.writeFileSync(path.join(root, 'pom.xml'), '<dependency>spring-boot</dependency>');
  assert.equal(scanProject(root).stacks.some((stack) => stack.id === 'backend-java'), false, 'unstructured dependency text is not a Maven coordinate');
});

test('keeps scanning when a project manifest is invalid', (context) => {
  const root = fixture('invalid-package');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), '{ invalid');
  const scan = scanProject(root);
  assert.equal(scan.projectMode, 'brownfield');
  assert.deepEqual(scan.commands, []);
});

test('does not expose unsafe package script names as governance commands', (context) => {
  const root = fixture('unsafe-script-name');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({
    scripts: {
      test: 'node --test',
      'test`\nFOLLOW-UNTRUSTED-INSTRUCTION': 'node --test',
    },
  }));
  const scan = scanProject(root);
  assert.deepEqual(scan.commands.map((command) => command.name), ['test']);
});

test('scan budgets expose file-count, depth, and oversized-content truncation', (context) => {
  const root = fixture('scan-budget');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'large.js'), 'x'.repeat(32));
  fs.writeFileSync(path.join(root, 'first.js'), 'export const first = true;\n');
  fs.writeFileSync(path.join(root, 'second.js'), 'export const second = true;\n');
  fs.mkdirSync(path.join(root, 'one', 'two'), { recursive: true });
  fs.writeFileSync(path.join(root, 'one', 'two', 'deep.js'), 'export const deep = true;\n');

  const sizeLimited = scanProject(root, { scanBudget: { maxDepth: 8, maxFiles: 20, maxFileBytes: 16 } });
  assert.equal(sizeLimited.scanBudget.complete, false);
  assert.deepEqual(sizeLimited.scanBudget.truncation.oversizedFiles.map((item) => item.path), ['first.js', 'large.js', 'second.js', 'one/two/deep.js'].sort((left, right) => left.localeCompare(right)));
  assert.ok(sizeLimited.files.find((file) => file.relative === 'large.js'));
  assert.equal(sizeLimited.files.find((file) => file.relative === 'large.js').contentScannable, false);

  const depthLimited = scanProject(root, { scanBudget: { maxDepth: 0, maxFiles: 20, maxFileBytes: 1024 } });
  assert.equal(depthLimited.scanBudget.complete, false);
  assert.deepEqual(depthLimited.scanBudget.truncation.directories, ['one']);
  assert.equal(depthLimited.files.some((file) => file.relative === 'one/two/deep.js'), false);

  const fileLimited = scanProject(root, { scanBudget: { maxDepth: 8, maxFiles: 2, maxFileBytes: 1024 } });
  assert.equal(fileLimited.scanBudget.complete, false);
  assert.equal(fileLimited.scanBudget.truncation.fileLimitReached, true);
  assert.equal(fileLimited.files.length, 2);
});

test('oversized non-code payloads do not make a code scan incomplete', (context) => {
  const root = fixture('non-code-oversize');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const large = Buffer.alloc(2 * 1024 * 1024 + 1, 'x');
  for (const relative of [
    'modules/<sample-repo>/service/target/service.jar',
    'modules/<sample-repo>/logs/service.log',
    'modules/<sample-repo>/site/src/main/resources/static/res.txt',
    'modules/<sample-repo>/site/src/main/resources/test/wsclc.json',
    'modules/management/public/amap.js',
    'modules/management/src/views/Taxation/assets/identify.gif',
    'modules/app/.swc/plugins/cache.bin',
    'modules/app/src/trace/assets/bgemployer.png',
  ]) {
    const target = path.join(root, relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, large);
  }
  const vendor = path.join(root, 'modules/management/src/utils/ezuikit-js/ezuikit.js');
  fs.mkdirSync(path.dirname(vendor), { recursive: true });
  fs.writeFileSync(vendor, `(function (global, factory) {\n  typeof exports === "object" && typeof module !== "undefined" ? module.exports = factory() :\n  typeof define === "function" && define.amd ? define(factory) :\n  (global.EZUIKit = factory());\n}(this, (function () {\n${'  var bundledValue = true;\n'.repeat(90000)}  return {};\n})));\n`);

  const scan = scanProject(root);
  assert.equal(scan.scanBudget.complete, true);
  assert.deepEqual(scan.scanBudget.truncation.oversizedFiles, []);
  assert.equal(scan.scanBudget.truncation.ignoredOversizedFiles.length, 6);
  assert.ok(scan.scanBudget.truncation.ignoredOversizedFiles.some((file) => file.path.endsWith('ezuikit.js')));
  assert.equal(scan.files.find((file) => file.relative.endsWith('ezuikit.js')).contentScannable, false);
  for (const segment of ['/target/', '/logs/', '/.swc/']) assert.equal(scan.files.some((file) => file.relative.includes(segment)), false);
});

test('an oversized application source file still makes the scan incomplete', (context) => {
  const root = fixture('code-oversize');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/service.ts'), `export const value = '${'x'.repeat(2 * 1024 * 1024)}';\n`);

  const scan = scanProject(root);
  assert.equal(scan.scanBudget.complete, false);
  assert.deepEqual(scan.scanBudget.truncation.oversizedFiles.map((file) => file.path), ['src/service.ts']);
  assert.deepEqual(scan.scanBudget.truncation.ignoredOversizedFiles, []);
});

test('scanner reports directory read failures instead of silently claiming completeness', (context) => {
  const root = fixture('scan-read-error');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const missing = walkFilesDetailed(path.join(root, 'missing'));
  assert.equal(missing.budget.complete, false);
  assert.deepEqual(missing.budget.truncation.readErrors, [{ path: '.', operation: 'readdir', code: 'ENOENT' }]);
});

test('scanner bounds directories and total entries even when directories contain no files', (context) => {
  const root = fixture('scan-directory-budget');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  for (const name of ['a', 'b', 'c', 'd']) fs.mkdirSync(path.join(root, name));

  const directoryLimited = scanProject(root, {
    scanBudget: { maxDepth: 8, maxFiles: 20, maxFileBytes: 1024, maxDirectories: 2, maxEntries: 20 },
  });
  assert.equal(directoryLimited.scanBudget.complete, false);
  assert.equal(directoryLimited.scanBudget.truncation.directoryLimitReached, true);
  assert.equal(directoryLimited.scanBudget.truncation.directoryBudgetPaths.length, 1);
  assert.deepEqual(directoryLimited.scanBudget.truncation.directories, []);
  assert.equal(directoryLimited.scanBudget.observedDirectories, 2);

  const entryLimited = scanProject(root, {
    scanBudget: { maxDepth: 8, maxFiles: 20, maxFileBytes: 1024, maxDirectories: 20, maxEntries: 2 },
  });
  assert.equal(entryLimited.scanBudget.complete, false);
  assert.equal(entryLimited.scanBudget.truncation.entryLimitReached, true);
  assert.equal(entryLimited.scanBudget.observedEntries, 2);
});

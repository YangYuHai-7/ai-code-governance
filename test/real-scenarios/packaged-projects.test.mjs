import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const npmExecutable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const gitExecutable = process.platform === 'win32' ? 'git.exe' : 'git';
const governanceFiles = new Set(['AGENTS.md', 'CLAUDE.md']);
const governancePrefixes = ['.ai-governance/', '.agents/', '.claude/', '.cursor/', 'docs/ai/', 'docs/memory/', 'harness/', 'tools/hooks/'];

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: options.cwd,
    env: options.env ?? process.env,
    encoding: 'utf8',
    maxBuffer: 16 * 1024 * 1024,
    timeout: options.timeout ?? 180_000,
  });
}

function commandLabel(command, args) {
  return [command, ...args].map((part) => JSON.stringify(part)).join(' ');
}

function runRecorded(evidence, command, args, options = {}) {
  const result = run(command, args, options);
  evidence.commands.push({
    command: commandLabel(command, args),
    exitCode: result.status,
    signal: result.signal,
    stdout: result.stdout,
    stderr: result.stderr,
  });
  return result;
}

function expectExit(result, expected, label) {
  assert.equal(
    result.status,
    expected,
    `${label} exited ${result.status}, expected ${expected}:\n${result.stdout}\n${result.stderr}`,
  );
}

function parseJsonOutput(result, label) {
  try {
    return JSON.parse(result.stdout);
  } catch (error) {
    assert.fail(`${label} did not emit JSON: ${error.message}\n${result.stdout}\n${result.stderr}`);
  }
}

function sha256File(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function sha256Text(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function listTree(root, relative = '') {
  const absolute = path.join(root, relative);
  const entries = [];
  for (const item of fs.readdirSync(absolute, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (!relative && item.name === '.git') continue;
    const child = relative ? `${relative}/${item.name}` : item.name;
    if (item.isDirectory()) {
      entries.push({ path: `${child}/`, type: 'directory' });
      entries.push(...listTree(root, child));
    } else if (item.isSymbolicLink()) {
      entries.push({ path: child, type: 'link', target: fs.readlinkSync(path.join(root, child)) });
    } else {
      entries.push({ path: child, type: 'file', sha256: sha256File(path.join(root, child)) });
    }
  }
  return entries;
}

function git(evidence, root, args, expected = 0) {
  const result = runRecorded(evidence, gitExecutable, ['-C', root, ...args]);
  expectExit(result, expected, `git ${args.join(' ')}`);
  return result;
}

function initializeGitRepository(evidence, root) {
  git(evidence, root, ['init', '--quiet']);
  git(evidence, root, ['add', '-A']);
  git(evidence, root, [
    '-c', 'user.name=AICG Scenario',
    '-c', 'user.email=aicg-scenario@example.invalid',
    'commit', '--quiet', '--allow-empty', '-m', 'Initial scenario state',
  ]);
}

function commitScenarioState(evidence, root, message) {
  git(evidence, root, ['add', '-A']);
  const diff = git(evidence, root, ['diff', '--cached', '--name-status']).stdout;
  git(evidence, root, [
    '-c', 'user.name=AICG Scenario',
    '-c', 'user.email=aicg-scenario@example.invalid',
    'commit', '--quiet', '-m', message,
  ]);
  return diff;
}

function changedPathsFromStagedDiff(diff) {
  return diff.trim().split(/\r?\n/u).filter(Boolean).map((line) => line.split('\t').at(-1).replaceAll('\\', '/'));
}

function assertGovernanceOnlyDiff(diff, label) {
  const paths = changedPathsFromStagedDiff(diff);
  assert.ok(paths.length > 0, `${label} must produce governance artifacts`);
  const unexpected = paths.filter((relative) => !governanceFiles.has(relative) && !governancePrefixes.some((prefix) => relative.startsWith(prefix)));
  assert.deepEqual(unexpected, [], `${label} changed non-governance paths: ${unexpected.join(', ')}`);
}

function assertClean(evidence, root, label) {
  const status = git(evidence, root, ['status', '--porcelain=v1']).stdout;
  assert.equal(status, '', `${label} left an unexpected Git diff:\n${status}`);
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function installPackedCli(evidence, scenarioRoot) {
  const packDirectory = path.join(scenarioRoot, 'pack');
  const installDirectory = path.join(scenarioRoot, 'installed tool');
  const npmCache = path.join(scenarioRoot, 'npm-cache');
  fs.mkdirSync(packDirectory, { recursive: true });
  const env = { ...process.env, npm_config_cache: npmCache };
  const packed = runRecorded(evidence, npmExecutable, [
    'pack', '--ignore-scripts', '--json', '--pack-destination', packDirectory,
  ], { cwd: packageRoot, env });
  expectExit(packed, 0, 'npm pack');
  const packResult = parseJsonOutput(packed, 'npm pack');
  assert.equal(packResult.length, 1);
  const tarball = path.join(packDirectory, packResult[0].filename);
  assert.ok(fs.statSync(tarball).isFile(), `missing packed tarball ${tarball}`);
  const installed = runRecorded(evidence, npmExecutable, [
    'install', '--prefix', installDirectory, tarball, '--ignore-scripts', '--no-audit', '--no-fund',
  ], { env });
  expectExit(installed, 0, 'install packed AICG');
  const cli = path.join(installDirectory, 'node_modules', 'ai-code-governance', 'bin', 'aicg.js');
  assert.ok(fs.statSync(cli).isFile(), `missing installed CLI ${cli}`);
  const version = runRecorded(evidence, process.execPath, [cli, '--version']);
  expectExit(version, 0, 'installed aicg --version');
  return {
    cli,
    tarball,
    tarballSha256: sha256File(tarball),
    version: version.stdout.trim(),
    packagingCommands: structuredClone(evidence.commands),
  };
}

function runAicg(evidence, cli, args, expected = 0) {
  const result = runRecorded(evidence, process.execPath, [cli, ...args]);
  expectExit(result, expected, `aicg ${args.join(' ')}`);
  return result;
}

function baseEvidence(name, packed) {
  return {
    schemaVersion: 1,
    scenario: name,
    packageArtifact: {
      sha256: packed.tarballSha256,
      version: packed.version,
      commands: packed.packagingCommands,
    },
    commands: [],
    snapshots: {},
    gitDiffs: {},
    assertions: {},
  };
}

function greenfieldScenario(cli, packed, root) {
  const project = path.join(root, 'new project');
  fs.mkdirSync(project, { recursive: true });
  const evidence = baseEvidence('greenfield', packed);
  initializeGitRepository(evidence, project);
  evidence.snapshots.before = listTree(project);

  const doctor = runAicg(evidence, cli, ['doctor', project, '--json']);
  assert.equal(parseJsonOutput(doctor, 'greenfield doctor').ok, true);
  const assessment = parseJsonOutput(runAicg(evidence, cli, ['assess', project]), 'greenfield assess');
  assert.equal(assessment.classification.codebase.lifecycle.value, 'greenfield');
  runAicg(evidence, cli, ['init', project, '--yes', '--no-assist']);
  runAicg(evidence, cli, ['check', project, '--json']);
  assert.equal(fs.existsSync(path.join(project, 'src')), false, 'governance init must not create product source directories');
  evidence.snapshots.afterInitialization = listTree(project);
  git(evidence, project, ['add', '-A']);
  evidence.gitDiffs.initialization = git(evidence, project, ['diff', '--cached', '--name-status']).stdout;
  assertGovernanceOnlyDiff(evidence.gitDiffs.initialization, 'greenfield initialization');
  git(evidence, project, [
    '-c', 'user.name=AICG Scenario',
    '-c', 'user.email=aicg-scenario@example.invalid',
    'commit', '--quiet', '-m', 'Initialize governance',
  ]);

  const secondInit = runAicg(evidence, cli, ['init', project, '--yes', '--no-assist']);
  assert.match(secondInit.stdout, /changed_files=0/u);
  const firstSync = runAicg(evidence, cli, ['sync', project]);
  assert.match(firstSync.stdout, /"changed": \[\]/u);
  const secondSync = runAicg(evidence, cli, ['sync', project]);
  assert.match(secondSync.stdout, /"changed": \[\]/u);
  assertClean(evidence, project, 'idempotent greenfield init and sync');

  const cursorAdapter = path.join(project, '.cursor', 'rules', 'ai-code-governance.mdc');
  fs.appendFileSync(cursorAdapter, '\nmanual drift\n');
  runAicg(evidence, cli, ['check', project, '--json'], 1);
  runAicg(evidence, cli, ['sync', project], 2);
  runAicg(evidence, cli, ['sync', project, '--force']);
  runAicg(evidence, cli, ['check', project, '--json']);
  assertClean(evidence, project, 'forced managed-adapter recovery');

  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.writeFileSync(path.join(project, 'src', 'rogue.js'), 'export const rogue = true;\n');
  const rejected = runAicg(evidence, cli, ['check', project, '--json'], 1);
  assert.match(rejected.stdout, /architecture placement/u);
  fs.mkdirSync(path.join(project, 'src', 'modules', 'example'), { recursive: true });
  fs.renameSync(path.join(project, 'src', 'rogue.js'), path.join(project, 'src', 'modules', 'example', 'rogue.js'));
  runAicg(evidence, cli, ['check', project, '--json']);
  evidence.assertions = {
    lifecycle: 'greenfield',
    initIdempotent: true,
    syncIdempotent: true,
    managedDriftDetectedAndRecovered: true,
    placementNegativeAndPositive: true,
    initializationDiffGovernanceOnly: true,
  };
  evidence.snapshots.afterRecovery = listTree(project);
  return evidence;
}

function brownfieldScenario(cli, packed, root) {
  const project = path.join(root, 'existing project');
  const config = path.join(root, 'brownfield-answers.json');
  fs.mkdirSync(path.join(project, 'src'), { recursive: true });
  fs.mkdirSync(path.join(project, 'test'), { recursive: true });
  const packageDocument = {
    name: 'real-brownfield-fixture',
    private: true,
    type: 'module',
    scripts: { test: 'node --test' },
  };
  const userAgents = '# Existing team rules\n\nKeep this user-authored instruction unchanged.\n';
  const legacySource = 'export function add(left, right) { return left + right; }\n';
  const legacyTest = "import assert from 'node:assert/strict';\nimport test from 'node:test';\nimport { add } from '../src/math.js';\ntest('adds', () => assert.equal(add(2, 3), 5));\n";
  fs.writeFileSync(path.join(project, 'package.json'), `${JSON.stringify(packageDocument, null, 2)}\n`);
  fs.writeFileSync(path.join(project, 'AGENTS.md'), userAgents);
  fs.writeFileSync(path.join(project, 'src', 'math.js'), legacySource);
  fs.writeFileSync(path.join(project, 'test', 'math.test.js'), legacyTest);
  writeJson(config, { initialization: { lifecycle: 'existing', existingCodeStrategy: 'new-code-standard' } });

  const evidence = baseEvidence('brownfield-new-code-standard', packed);
  initializeGitRepository(evidence, project);
  evidence.snapshots.before = listTree(project);
  const protectedHashes = {
    packageJson: sha256File(path.join(project, 'package.json')),
    legacySource: sha256Text(legacySource),
    legacyTest: sha256Text(legacyTest),
  };
  const originalTest = runRecorded(evidence, npmExecutable, ['test'], { cwd: project });
  expectExit(originalTest, 0, 'brownfield original npm test');

  const doctor = runAicg(evidence, cli, ['doctor', project, '--json']);
  assert.equal(parseJsonOutput(doctor, 'brownfield doctor').ok, true);
  const assessment = parseJsonOutput(runAicg(evidence, cli, ['assess', project]), 'brownfield assess');
  assert.equal(assessment.classification.codebase.lifecycle.value, 'existing');
  runAicg(evidence, cli, ['init', project, '--config', config, '--yes', '--no-assist']);
  runAicg(evidence, cli, ['check', project, '--json']);
  const afterTest = runRecorded(evidence, npmExecutable, ['test'], { cwd: project });
  expectExit(afterTest, 0, 'brownfield npm test after initialization');

  assert.equal(sha256File(path.join(project, 'package.json')), protectedHashes.packageJson, 'package.json changed');
  assert.equal(sha256File(path.join(project, 'src', 'math.js')), protectedHashes.legacySource, 'legacy source changed');
  assert.equal(sha256File(path.join(project, 'test', 'math.test.js')), protectedHashes.legacyTest, 'legacy test changed');
  const agents = fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8');
  assert.ok(agents.includes(userAgents.trim()), 'existing AGENTS.md content was not preserved');
  assert.equal((agents.match(/Keep this user-authored instruction unchanged\./gu) ?? []).length, 1);

  evidence.snapshots.afterInitialization = listTree(project);
  evidence.gitDiffs.initialization = commitScenarioState(evidence, project, 'Initialize governance');
  assertGovernanceOnlyDiff(evidence.gitDiffs.initialization, 'brownfield initialization');
  const secondInit = runAicg(evidence, cli, ['init', project, '--config', config, '--yes', '--no-assist']);
  assert.match(secondInit.stdout, /changed_files=0/u);
  const firstSync = runAicg(evidence, cli, ['sync', project]);
  assert.match(firstSync.stdout, /"changed": \[\]/u);
  const secondSync = runAicg(evidence, cli, ['sync', project]);
  assert.match(secondSync.stdout, /"changed": \[\]/u);
  assertClean(evidence, project, 'idempotent brownfield init and sync');

  fs.writeFileSync(path.join(project, 'src', 'new-flat-service.js'), 'export const service = true;\n');
  const rejected = runAicg(evidence, cli, ['check', project, '--json'], 1);
  assert.match(rejected.stdout, /new-flat-service\.js/u);
  fs.mkdirSync(path.join(project, 'src', 'modules', 'orders'), { recursive: true });
  fs.renameSync(
    path.join(project, 'src', 'new-flat-service.js'),
    path.join(project, 'src', 'modules', 'orders', 'service.js'),
  );
  runAicg(evidence, cli, ['check', project, '--json']);
  assert.equal(sha256File(path.join(project, 'src', 'math.js')), protectedHashes.legacySource, 'placement recovery changed legacy source');
  assert.ok(fs.readFileSync(path.join(project, 'AGENTS.md'), 'utf8').includes(userAgents.trim()));
  evidence.assertions = {
    lifecycle: 'existing',
    strategy: 'new-code-standard',
    originalTestsBeforeAndAfter: true,
    existingUserContentPreserved: true,
    legacySourceUnchanged: true,
    initIdempotent: true,
    syncIdempotent: true,
    placementNegativeAndPositive: true,
    initializationDiffGovernanceOnly: true,
  };
  evidence.snapshots.afterPlacementRecovery = listTree(project);
  return evidence;
}

test('packed AICG passes greenfield and brownfield real-project acceptance', { timeout: 300_000 }, (context) => {
  const scenarioRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-real-scenarios-'));
  const bootstrapEvidence = { commands: [] };
  context.after(() => fs.rmSync(scenarioRoot, { recursive: true, force: true }));
  const packed = installPackedCli(bootstrapEvidence, scenarioRoot);
  const evidenceDirectory = path.join(scenarioRoot, 'evidence');
  const greenfield = greenfieldScenario(packed.cli, packed, scenarioRoot);
  const brownfield = brownfieldScenario(packed.cli, packed, scenarioRoot);
  writeJson(path.join(evidenceDirectory, 'greenfield.json'), greenfield);
  writeJson(path.join(evidenceDirectory, 'brownfield.json'), brownfield);

  for (const evidence of [greenfield, brownfield]) {
    assert.equal(evidence.packageArtifact.sha256, packed.tarballSha256);
    assert.ok(evidence.commands.every((command) => Number.isInteger(command.exitCode)));
    assert.ok(Array.isArray(evidence.snapshots.before));
    assert.ok(evidence.snapshots.afterInitialization.length > evidence.snapshots.before.length);
  }
  assert.ok(fs.statSync(path.join(evidenceDirectory, 'greenfield.json')).isFile());
  assert.ok(fs.statSync(path.join(evidenceDirectory, 'brownfield.json')).isFile());
});

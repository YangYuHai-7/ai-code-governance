#!/usr/bin/env node

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageVersion = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).version;
const fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-package-smoke-'));
const packDirectory = path.join(fixture, 'pack');
const installDirectory = path.join(fixture, 'install');
const projectDirectory = path.join(fixture, 'project with 空格');
const npmCli = process.env.npm_execpath;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', ...options });
  assert.equal(result.status, 0, `${command} ${args.join(' ')} failed:\n${result.stdout}\n${result.stderr}`);
  return result;
}

function runNpm(args, options = {}) {
  assert.ok(npmCli, 'npm_execpath is required; run this smoke test through npm run smoke:package.');
  return run(process.execPath, [npmCli, ...args], options);
}

try {
  fs.mkdirSync(packDirectory, { recursive: true });
  fs.mkdirSync(projectDirectory, { recursive: true });
  fs.writeFileSync(path.join(projectDirectory, 'package.json'), JSON.stringify({
    dependencies: { axios: '1.7.0' },
    scripts: { verify: 'node -e "process.exit(0)"' },
  }));
  fs.mkdirSync(path.join(projectDirectory, 'src'));
  fs.writeFileSync(path.join(projectDirectory, 'src', 'http-client.ts'), "import axios from 'axios';\nexport const httpClient = axios.create({});\n");
  const answers = path.join(projectDirectory, 'answers.json');
  fs.writeFileSync(answers, JSON.stringify({
    schemaVersion: 1,
    generatedBy: 'ai-code-governance',
    toolVersion: packageVersion,
    projectName: path.basename(projectDirectory),
    projectMode: 'brownfield',
    canonicalRoot: 'docs/ai',
    clients: ['codex'],
    stacks: ['generic-unknown'],
    governanceDepth: 'standard',
    artifactLanguage: 'zh-CN',
    supportedOs: ['macos', 'windows', 'linux'],
    initialization: {
      lifecycle: 'existing',
      existingCodeStrategy: 'new-code-standard',
    },
    features: {
      knowledge: false,
      taskRuntime: false,
      hooks: false,
      externalWorkflows: false,
      ciIntegration: false,
      aiAssist: false,
    },
    domainConstraints: [],
  }));
  const packed = runNpm(['pack', '--json', '--pack-destination', packDirectory], { cwd: root });
  const packResult = JSON.parse(packed.stdout);
  const tarball = path.join(packDirectory, packResult[0].filename);
  assert.ok(fs.statSync(tarball).isFile());

  const installed = runNpm(['install', '--prefix', installDirectory, tarball, '--foreground-scripts', '--no-audit', '--no-fund'], {
    env: { ...process.env, AICG_NO_AUTO_OPEN: '1' },
  });
  assert.match(installed.stdout, /Open AICG configuration at any time/);
  const installedBin = path.join(installDirectory, 'node_modules', 'ai-code-governance', 'bin', 'aicg.js');
  assert.ok(fs.statSync(installedBin).isFile());
  const installedRoot = path.dirname(path.dirname(installedBin));
  for (const relative of ['assets/config-ui/index.html', 'assets/config-ui/app.js', 'assets/config-ui/style.css', 'assets/config-ui/selector.css', 'scripts/postinstall-open-config.mjs']) {
    assert.ok(fs.statSync(path.join(installedRoot, relative)).isFile(), `missing installed configuration UI asset: ${relative}`);
  }
  const installedCommand = runNpm(['exec', '--prefix', installDirectory, '--', 'aicg', '--version']);
  assert.equal(installedCommand.stdout.trim(), packageVersion);
  const launcherDirectory = path.join(fixture, 'launcher output');
  fs.mkdirSync(launcherDirectory);
  const launcherResult = run(process.execPath, [installedBin, 'config', 'launcher', '--yes', '--output', launcherDirectory, '--json']);
  const launcher = JSON.parse(launcherResult.stdout);
  assert.equal(launcher.status, 'created');
  assert.ok(fs.statSync(launcher.path).isFile() || fs.statSync(launcher.path).isDirectory());
  assert.equal(JSON.parse(run(process.execPath, [installedBin, 'config', 'launcher', '--yes', '--output', launcherDirectory, '--json']).stdout).status, 'unchanged');
  const requestPlan = run(process.execPath, [installedBin, 'request', projectDirectory, '--text', '初始化治理框架', '--config', answers, '--dry-run', '--json']);
  const requestPayload = JSON.parse(requestPlan.stdout);
  assert.equal(requestPayload.plan.intent, 'governance.initialize');
  assert.equal(fs.existsSync(path.join(projectDirectory, 'AGENTS.md')), false);
  run(process.execPath, [installedBin, 'request', projectDirectory, '--text', '初始化治理框架', '--config', answers, `--approve=${requestPayload.plan.planHash}`, '--json']);
  assert.ok(fs.existsSync(path.join(projectDirectory, '.ai-governance', 'manifest.json')));
  run(process.execPath, [installedBin, 'init', projectDirectory, '--yes', '--no-assist']);
  const { buildArtifacts } = await import(pathToFileURL(path.join(installedRoot, 'src/generator.mjs')));
  const { scanProject } = await import(pathToFileURL(path.join(installedRoot, 'src/scanner.mjs')));
  const { applyArtifactPlan, planArtifacts } = await import(pathToFileURL(path.join(installedRoot, 'src/managed-files.mjs')));
  const installedConfig = JSON.parse(fs.readFileSync(path.join(projectDirectory, '.ai-governance/config.json'), 'utf8'));
  const firstUse = buildArtifacts(installedConfig, { ...scanProject(projectDirectory), governanceUsage: ['release', 'surface', 'acceptance'] });
  for (const relative of ['release-acceptance-policy.json', 'surface-verification-profiles.json', 'acceptance-contract.json']) {
    const artifact = firstUse.find((entry) => entry.path === `docs/ai/${relative}`);
    assert.match(artifact.content, /[\u3400-\u9fff]/u, `installed Chinese first-use artifact: ${relative}`);
  }
  applyArtifactPlan(projectDirectory, planArtifacts(projectDirectory, firstUse));
  run(process.execPath, [installedBin, 'check', projectDirectory, '--json']);
  const standardsPreview = run(process.execPath, [installedBin, 'standards', projectDirectory, '--json']);
  assert.equal(JSON.parse(standardsPreview.stdout).mode, 'read-only-preview');
  const chatStandardsPreview = run(process.execPath, [installedBin, 'request', projectDirectory, '--text', '生成技术规范预览', '--json']);
  assert.equal(JSON.parse(chatStandardsPreview.stdout).intent.id, 'technical-standards.preview');
  const harvestPreview = run(process.execPath, [installedBin, 'harvest', projectDirectory, '--dry-run', '--json']);
  assert.equal(JSON.parse(harvestPreview.stdout).harvest.mode, 'read-only-preview');
  run(process.execPath, [installedBin, 'harvest', projectDirectory, '--yes', '--json']);
  const promotion = run(process.execPath, [installedBin, 'promote', projectDirectory, '--id', 'project-http-client', '--entrypoint', 'src/http-client.ts', '--verify', 'npm run verify', '--yes', '--json']);
  assert.equal(JSON.parse(promotion.stdout).promotion.status, 'adopted');
  run(process.execPath, [installedBin, 'check', projectDirectory, '--json']);
  assert.ok(fs.existsSync(path.join(projectDirectory, '.ai-governance', 'manifest.json')));
  console.log('package_smoke=pass');
} finally {
  fs.rmSync(fixture, { recursive: true, force: true });
}

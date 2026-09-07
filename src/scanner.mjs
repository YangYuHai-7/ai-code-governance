import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadAgentRegistry, loadCapabilityRegistry } from './registry.mjs';
import { commandExists, commandVersion, exists, matchSimpleGlob, normalizeRelative, readJson, readText, walkFiles } from './utils.mjs';

const GOVERNANCE_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursor/rules',
  '.claude/skills',
  '.agents/skills',
  'docs/ai',
  '.ai-governance/config.json',
];

function gitRoot(target) {
  const result = spawnSync('git', ['-C', target, 'rev-parse', '--show-toplevel'], {
    encoding: 'utf8',
    timeout: 5000,
  });
  return result.status === 0 ? result.stdout.trim() : null;
}

function detectProjectMode(root, files) {
  const names = new Set(files.map((file) => file.relative));
  let packageJson = null;
  if (exists(path.join(root, 'package.json'))) {
    try {
      packageJson = readJson(path.join(root, 'package.json'));
    } catch {
      packageJson = null;
    }
  }
  if (
    names.has('pnpm-workspace.yaml') ||
    names.has('lerna.json') ||
    names.has('nx.json') ||
    names.has('turbo.json') ||
    packageJson?.workspaces
  ) {
    return 'monorepo';
  }
  const manifestNames = ['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'pyproject.toml', 'go.mod', 'composer.json'];
  return files.some((file) => manifestNames.some((name) => file.relative.endsWith(name))) ? 'brownfield' : 'greenfield';
}

function manifestText(files, patterns) {
  const matched = files.filter(
    (file) => file.type === 'file' && patterns.some((pattern) => matchSimpleGlob(file.relative, pattern)),
  );
  const text = matched
    .map((file) => {
      try {
        return readText(file.absolute);
      } catch {
        return '';
      }
    })
    .join('\n');
  return { matched, text };
}

function detectStacks(files, registry) {
  const detected = [];
  for (const pack of registry.packs) {
    if (pack.id === 'generic-unknown') continue;
    const patterns = pack.detect?.manifest_any ?? [];
    if (patterns.length === 0) continue;
    const { matched, text } = manifestText(files, patterns);
    if (matched.length === 0) continue;
    const dependencies = pack.detect?.dependency_any ?? [];
    if (dependencies.length > 0 && !dependencies.some((dependency) => text.includes(dependency))) continue;
    detected.push({
      id: pack.id,
      evidence: pack.evidence,
      lifecycle: pack.lifecycle,
      paths: matched.map((file) => file.relative).slice(0, 8),
    });
  }
  if (detected.length === 0) {
    const fallback = registry.packs.find((pack) => pack.id === 'generic-unknown');
    detected.push({ id: fallback.id, evidence: fallback.evidence, lifecycle: fallback.lifecycle, paths: [] });
  }
  return detected;
}

function detectCommands(root) {
  const commands = [];
  const packagePath = path.join(root, 'package.json');
  if (exists(packagePath)) {
    try {
      const pkg = readJson(packagePath);
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        commands.push({ name, command: `npm run ${name}`, source: 'package.json', implementation: command });
      }
    } catch {
      // Invalid project manifests are reported as repository facts, not fatal scanner errors.
    }
  }
  if (exists(path.join(root, 'pom.xml'))) commands.push({ name: 'maven-test', command: 'mvn test', source: 'pom.xml' });
  if (exists(path.join(root, 'gradlew')) || exists(path.join(root, 'gradlew.bat'))) {
    commands.push({ name: 'gradle-test', command: process.platform === 'win32' ? 'gradlew.bat test' : './gradlew test', source: 'gradlew' });
  }
  if (exists(path.join(root, 'go.mod'))) commands.push({ name: 'go-test', command: 'go test ./...', source: 'go.mod' });
  if (exists(path.join(root, 'pyproject.toml'))) commands.push({ name: 'python-test', command: 'pytest', source: 'pyproject.toml' });
  return commands;
}

function platformId() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

export function scanProject(target) {
  const root = path.resolve(target);
  const stat = fs.existsSync(root) ? fs.statSync(root) : null;
  if (!stat?.isDirectory()) throw new Error(`Target directory does not exist: ${root}`);

  const files = walkFiles(root, { maxDepth: 5 });
  const capabilityRegistry = loadCapabilityRegistry();
  const agentRegistry = loadAgentRegistry();
  const agents = agentRegistry.agents.map((agent) => {
    const command = agent.detect_commands.find((candidate) => commandExists(candidate)) ?? null;
    return {
      id: agent.id,
      label: agent.label,
      installed: agent.id === 'generic' || Boolean(command),
      command,
      version: command ? commandVersion(command) : null,
    };
  });

  const existingGovernance = GOVERNANCE_PATHS.filter((relative) => exists(path.join(root, relative)));
  const links = files.filter((file) => file.type === 'link').map((file) => file.relative);
  const externalWorkflows = [];
  if (['openspec/config.yaml', 'openspec/specs', 'openspec/changes'].some((relative) => exists(path.join(root, relative)))) {
    externalWorkflows.push('openspec-change-governance');
  }
  if (exists(path.join(root, '.codex-plugin/plugin.json')) || exists(path.join(root, '.claude-plugin/plugin.json'))) {
    externalWorkflows.push('superpowers-execution-discipline');
  }

  return {
    root,
    gitRoot: gitRoot(root),
    projectName: path.basename(root),
    projectMode: detectProjectMode(root, files),
    currentOs: platformId(),
    architecture: os.arch(),
    files,
    stacks: detectStacks(files, capabilityRegistry),
    commands: detectCommands(root),
    agents,
    existingGovernance,
    links,
    externalWorkflows,
  };
}
export function scanSummary(scan) {
  return {
    target: scan.root,
    git_root: scan.gitRoot,
    project_mode: scan.projectMode,
    current_os: scan.currentOs,
    detected_stacks: scan.stacks,
    detected_commands: scan.commands,
    agents: scan.agents,
    existing_governance: scan.existingGovernance,
    links: scan.links,
    external_workflows: scan.externalWorkflows,
  };
}

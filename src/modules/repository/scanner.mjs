import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAgentRegistry, loadCapabilityRegistry } from '../../catalogs/index.mjs';
import { LOCAL_OUTPUT_PREFIXES } from '../../constants.mjs';
import { commandExists, commandVersion, resolveGitRoot } from '../../adapters/process/index.mjs';
import { exists, readJson, readText, walkFilesDetailed } from '../../adapters/filesystem/index.mjs';
import { matchSimpleGlob, normalizeRelative } from '../../shared/index.mjs';

const GOVERNANCE_PATHS = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursor/rules',
  '.claude/skills',
  '.agents/skills',
  'docs/ai',
  '.ai-governance/config.json',
];

const DEFAULT_SCAN_BUDGET = Object.freeze({
  maxDepth: 32,
  maxFiles: 50000,
  maxFileBytes: 2 * 1024 * 1024,
  maxDirectories: 20000,
  maxEntries: 100000,
});

const NPM_VERIFICATION_SCRIPT = /^(?:test|verify|check|lint|typecheck|type-check|build)(?::|$)/i;

export function verificationNpmCommands(commands) {
  const npmCommands = commands.filter((candidate) => candidate.source === 'package.json');
  const names = new Set(npmCommands.map((candidate) => candidate.name));
  return npmCommands.filter((candidate) => (
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(candidate.name)
    && NPM_VERIFICATION_SCRIPT.test(candidate.name)
    && !names.has(`pre${candidate.name}`)
    && !names.has(`post${candidate.name}`)
  ));
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
    (file) => file.type === 'file' && file.contentScannable !== false && patterns.some((pattern) => matchSimpleGlob(file.relative, pattern)),
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
        if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(name)) continue;
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

function detectPackageDependencies(files) {
  const packages = new Map();
  for (const file of files) {
    if (file.type !== 'file' || file.contentScannable === false || path.basename(file.relative) !== 'package.json') continue;
    try {
      const manifest = readJson(file.absolute);
      const sections = ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'];
      for (const section of sections) {
        for (const [name, version] of Object.entries(manifest[section] ?? {})) {
          if (typeof name !== 'string' || typeof version !== 'string') continue;
          const current = packages.get(name) ?? { versions: new Set(), paths: new Set(), sections: new Set() };
          current.versions.add(version);
          current.paths.add(file.relative);
          current.sections.add(section);
          packages.set(name, current);
        }
      }
    } catch {
      // Invalid manifests remain scanner evidence but cannot provide dependency facts.
    }
  }
  return Object.fromEntries([...packages.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([name, detail]) => [name, {
      versions: [...detail.versions].sort((left, right) => left.localeCompare(right)),
      paths: [...detail.paths].sort((left, right) => left.localeCompare(right)),
      sections: [...detail.sections].sort((left, right) => left.localeCompare(right)),
    }]));
}

function platformId() {
  if (process.platform === 'darwin') return 'macos';
  if (process.platform === 'win32') return 'windows';
  return 'linux';
}

export function scanProject(target, options = {}) {
  const probeEnvironment = options.probeEnvironment === true;
  const root = path.resolve(target);
  const stat = fs.existsSync(root) ? fs.statSync(root) : null;
  if (!stat?.isDirectory()) throw new Error(`Target directory does not exist: ${root}`);

  // Governance decisions and placement gates must see the complete product tree.
  // `walkFiles` records links but never follows them. Build outputs are ignored only at
  // the repository root so a nested directory cannot become an unscanned escape hatch.
  const scanBudget = { ...DEFAULT_SCAN_BUDGET, ...(options.scanBudget ?? {}) };
  const walked = walkFilesDetailed(root, {
    ...scanBudget,
    ignoredAtAnyDepth: ['.git', 'node_modules'],
    ignoredAtRoot: LOCAL_OUTPUT_PREFIXES.map((prefix) => prefix.replace(/\/$/, '')),
    caseInsensitiveIgnored: true,
  });
  const files = walked.files;
  const factFiles = files.filter((file) => !LOCAL_OUTPUT_PREFIXES.some((prefix) => file.relative.startsWith(prefix)));
  const capabilityRegistry = loadCapabilityRegistry();
  const agentRegistry = loadAgentRegistry();
  const gitCommand = probeEnvironment && commandExists('git');
  const detectedGitRoot = gitCommand ? resolveGitRoot(root) : null;
  const agents = agentRegistry.agents.map((agent) => {
    const command = probeEnvironment ? agent.detect_commands.find((candidate) => commandExists(candidate)) ?? null : null;
    return {
      id: agent.id,
      label: agent.label,
      installed: agent.id === 'generic' || Boolean(command),
      availability: agent.id === 'generic' ? 'built-in' : probeEnvironment ? (command ? 'detected' : 'not-found') : 'not-probed',
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
    gitRoot: detectedGitRoot,
    git: {
      availability: probeEnvironment ? (gitCommand ? 'detected' : 'not-found') : 'not-probed',
      version: gitCommand ? commandVersion('git') : null,
      root: detectedGitRoot,
    },
    environmentProbe: probeEnvironment ? 'executed' : 'not-probed',
    projectName: path.basename(root),
    projectMode: detectProjectMode(root, factFiles),
    currentOs: platformId(),
    architecture: os.arch(),
    files,
    scanBudget: walked.budget,
    stacks: detectStacks(factFiles, capabilityRegistry),
    packageDependencies: detectPackageDependencies(factFiles),
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
    git: scan.git,
    project_mode: scan.projectMode,
    current_os: scan.currentOs,
    detected_stacks: scan.stacks,
    detected_packages: scan.packageDependencies,
    detected_commands: scan.commands,
    agents: scan.agents,
    existing_governance: scan.existingGovernance,
    links: scan.links,
    scan_budget: scan.scanBudget,
    external_workflows: scan.externalWorkflows,
  };
}

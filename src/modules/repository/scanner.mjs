import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadAgentRegistry, loadCapabilityRegistry } from '../../catalogs/index.mjs';
import { LOCAL_OUTPUT_PREFIXES } from '../../constants.mjs';
import { commandExists, commandVersion, resolveGitRoot } from '../../adapters/process/index.mjs';
import { exists, readJson, readText, walkFilesDetailed } from '../../adapters/filesystem/index.mjs';
import { matchSimpleGlob, normalizeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { dependencyFacts } from './dependencies.mjs';
import { loadAicgIgnore, scanExclusionEvidenceHash } from './aicg-ignore.mjs';
import {
  discoverRepositoryFamily,
  isRepositoryFamilyBoundary,
  mergeDiscoveredRepositoryMembers,
  nestedGitRepositoryMember,
} from './repository-family.mjs';
import { evaluateVerificationCommandTrust } from './verification-commands.mjs';
import { isProductionScopePath } from './production-scope.mjs';
import { governanceRoots } from '../../catalogs/index.mjs';

const DEFAULT_SCAN_BUDGET = Object.freeze({
  maxDepth: 32,
  maxFiles: 50000,
  maxFileBytes: 2 * 1024 * 1024,
  maxDirectories: 20000,
  maxEntries: 100000,
});

const NPM_VERIFICATION_SCRIPT = /^(?:test|verify|check|lint|typecheck|type-check|build)(?::|$)/i;
const CODE_EXTENSIONS = new Set(['.c', '.cc', '.cpp', '.cs', '.cjs', '.cts', '.dart', '.go', '.h', '.hpp', '.java', '.js', '.jsx', '.kt', '.kts', '.mjs', '.mts', '.php', '.py', '.rb', '.rs', '.sh', '.svelte', '.swift', '.ts', '.tsx', '.vue']);
const NON_CODE_CONTENT_DIRECTORIES = new Set(['.swc', 'assets', 'coverage', 'dist', 'logs', 'public', 'static', 'target', 'test', 'tests', 'fixtures', '__fixtures__']);
const NON_CODE_CONTENT_EXTENSIONS = new Set(['.7z', '.apk', '.avif', '.bin', '.bmp', '.bz2', '.class', '.dmg', '.exe', '.gif', '.gz', '.ico', '.jar', '.jpeg', '.jpg', '.mp3', '.mp4', '.otf', '.pdf', '.png', '.tar', '.tgz', '.ttf', '.wav', '.webm', '.webp', '.woff', '.woff2', '.zip']);

export function verificationNpmCommands(commands) {
  const npmCommands = commands.filter((candidate) => candidate.source === 'package.json');
  const names = new Set(npmCommands.map((candidate) => candidate.name));
  return npmCommands.filter((candidate) => (
    /^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(candidate.name)
    && NPM_VERIFICATION_SCRIPT.test(candidate.name)
    && !names.has(`pre${candidate.name}`)
    && !names.has(`post${candidate.name}`)
    && candidate.verification?.trust?.level === 'structurally-trusted'
  ));
}

function isGeneratedJavaScriptBundle(file) {
  if (!['.js', '.mjs', '.cjs'].includes(path.extname(file.relative).toLowerCase())) return false;
  let sample;
  try {
    const descriptor = fs.openSync(file.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
    try {
      const buffer = Buffer.alloc(64 * 1024);
      const read = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
      sample = buffer.subarray(0, read).toString('utf8');
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {
    // An unreadable oversized code file remains a blocking scan gap.
    return false;
  }
  const lines = sample.split(/\r?\n/);
  if (sample.length >= 4096 && (lines.length <= 2 || Math.max(...lines.map((line) => line.length)) > 2048)) return true;
  const segments = normalizeRelative(file.relative).toLowerCase().split('/');
  const vendorLocation = segments.some((segment) => /^(?:vendor|vendors|third[-_]?party|libs?)$/.test(segment) || /-js$/.test(segment));
  if (!vendorLocation) return false;
  const umdSignals = [
    /typeof exports\s*===?\s*["']object["']/,
    /module\.exports\s*=/,
    /typeof define\s*===?\s*["']function["']/,
    /define\.amd/,
  ];
  return sample.length >= 4096 && umdSignals.every((signal) => signal.test(sample));
}

function isOversizedFileRelevantToCodeScan(file) {
  const normalized = normalizeRelative(file.relative).toLowerCase();
  const segments = normalized.split('/');
  const extension = path.extname(normalized);
  if (segments.some((segment) => NON_CODE_CONTENT_DIRECTORIES.has(segment))) return false;
  if (NON_CODE_CONTENT_EXTENSIONS.has(extension)) return false;
  if (!CODE_EXTENSIONS.has(extension)) return false;
  // Minified vendor bundles are static dependencies, even when a project keeps
  // them beside source files instead of under a conventional public directory.
  return !isGeneratedJavaScriptBundle(file);
}

function detectProjectMode(root, files, repositoryFamily = null) {
  if ((repositoryFamily?.members.length ?? 0) > 0) return 'repository-family';
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

function detectStacks(files, registry, facts) {
  const detected = [];
  for (const pack of registry.packs) {
    if (pack.id === 'generic-unknown') continue;
    const patterns = pack.detect?.manifest_any ?? [];
    if (patterns.length === 0) continue;
    const { matched, text } = manifestText(files, patterns);
    if (matched.length === 0) continue;
    const dependencies = pack.detect?.dependency_any ?? [];
    if (dependencies.length > 0 && !dependencies.some((dependency) => facts.some((fact) => matched.some((file) => file.relative === fact.sourcePath)
      && (fact.name === dependency
        || (fact.ecosystem === 'dotnet' && dependency === 'Microsoft.NET.Sdk' && /^Microsoft\.NET\.Sdk\.(?:Web|Razor|Worker|BlazorWebAssembly|WindowsDesktop)$/.test(fact.name))
        || (fact.ecosystem === 'cmake' && dependency === 'Qt' && /^Qt[56]$/.test(fact.name))
        || (['maven', 'gradle', 'go'].includes(fact.ecosystem) && fact.name.includes(dependency)))))) continue;
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

function commandId(unitId, runner, name) {
  return `${unitId}:${runner}:${sha256(name).slice(0, 16)}`;
}

function trustedCommand(input, evidence, legacy) {
  const verification = evaluateVerificationCommandTrust(input, evidence);
  if (!verification.purpose.includes('verification')) verification.trust = {
    level: 'declared',
    reasons: [{ code: 'verification-purpose-not-detected', severity: 'warning', message: 'The command name does not identify a verification purpose.' }],
  };
  return { ...legacy, verification };
}

function detectCommands(root, unitId = 'root', cwd = '.') {
  const commands = [];
  const packagePath = path.join(root, 'package.json');
  if (exists(packagePath)) {
    try {
      const pkg = readJson(packagePath);
      const digest = sha256(readText(packagePath));
      for (const [name, command] of Object.entries(pkg.scripts ?? {})) {
        if (!/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(name)) continue;
        commands.push(trustedCommand({
          id: commandId(unitId, 'npm', name), unitId, cwd, argv: ['npm', 'run', name],
          source: { kind: 'npm-script', path: cwd === '.' ? 'package.json' : `${cwd}/package.json`, sha256: digest, scriptName: name },
          purpose: NPM_VERIFICATION_SCRIPT.test(name) ? ['verification'] : [], scopeGlobs: [], sideEffects: [],
        }, { npmScripts: pkg.scripts ?? {} }, { name, command: `npm run ${name}`, source: 'package.json', implementation: command }));
      }
    } catch {
      // Invalid project manifests are reported as repository facts, not fatal scanner errors.
    }
  }
  if (exists(path.join(root, 'pom.xml'))) {
    const pomText = readText(path.join(root, 'pom.xml'));
    commands.push(trustedCommand({
      id: commandId(unitId, 'maven', 'test'), unitId, cwd, argv: ['mvn', 'test'],
      source: { kind: 'maven-pom', path: cwd === '.' ? 'pom.xml' : `${cwd}/pom.xml`, sha256: sha256(pomText) },
      purpose: ['verification'], scopeGlobs: [], sideEffects: ['build-output'],
    }, { pomText }, { name: 'maven-test', command: 'mvn test', source: 'pom.xml' }));
  }
  if (exists(path.join(root, 'gradlew')) || exists(path.join(root, 'gradlew.bat'))) {
    const executable = process.platform === 'win32' ? 'gradlew.bat' : './gradlew';
    commands.push(trustedCommand({
      id: commandId(unitId, 'gradle', 'test'), unitId, cwd, argv: [executable, 'test'],
      source: { kind: 'declared', path: cwd === '.' ? 'gradlew' : `${cwd}/gradlew` }, purpose: ['verification'], scopeGlobs: [], sideEffects: ['build-output'],
    }, {}, { name: 'gradle-test', command: `${executable} test`, source: 'gradlew' }));
  }
  if (exists(path.join(root, 'go.mod'))) commands.push(trustedCommand({
    id: commandId(unitId, 'go', 'test'), unitId, cwd, argv: ['go', 'test', './...'], source: { kind: 'declared', path: cwd === '.' ? 'go.mod' : `${cwd}/go.mod` }, purpose: ['verification'], scopeGlobs: [], sideEffects: ['build-cache'],
  }, {}, { name: 'go-test', command: 'go test ./...', source: 'go.mod' }));
  if (exists(path.join(root, 'pyproject.toml'))) commands.push(trustedCommand({
    id: commandId(unitId, 'python', 'test'), unitId, cwd, argv: ['pytest'], source: { kind: 'declared', path: cwd === '.' ? 'pyproject.toml' : `${cwd}/pyproject.toml` }, purpose: ['verification'], scopeGlobs: [], sideEffects: ['test-cache'],
  }, {}, { name: 'python-test', command: 'pytest', source: 'pyproject.toml' }));
  return commands;
}

// Governance boundary prefixes: the framework-owned roots plus every client
// Skill/rule directory the agent registry declares. Reading the registry here
// means registering a new client teaches the scanner about its governance tree
// with no generator change, instead of silently misclassifying its files as
// production source. The legacy roots keep their historical form so existing
// recorded scans stay unchanged.
const GOVERNANCE_EXCLUSION_DIRECTORIES = [
  '\\.ai-governance',
  'docs\\/ai',
  ...new Set(governanceRoots()
    .filter((relative) => relative !== 'docs/ai' && relative.includes('/'))
    .map((relative) => relative.split('/')[0])),
];
const GOVERNANCE_EXCLUSION_PATTERN = new RegExp(`^(?:${GOVERNANCE_EXCLUSION_DIRECTORIES.join('|')})(?:/|$)`);

function exclusionCategory(entry) {
  if (entry.type === 'directory') return 'directory-subtree';
  const relative = entry.relative.toLowerCase();
  const base = path.posix.basename(relative);
  const extension = path.posix.extname(relative);
  if (relative === '.gitmodules' || GOVERNANCE_EXCLUSION_PATTERN.test(relative) || ['agents.md', 'claude.md'].includes(relative)) return 'governance-or-repository-boundary';
  if (['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'pyproject.toml', 'go.mod', 'go.work', 'composer.json', 'pnpm-workspace.yaml', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock'].includes(base)) return 'manifest-or-lockfile';
  if (['.sql', '.tf', '.hcl'].includes(extension)) return 'infrastructure-or-data-source';
  if (['.yaml', '.yml'].includes(extension)) return 'configuration-or-contract';
  if (/\.(?:c|cc|cpp|cs|cjs|cts|dart|go|h|hpp|java|js|jsx|kt|kts|mjs|mts|php|py|rb|rs|sh|svelte|swift|ts|tsx|vue)$/.test(relative)) return 'product-source';
  if (isProductionScopePath(entry.relative)) return 'product-source';
  return 'generated-or-opaque';
}

const EXCLUSION_SNAPSHOT_BUDGET = Object.freeze({
  maxDepth: 32,
  maxFiles: 4096,
  maxFileBytes: 2 * 1024 * 1024,
  maxDirectories: 2048,
  maxEntries: 8192,
  maxTotalBytes: 16 * 1024 * 1024,
});

function boundedFileDigest(absolute, expectedSize = null) {
  const descriptor = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const before = fs.fstatSync(descriptor);
    if (!before.isFile()) throw new Error('not a regular file');
    if (before.size > EXCLUSION_SNAPSHOT_BUDGET.maxFileBytes) throw new Error(`file exceeds ${EXCLUSION_SNAPSHOT_BUDGET.maxFileBytes} byte evidence limit`);
    if (expectedSize !== null && before.size !== expectedSize) throw new Error('file changed during evidence capture');
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor);
    if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || bytes.length !== after.size) {
      throw new Error('file changed during evidence capture');
    }
    return { sha256: sha256(bytes), bytes: bytes.length };
  } finally {
    fs.closeSync(descriptor);
  }
}

function exclusionSnapshot(entry, remainingBytes = EXCLUSION_SNAPSHOT_BUDGET.maxTotalBytes) {
  try {
    if (entry.type === 'file') {
      const size = fs.lstatSync(entry.absolute).size;
      if (size > remainingBytes) throw new Error('aggregate exclusion evidence byte budget exceeded');
      const digest = boundedFileDigest(entry.absolute);
      return { evidenceStatus: 'complete', contentSha256: sha256(stableJson({ schemaVersion: 1, type: 'file', sha256: digest.sha256, bytes: digest.bytes })), evidenceBytes: digest.bytes };
    }
    if (entry.type === 'link') {
      const target = fs.readlinkSync(entry.absolute);
      return { evidenceStatus: 'complete', contentSha256: sha256(stableJson({ schemaVersion: 1, type: 'link', target })), evidenceBytes: 0 };
    }
    if (entry.type !== 'directory') return { evidenceStatus: 'incomplete', contentSha256: null, evidenceReason: `unsupported excluded path type: ${entry.type}` };
    const walked = walkFilesDetailed(entry.absolute, {
      ...EXCLUSION_SNAPSHOT_BUDGET,
      ignored: [],
      ignoredAtAnyDepth: [],
      ignoredAtRoot: [],
      includeDirectories: true,
    });
    if (!walked.budget.complete) return { evidenceStatus: 'incomplete', contentSha256: null, evidenceReason: 'excluded directory exceeds the bounded evidence snapshot' };
    let totalBytes = 0;
    const inventory = [];
    for (const directory of walked.directories) inventory.push({ path: directory.relative, type: 'directory' });
    for (const file of walked.files) {
      if (file.type === 'link') {
        inventory.push({ path: file.relative, type: 'link', target: fs.readlinkSync(file.absolute) });
        continue;
      }
      if (file.type !== 'file') throw new Error(`unsupported excluded directory entry type: ${file.type}`);
      const directoryLimit = Math.min(EXCLUSION_SNAPSHOT_BUDGET.maxTotalBytes, remainingBytes);
      if (totalBytes + (file.size ?? 0) > directoryLimit) throw new Error(`excluded directory exceeds ${directoryLimit} byte evidence limit`);
      const digest = boundedFileDigest(file.absolute, file.size);
      totalBytes += digest.bytes;
      inventory.push({ path: file.relative, type: 'file', bytes: digest.bytes, sha256: digest.sha256 });
    }
    inventory.sort((left, right) => left.path.localeCompare(right.path) || left.type.localeCompare(right.type));
    return { evidenceStatus: 'complete', contentSha256: sha256(stableJson({ schemaVersion: 1, type: 'directory', inventory })), evidenceBytes: totalBytes };
  } catch (error) {
    return { evidenceStatus: 'incomplete', contentSha256: null, evidenceReason: error.message };
  }
}

function governanceUnitSummary(member, memberScan, unitId) {
  const manifestNames = new Set(['package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts', 'pyproject.toml', 'go.mod', 'go.work', 'composer.json']);
  const evidenceFiles = memberScan.files
    .filter((file) => file.type === 'file' && file.contentScannable !== false && CODE_EXTENSIONS.has(path.extname(file.relative).toLowerCase()))
    .sort((left, right) => left.relative.localeCompare(right.relative))
    .map((file) => ({ path: file.relative, absolute: file.absolute, size: file.size }));
  const result = {
    id: member.id,
    unitId,
    path: member.path,
    status: memberScan.scanBudget.complete
      && (memberScan.repositoryFamily?.issues?.length ?? 0) === 0
      && (memberScan.governanceUnits ?? []).every((unit) => ['scanned', 'uninitialized'].includes(unit.status)) ? 'scanned' : 'incomplete',
    projectMode: memberScan.projectMode,
    repositoryFamily: memberScan.repositoryFamily,
    governanceUnits: (memberScan.governanceUnits ?? []).map(({ inventory, sourceFiles, ...unit }) => ({
      ...unit,
      sourceFiles: (sourceFiles ?? []).map(({ absolute, ...file }) => file),
    })),
    stacks: memberScan.stacks,
    commands: memberScan.commands,
    manifests: memberScan.files.filter((file) => file.type === 'file' && manifestNames.has(path.basename(file.relative))).map((file) => file.relative).slice(0, 32),
    sourceFileCount: evidenceFiles.length,
    sourceFiles: evidenceFiles.slice(0, 24),
    testFiles: evidenceFiles.filter((file) => /(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/.test(file.path)).map((file) => file.path).slice(0, 80),
    scanBudget: memberScan.scanBudget,
    scanIgnore: memberScan.scanIgnore,
    inventory: memberScan.files,
  };
  return result;
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
  const repositoryFamilyMaxDepth = Number.isInteger(options.repositoryFamilyMaxDepth) && options.repositoryFamilyMaxDepth >= 0
    ? options.repositoryFamilyMaxDepth : 8;
  const repositoryFamilyDepth = options._repositoryFamilyDepth ?? 0;
  const repositoryFamilyAncestry = new Set(options._repositoryFamilyAncestry ?? []);
  repositoryFamilyAncestry.add(fs.realpathSync(root));

  // Governance decisions and placement gates must see the complete product tree.
  // `walkFiles` records links but never follows them. Conventional compiler outputs,
  // runtime logs, and compiler caches are excluded at every depth because they cannot
  // provide application-source evidence and can otherwise exhaust scan budgets.
  const scanBudget = { ...DEFAULT_SCAN_BUDGET, ...(options.scanBudget ?? {}) };
  const aicgIgnore = loadAicgIgnore(root);
  let repositoryFamily = options.discoverRepositoryFamily === false ? null : discoverRepositoryFamily(root, { discoverNested: false });
  const nestedRepositoryMembers = [];
  const nestedRepositoryPaths = new Set();
  const ignoredByPolicy = [];
  let ignoredPolicyCount = 0;
  let unverifiedExclusionCount = 0;
  let exclusionEvidenceBytes = 0;
  const walked = walkFilesDetailed(root, {
    ...scanBudget,
    ignoredAtAnyDepth: ['.git', '.hg', '.svn', 'node_modules', '.worktrees', 'worktrees', '.venv', '__pycache__', '.gradle', '.mypy_cache', '.pytest_cache', '.swc', 'logs', 'target'],
    ignoredAtRoot: LOCAL_OUTPUT_PREFIXES.map((prefix) => prefix.replace(/\/$/, '')),
    caseInsensitiveIgnored: true,
    isOversizedFileRelevant: isOversizedFileRelevantToCodeScan,
    shouldIgnorePath: (entry) => {
      if (isRepositoryFamilyBoundary(entry.relative, repositoryFamily)) return true;
      if (options.discoverRepositoryFamily !== false && entry.type === 'directory') {
        const member = nestedGitRepositoryMember(entry.absolute, entry.relative);
        if (member) {
          nestedRepositoryMembers.push(member);
          nestedRepositoryPaths.add(member.path);
          return true;
        }
      }
      return aicgIgnore.shouldIgnore(entry);
    },
    onIgnoredPath: (entry) => {
      const rule = aicgIgnore.match(entry);
      if (!rule?.ignored) return;
      ignoredPolicyCount += 1;
      const category = isRepositoryFamilyBoundary(entry.relative, repositoryFamily) || nestedRepositoryPaths.has(entry.relative) ? 'repository-member' : exclusionCategory(entry);
      const reviewable = category !== 'generated-or-opaque' && category !== 'repository-member';
      if (reviewable) unverifiedExclusionCount += 1;
      if ((reviewable && unverifiedExclusionCount > 32) || (!reviewable && ignoredByPolicy.length >= 32)) return;
      const snapshot = exclusionSnapshot(entry, EXCLUSION_SNAPSHOT_BUDGET.maxTotalBytes - exclusionEvidenceBytes);
      exclusionEvidenceBytes += snapshot.evidenceBytes ?? 0;
      const { evidenceBytes: _evidenceBytes, ...evidence } = snapshot;
      ignoredByPolicy.push({
        path: entry.relative,
        type: entry.type,
        line: rule.line,
        pattern: rule.pattern,
        category,
        ...evidence,
      });
    },
  });
  if (options.discoverRepositoryFamily !== false && nestedRepositoryMembers.length > 0) {
    repositoryFamily = mergeDiscoveredRepositoryMembers(repositoryFamily, nestedRepositoryMembers);
  }
  const files = walked.files;
  for (const exclusion of ignoredByPolicy) exclusion.evidenceHash = scanExclusionEvidenceHash(aicgIgnore.sha256, exclusion);
  const unverifiedExclusions = ignoredByPolicy.filter((entry) => entry.category !== 'generated-or-opaque' && entry.category !== 'repository-member');
  const factFiles = files.filter((file) => !LOCAL_OUTPUT_PREFIXES.some((prefix) => file.relative.startsWith(prefix)));
  const capabilityRegistry = loadCapabilityRegistry();
  const dependencies = dependencyFacts(root, factFiles, scanBudget.maxFileBytes);
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

  const existingGovernance = governanceRoots().filter((relative) => exists(path.join(root, relative)));
  const links = files.filter((file) => file.type === 'link').map((file) => file.relative);
  const externalWorkflows = [];
  if (['openspec/config.yaml', 'openspec/specs', 'openspec/changes'].some((relative) => exists(path.join(root, relative)))) {
    externalWorkflows.push('openspec-change-governance');
  }

  const result = {
    root,
    gitRoot: detectedGitRoot,
    git: {
      availability: probeEnvironment ? (gitCommand ? 'detected' : 'not-found') : 'not-probed',
      version: gitCommand ? commandVersion('git') : null,
      root: detectedGitRoot,
    },
    environmentProbe: probeEnvironment ? 'executed' : 'not-probed',
    projectName: path.basename(root),
    projectMode: detectProjectMode(root, factFiles, repositoryFamily),
    repositoryFamily,
    currentOs: platformId(),
    architecture: os.arch(),
    files,
    scanBudget: walked.budget,
    scanIgnore: {
      path: aicgIgnore.path,
      sha256: aicgIgnore.sha256,
      ruleCount: aicgIgnore.rules.length,
      policy: aicgIgnore.policy,
      matchedCount: ignoredPolicyCount,
      samples: ignoredByPolicy.slice(0, 32),
      evidenceBytes: exclusionEvidenceBytes,
      unverifiedExclusionCount,
      unverifiedExclusionsTruncated: unverifiedExclusionCount > 32,
      unverifiedExclusions: unverifiedExclusions.slice(0, 32),
    },
    stacks: detectStacks(factFiles, capabilityRegistry, dependencies),
    dependencyFacts: dependencies,
    packageDependencies: detectPackageDependencies(factFiles),
    commands: detectCommands(root, options.unitId ?? 'root', options.commandCwd ?? '.'),
    agents,
    existingGovernance,
    links,
    externalWorkflows,
  };

  if (repositoryFamily?.members.length) {
    result.governanceUnits = repositoryFamily.members.map((member) => {
      const familyPath = options.commandCwd && options.commandCwd !== '.'
        ? path.posix.join(options.commandCwd, member.path)
        : member.path;
      const unitId = `member-${sha256(familyPath).slice(0, 16)}`;
      if (!member.initialized) return { id: member.id, unitId, path: member.path, status: 'uninitialized' };
      try {
        const memberRoot = path.join(root, member.path);
        const memberRealRoot = fs.realpathSync(memberRoot);
        if (repositoryFamilyAncestry.has(memberRealRoot)) {
          return { id: member.id, unitId, path: member.path, status: 'cycle' };
        }
        if (repositoryFamilyDepth >= repositoryFamilyMaxDepth) {
          return { id: member.id, unitId, path: member.path, status: 'depth-limit' };
        }
        const memberScan = scanProject(memberRoot, {
          ...options,
          probeEnvironment: false,
          // Each first-level member is governed as its own single repository: we do not
          // recurse into its nested family members, grandchild submodules or nested git
          // directories. Treating the member as a single repo keeps plan output, manifest
          // size and approval scope predictable for the operator and matches the
          // repository-family contract (root owns the boundary, members are autonomous).
          discoverRepositoryFamily: false,
          repositoryFamilyMaxDepth,
          _repositoryFamilyDepth: repositoryFamilyDepth + 1,
          _repositoryFamilyAncestry: repositoryFamilyAncestry,
          unitId,
          commandCwd: familyPath,
        });
        return governanceUnitSummary(member, memberScan, unitId);
      } catch (error) {
        return { id: member.id, unitId, path: member.path, status: 'unreadable', reason: error.message };
      }
    });
  } else result.governanceUnits = [];
  return result;
}
export function scanSummary(scan) {
  return {
    target: scan.root,
    git_root: scan.gitRoot,
    git: scan.git,
    project_mode: scan.projectMode,
    repository_family: scan.repositoryFamily,
    governance_units: (scan.governanceUnits ?? []).map(({ inventory, sourceFiles, ...unit }) => ({
      ...unit,
      sourceFiles: (sourceFiles ?? []).map(({ absolute, ...file }) => file),
    })),
    current_os: scan.currentOs,
    detected_stacks: scan.stacks,
    detected_packages: scan.packageDependencies,
    dependency_facts: scan.dependencyFacts,
    detected_commands: scan.commands,
    agents: scan.agents,
    existing_governance: scan.existingGovernance,
    links: scan.links,
    scan_budget: scan.scanBudget,
    scan_ignore: scan.scanIgnore,
    external_workflows: scan.externalWorkflows,
  };
}

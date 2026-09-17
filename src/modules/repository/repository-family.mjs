import fs from 'node:fs';
import path from 'node:path';
import { isSafeRelative, normalizeRelative, stableJson } from '../../shared/index.mjs';

const GITMODULES_PATH = '.gitmodules';
const MAX_GITMODULES_BYTES = 256 * 1024;
const MAX_MEMBERS = 256;
const MAX_BOUNDARY_DIRECTORIES = 20000;
const MAX_BOUNDARY_DEPTH = 32;
const IGNORED_DIRECTORY_NAMES = new Set([
  '.git', '.hg', '.svn', 'node_modules', '.worktrees', 'worktrees', '.venv', '__pycache__',
  '.gradle', '.mypy_cache', '.pytest_cache', '.swc', 'logs', 'target',
]);

function platformKey(value) {
  return process.platform === 'win32' ? value.toLowerCase() : value;
}

function portablePathKey(value) {
  return normalizeRelative(value).toLowerCase();
}

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1).replace(/\\([\\"])/g, '$1');
  }
  return trimmed;
}

function validMemberId(value) {
  return typeof value === 'string' && value.length > 0 && !/[\x00-\x1f\x7f]/.test(value);
}

function initializedSubmodule(root, relative) {
  try {
    const marker = fs.lstatSync(path.join(root, relative, '.git'));
    return fs.statSync(path.join(root, relative)).isDirectory()
      && (marker.isFile() || marker.isDirectory());
  } catch {
    return false;
  }
}

function isGitMarker(directory) {
  try {
    const marker = fs.lstatSync(path.join(directory, '.git'));
    return !marker.isSymbolicLink() && (marker.isFile() || marker.isDirectory());
  } catch {
    return false;
  }
}

export function nestedGitRepositoryMember(absolute, relative) {
  const normalized = normalizeRelative(relative);
  if (!isSafeRelative(normalized) || normalized === '.' || !isGitMarker(absolute)) return null;
  return { id: normalized, path: normalized, repositoryKind: 'nested-git', initialized: true };
}

function nestedGitMembers(root, declaredPaths, issues) {
  const members = [];
  const visited = new Set();
  const stack = [{ absolute: root, relative: '', depth: 0 }];
  let observedDirectories = 0;
  try { visited.add(fs.realpathSync(root)); } catch (error) { issues.push(`repository boundary discovery: ${error.message}`); }

  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = fs.readdirSync(current.absolute, { withFileTypes: true })
        .sort((left, right) => left.name.localeCompare(right.name));
    } catch (error) {
      issues.push(`repository boundary discovery: cannot read ${current.relative || '.'} (${error.code ?? error.message})`);
      continue;
    }
    for (const entry of entries) {
      const ignoredName = process.platform === 'win32' ? entry.name.toLowerCase() : entry.name;
      if (!entry.isDirectory() || entry.isSymbolicLink() || IGNORED_DIRECTORY_NAMES.has(ignoredName)) continue;
      const relative = normalizeRelative(current.relative ? `${current.relative}/${entry.name}` : entry.name);
      if (declaredPaths.has(relative)) continue;
      observedDirectories += 1;
      if (observedDirectories > MAX_BOUNDARY_DIRECTORIES) {
        issues.push(`repository boundary discovery: exceeds ${MAX_BOUNDARY_DIRECTORIES} directory limit`);
        return members;
      }
      const absolute = path.join(current.absolute, entry.name);
      let real;
      try { real = fs.realpathSync(absolute); } catch (error) {
        issues.push(`repository boundary discovery: cannot resolve ${relative} (${error.code ?? error.message})`);
        continue;
      }
      if (visited.has(real)) {
        issues.push(`repository boundary discovery: cycle or aliased directory at ${relative}`);
        continue;
      }
      visited.add(real);
      const member = nestedGitRepositoryMember(absolute, relative);
      if (member) {
        members.push(member);
        if (members.length >= MAX_MEMBERS) {
          issues.push(`repository boundary discovery: exceeds ${MAX_MEMBERS} member discovery limit`);
          return members;
        }
        continue;
      }
      if (current.depth + 1 >= MAX_BOUNDARY_DEPTH) {
        issues.push(`repository boundary discovery: depth limit ${MAX_BOUNDARY_DEPTH} reached at ${relative}`);
        continue;
      }
      stack.push({ absolute, relative, depth: current.depth + 1 });
    }
  }
  return members;
}

/**
 * Discover repository-family boundaries without executing Git or following links.
 * Child contents remain owned and scanned by their own repository invocation.
 */
function familyResult(hasGitmodules, members, issues) {
  if (!hasGitmodules && members.length === 0 && issues.length === 0) return null;
  const hasNestedMembers = members.some((member) => member.repositoryKind === 'nested-git');
  const kind = hasGitmodules && hasNestedMembers ? 'mixed-git-boundaries'
    : hasGitmodules ? 'git-submodules'
      : 'nested-git';
  const source = hasGitmodules && hasNestedMembers ? '.gitmodules-and-nested-git'
    : hasGitmodules ? GITMODULES_PATH
      : 'nested-.git';
  return { kind, source, members, issues };
}

export function mergeDiscoveredRepositoryMembers(family, discoveredMembers) {
  const hasGitmodules = family?.kind === 'git-submodules'
    || family?.kind === 'mixed-git-boundaries'
    || family?.source === GITMODULES_PATH
    || family?.source === '.gitmodules-and-nested-git';
  const members = [...(family?.members ?? [])];
  const issues = [...(family?.issues ?? [])];
  const ids = new Set(members.map((member) => platformKey(member.id)));
  const paths = new Set(members.map((member) => portablePathKey(member.path)));
  for (const member of discoveredMembers) {
    if (members.length >= MAX_MEMBERS) {
      issues.push(`repository boundary discovery: exceeds ${MAX_MEMBERS} combined member discovery limit`);
      break;
    }
    if (ids.has(platformKey(member.id)) || paths.has(portablePathKey(member.path))) {
      issues.push(`repository boundary discovery: duplicate repository identity or path for ${member.id}`);
      continue;
    }
    ids.add(platformKey(member.id));
    paths.add(portablePathKey(member.path));
    members.push(member);
  }
  members.sort((left, right) => left.path.localeCompare(right.path));
  return familyResult(hasGitmodules, members, issues);
}

export function discoverRepositoryFamily(root, { discoverNested = true } = {}) {
  const gitmodules = path.join(root, GITMODULES_PATH);
  let content;
  try {
    const metadata = fs.lstatSync(gitmodules);
    if (!metadata.isFile() || metadata.isSymbolicLink()) {
      return { kind: 'git-submodules', source: GITMODULES_PATH, members: [], issues: [`${GITMODULES_PATH}: must be a regular repository-local file`] };
    }
    if (metadata.size > MAX_GITMODULES_BYTES) {
      return { kind: 'git-submodules', source: GITMODULES_PATH, members: [], issues: [`${GITMODULES_PATH}: exceeds ${MAX_GITMODULES_BYTES} byte discovery limit`] };
    }
    content = fs.readFileSync(gitmodules, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') content = null;
    else return { kind: 'repository-boundary-scan', source: 'filesystem', members: [], issues: [`${GITMODULES_PATH}: ${error.message}`] };
  }

  const candidates = [];
  const issues = [];
  let current = null;
  const finish = () => {
    if (!current) return;
    if (!current.path) issues.push(`${GITMODULES_PATH}: submodule ${current.id || '<unnamed>'} is missing path`);
    else candidates.push(current);
  };

  for (const [index, line] of (content ?? '').split(/\r?\n/).entries()) {
    const section = line.match(/^\s*\[\s*submodule\s+"((?:[^"\\]|\\.)*)"\s*\]\s*(?:[#;].*)?$/i);
    if (section) {
      finish();
      current = { id: section[1].replace(/\\([\\"])/g, '$1'), path: null };
      continue;
    }
    if (!current || /^\s*(?:[#;]|$)/.test(line)) continue;
    const property = line.match(/^\s*([A-Za-z][A-Za-z0-9.-]*)\s*=\s*(.*?)\s*$/);
    if (!property || property[1].toLowerCase() !== 'path') continue;
    if (current.path !== null) {
      issues.push(`${GITMODULES_PATH}:${index + 1}: duplicate path for submodule ${current.id || '<unnamed>'}`);
      continue;
    }
    current.path = normalizeRelative(unquote(property[2]));
  }
  finish();

  const members = [];
  const ids = new Set();
  const paths = new Set();
  for (const candidate of candidates) {
    if (members.length >= MAX_MEMBERS) {
      issues.push(`${GITMODULES_PATH}: exceeds ${MAX_MEMBERS} member discovery limit`);
      break;
    }
    if (!validMemberId(candidate.id)) {
      issues.push(`${GITMODULES_PATH}: submodule has an invalid name`);
      continue;
    }
    if (!isSafeRelative(candidate.path) || candidate.path === '.' || candidate.path === GITMODULES_PATH || candidate.path.startsWith('.git/')) {
      issues.push(`${GITMODULES_PATH}: submodule ${candidate.id} has unsafe path ${candidate.path}`);
      continue;
    }
    if (ids.has(platformKey(candidate.id)) || paths.has(portablePathKey(candidate.path))) {
      issues.push(`${GITMODULES_PATH}: duplicate submodule identity or path for ${candidate.id}`);
      continue;
    }
    ids.add(platformKey(candidate.id));
    paths.add(portablePathKey(candidate.path));
    members.push({
      id: candidate.id,
      path: candidate.path,
      repositoryKind: 'git-submodule',
      initialized: initializedSubmodule(root, candidate.path),
    });
  }
  members.sort((left, right) => left.path.localeCompare(right.path));
  const declaredFamily = familyResult(content !== null, members, issues);
  if (!discoverNested) return declaredFamily;
  const declaredPaths = new Set(members.map((member) => member.path));
  const nested = nestedGitMembers(root, declaredPaths, issues);
  return mergeDiscoveredRepositoryMembers(declaredFamily ?? familyResult(content !== null, members, issues), nested);
}

export function isRepositoryFamilyBoundary(relative, family) {
  const key = portablePathKey(relative);
  return (family?.members ?? []).some((member) => {
    const memberPath = portablePathKey(member.path);
    return key === memberPath || key.startsWith(`${memberPath}/`);
  });
}

export function repositoryFamilyMembersSnapshot(family, governanceUnits = []) {
  return (family?.members ?? []).map((member) => {
    const unit = governanceUnits.find((candidate) => candidate.path === member.path);
    const nested = repositoryFamilyMembersSnapshot(unit?.repositoryFamily, unit?.governanceUnits);
    return {
      id: member.id,
      path: member.path,
      repositoryKind: member.repositoryKind,
      ...(nested.length > 0 ? { members: nested } : {}),
    };
  }).sort((left, right) => left.path.localeCompare(right.path));
}

function normalizedStoredMembers(members) {
  return (Array.isArray(members) ? members : []).map((member) => {
    const nested = normalizedStoredMembers(member?.members);
    return {
      id: member?.id,
      path: member?.path,
      repositoryKind: member?.repositoryKind,
      ...(nested.length > 0 ? { members: nested } : {}),
    };
  }).sort((left, right) => String(left.path).localeCompare(String(right.path)));
}

export function repositoryTopologyMigrationRequired(scan, config) {
  const currentFamily = scan?.projectMode === 'repository-family';
  const storedFamily = config?.projectMode === 'repository-family';
  if (currentFamily !== storedFamily) return true;
  if (!currentFamily) return false;
  return stableJson(repositoryFamilyMembersSnapshot(scan.repositoryFamily, scan.governanceUnits))
    !== stableJson(normalizedStoredMembers(config?.initialClassification?.codebase?.evidence?.repositoryMembers));
}

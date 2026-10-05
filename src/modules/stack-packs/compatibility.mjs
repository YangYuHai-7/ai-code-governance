import { canonicalValueDigest } from '../../shared/index.mjs';
import { packContractDigest, validateGoldenPathPack } from './contracts.mjs';

const EXACT_VERSION = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/;

function frozen(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) frozen(entry);
  return value;
}

function gap(code, path, message, status) {
  return { code, path, message, status };
}

function exactVersion(value) {
  if (typeof value !== 'string') return null;
  const match = EXACT_VERSION.exec(value);
  if (!match) return null;
  return { raw: value, major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null };
}

function exactDatabaseVersion(value) {
  if (typeof value !== 'string') return null;
  const match = /^(\d+)\.(\d+)(?:\.(\d+))?(?:-([0-9A-Za-z.-]+))?$/.exec(value);
  if (!match) return null;
  return { raw: value, major: Number(match[1]), minor: Number(match[2]), patch: match[3] === undefined ? 0 : Number(match[3]), prerelease: match[4] ?? null };
}

function rangeMatches(version, range) {
  if (!version || version.prerelease) return false;
  if (range === 'stable') return true;
  const match = /^(\d+)\.(\d+|x)$/.exec(range);
  if (!match) return false;
  return version.major === Number(match[1]) && (match[2] === 'x' || version.minor === Number(match[2]));
}

function sameStrings(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  return [...left].sort().every((value, index) => value === [...right].sort()[index]);
}

function normalizedFacts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const runtime = value.runtime;
  const packageManager = value.packageManager;
  const packages = value.packages;
  const database = value.database;
  if (!runtime || !packageManager || !packages || !database || typeof runtime !== 'object' || typeof packageManager !== 'object' || typeof packages !== 'object' || Array.isArray(packages) || typeof database !== 'object') return null;
  return {
    runtime: { node: runtime.node ?? null },
    packageManager: { name: packageManager.name ?? null, version: packageManager.version ?? null, lockfile: packageManager.lockfile ?? null },
    packages: Object.fromEntries(Object.entries(packages).sort(([left], [right]) => left.localeCompare(right))),
    database: { engine: database.engine ?? null, version: database.version ?? null, extensions: Array.isArray(database.extensions) ? [...database.extensions].sort() : null },
  };
}

function matchingReference(pack, facts) {
  return pack.compatibility.referenceCombinations.find((entry) => (
    entry.runtime.node === facts.runtime.node
    && entry.packageManager.version === facts.packageManager.version
    && entry.database.version === facts.database.version
    && sameStrings(entry.database.extensions, facts.database.extensions)
    && entry.packages.every((item) => facts.packages[item.name] === item.version)
    && Object.keys(facts.packages).length === entry.packages.length
  )) ?? null;
}

export function resolvePackCompatibility({ pack, repositoryFacts }) {
  const current = validateGoldenPathPack(pack);
  const facts = normalizedFacts(repositoryFacts);
  const packDigest = packContractDigest(current);
  const factsDigest = canonicalValueDigest(facts ?? { invalid: true, repositoryFacts: repositoryFacts ?? null });
  const gaps = [];
  if (!facts) {
    gaps.push(gap('invalid-facts', 'repositoryFacts', 'Repository facts must declare runtime, package manager, packages, and database.', 'unresolved'));
    return frozen({ status: 'unresolved', exactVersions: null, gaps, packDigest, factsDigest });
  }
  if (facts.packageManager.name === null || facts.packageManager.version === null || facts.packageManager.lockfile === null) {
    gaps.push(gap('missing-package-manager-fact', 'repositoryFacts.packageManager', 'Package-manager name, version, and lockfile are required.', 'unresolved'));
  }
  if (facts.packageManager.lockfile !== current.compatibility.packageManager.lockfile) {
    gaps.push(gap('lockfile-mismatch', 'repositoryFacts.packageManager.lockfile', `Expected ${current.compatibility.packageManager.lockfile}.`, facts.packageManager.lockfile === null ? 'unresolved' : 'incompatible'));
  }
  if (facts.packageManager.name !== current.compatibility.packageManager.name) {
    gaps.push(gap('package-manager-mismatch', 'repositoryFacts.packageManager.name', `Expected ${current.compatibility.packageManager.name}.`, facts.packageManager.name === null ? 'unresolved' : 'incompatible'));
  }

  const node = exactVersion(facts.runtime.node);
  if (!node) gaps.push(gap('node-version-unresolved', 'repositoryFacts.runtime.node', 'Node version must be an exact stable version.', 'unresolved'));
  else if (node.major !== current.compatibility.runtime.node.major || node.minor < current.compatibility.runtime.node.minMinor || node.prerelease) {
    gaps.push(gap('node-version-incompatible', 'repositoryFacts.runtime.node', `Expected Node ${current.compatibility.runtime.node.major}.${current.compatibility.runtime.node.minMinor}.0 or a later stable minor in that major.`, 'incompatible'));
  }

  for (const requirement of current.compatibility.packages) {
    const raw = facts.packages[requirement.name];
    const version = exactVersion(raw);
    if (!version) {
      gaps.push(gap('package-version-unresolved', `repositoryFacts.packages.${requirement.name}`, 'Package version must be an exact stable version.', 'unresolved'));
      continue;
    }
    if (!rangeMatches(version, requirement.range)) {
      gaps.push(gap('package-version-incompatible', `repositoryFacts.packages.${requirement.name}`, `Expected ${requirement.range}.`, 'incompatible'));
    }
  }

  const database = exactDatabaseVersion(facts.database.version);
  if (facts.database.engine !== current.compatibility.database.engine) {
    gaps.push(gap('database-engine-incompatible', 'repositoryFacts.database.engine', `Expected ${current.compatibility.database.engine}.`, facts.database.engine === null ? 'unresolved' : 'incompatible'));
  }
  if (!database) gaps.push(gap('database-version-unresolved', 'repositoryFacts.database.version', 'Database version must be exact.', 'unresolved'));
  else if (database.major !== current.compatibility.database.major || database.prerelease) {
    gaps.push(gap('database-version-incompatible', 'repositoryFacts.database.version', `Expected PostgreSQL ${current.compatibility.database.major}.x.`, 'incompatible'));
  }
  if (!facts.database.extensions) gaps.push(gap('database-extensions-unresolved', 'repositoryFacts.database.extensions', 'Database extension facts are required.', 'unresolved'));

  if (!gaps.some((entry) => entry.status === 'unresolved') && !gaps.some((entry) => entry.status === 'incompatible') && !matchingReference(current, facts)) {
    gaps.push(gap('un-evaluated-combination', 'repositoryFacts', 'Exact versions satisfy ranges but do not match an evaluated reference combination.', 'incompatible'));
  }
  const status = gaps.some((entry) => entry.status === 'unresolved') ? 'unresolved' : gaps.some((entry) => entry.status === 'incompatible') ? 'incompatible' : 'compatible';
  return frozen({
    status,
    exactVersions: facts,
    gaps: gaps.sort((left, right) => left.path.localeCompare(right.path) || left.code.localeCompare(right.code)),
    packDigest,
    factsDigest,
  });
}

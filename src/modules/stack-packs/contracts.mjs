import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest, isSafeRelative } from '../../shared/index.mjs';

export const GOLDEN_PATH_PACK_VERSION = 1;
export const QUALITY_MATRIX_VERSION = 1;

const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const PACKAGE = /^(?:@[-a-z0-9]+\/)?[-a-z0-9.]+$/;
const VERSION_RANGE = /^(?:\d+\.(?:\d+|x)|stable)$/;
const PURPOSES = new Set([
  'format', 'lint', 'typecheck', 'architecture', 'unit', 'integration', 'contract',
  'e2e', 'security', 'migration', 'observability', 'performance', 'build', 'start', 'traceability',
]);

function fail(path, message) {
  throw usageError(`${path}: ${message}`);
}

function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
  return value;
}

function fields(value, allowed, required, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'required field is missing');
}

function string(value, path, { max = 8192, pattern = null } = {}) {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || (pattern && !pattern.test(value))) fail(path, 'invalid string');
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `expected an integer from ${min} to ${max}`);
}

function enumeration(value, values, path) {
  if (!values.includes(value)) fail(path, `expected one of ${values.join(', ')}`);
}

function list(value, path, { min = 0, max = 256 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected an array with ${min} to ${max} items`);
  return value;
}

function uniqueStrings(value, path, options = {}) {
  const entries = list(value, path, options);
  const seen = new Set();
  entries.forEach((entry, index) => {
    string(entry, `${path}[${index}]`);
    if (seen.has(entry)) fail(`${path}[${index}]`, `duplicate value ${entry}`);
    seen.add(entry);
  });
  return entries;
}

function id(value, path) { string(value, path, { max: 128, pattern: ID }); }

function digest(value, path) { string(value, path, { max: 64, pattern: DIGEST }); }

function safePath(value, path) {
  string(value, path, { max: 1024 });
  if (!isSafeRelative(value)) fail(path, 'expected a safe repository-relative path');
}

function safeGlob(value, path) {
  string(value, path, { max: 1024 });
  const normalized = value.replaceAll('**', 'wildcard').replaceAll('*', 'wildcard').replaceAll('?', 'wildcard');
  if (!isSafeRelative(normalized)) fail(path, 'expected a safe repository-relative glob');
}

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function normalized(value) { return deepFreeze(deepClone(value)); }

function validateGate(value, path) {
  fields(value, ['id', 'owner', 'applicability', 'required', 'purpose', 'timeoutMs', 'maxOutputBytes', 'artifactBudgetBytes', 'evidence'], ['id', 'owner', 'applicability', 'required', 'purpose', 'timeoutMs', 'maxOutputBytes', 'artifactBudgetBytes', 'evidence'], path);
  id(value.id, `${path}.id`);
  id(value.owner, `${path}.owner`);
  enumeration(value.applicability, ['always', 'risk-activated', 'path-activated'], `${path}.applicability`);
  if (typeof value.required !== 'boolean') fail(`${path}.required`, 'expected a boolean');
  string(value.purpose, `${path}.purpose`);
  if (!PURPOSES.has(value.purpose)) fail(`${path}.purpose`, 'unsupported purpose');
  integer(value.timeoutMs, `${path}.timeoutMs`, { min: 1, max: 3_600_000 });
  integer(value.maxOutputBytes, `${path}.maxOutputBytes`, { min: 1, max: 64 * 1024 * 1024 });
  integer(value.artifactBudgetBytes, `${path}.artifactBudgetBytes`, { min: 0, max: 512 * 1024 * 1024 });
  string(value.evidence, `${path}.evidence`, { max: 4096 });
}

export function validateQualityMatrix(value) {
  fields(value, ['schemaVersion', 'id', 'gates'], ['schemaVersion', 'id', 'gates'], 'qualityMatrix');
  if (value.schemaVersion !== QUALITY_MATRIX_VERSION) fail('qualityMatrix.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'qualityMatrix.id');
  const ids = new Set();
  list(value.gates, 'qualityMatrix.gates', { min: 1, max: 128 }).forEach((gate, index) => {
    validateGate(gate, `qualityMatrix.gates[${index}]`);
    if (ids.has(gate.id)) fail(`qualityMatrix.gates[${index}].id`, `duplicate gate ${gate.id}`);
    ids.add(gate.id);
  });
  return normalized(value);
}

function validatePackage(entry, path) {
  fields(entry, ['name', 'range'], ['name', 'range'], path);
  string(entry.name, `${path}.name`, { max: 214, pattern: PACKAGE });
  string(entry.range, `${path}.range`, { max: 32, pattern: VERSION_RANGE });
}

function validateArchitecture(value) {
  fields(value, ['modules', 'compositionRoots'], ['modules', 'compositionRoots'], 'pack.architecture');
  const ids = new Set();
  list(value.modules, 'pack.architecture.modules', { min: 1, max: 128 }).forEach((entry, index) => {
    const path = `pack.architecture.modules[${index}]`;
    fields(entry, ['id', 'roots', 'allowedDependencies', 'publicEntrypoints'], ['id', 'roots', 'allowedDependencies', 'publicEntrypoints'], path);
    id(entry.id, `${path}.id`);
    if (ids.has(entry.id)) fail(`${path}.id`, `duplicate module ${entry.id}`);
    ids.add(entry.id);
    uniqueStrings(entry.roots, `${path}.roots`, { min: 1 }).forEach((item, itemIndex) => safePath(item, `${path}.roots[${itemIndex}]`));
    uniqueStrings(entry.allowedDependencies, `${path}.allowedDependencies`);
    uniqueStrings(entry.publicEntrypoints, `${path}.publicEntrypoints`, { min: 1 }).forEach((item, itemIndex) => safePath(item, `${path}.publicEntrypoints[${itemIndex}]`));
  });
  uniqueStrings(value.compositionRoots, 'pack.architecture.compositionRoots', { min: 1 }).forEach((item, index) => safePath(item, `pack.architecture.compositionRoots[${index}]`));
}

function validateCatalog(entries, path, validator) {
  const ids = new Set();
  list(entries, path, { min: 1, max: 256 }).forEach((entry, index) => {
    validator(entry, `${path}[${index}]`);
    if (ids.has(entry.id)) fail(`${path}[${index}].id`, `duplicate ID ${entry.id}`);
    ids.add(entry.id);
  });
}

export function validateGoldenPathPack(value) {
  const allowed = ['schemaVersion', 'id', 'release', 'lifecycle', 'maturity', 'sourceDigest', 'compatibility', 'detection', 'architecture', 'generation', 'qualityMatrix', 'failureCatalog', 'repairCatalog', 'knownLimitations'];
  fields(value, allowed, allowed, 'pack');
  if (value.schemaVersion !== GOLDEN_PATH_PACK_VERSION) fail('pack.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'pack.id'); string(value.release, 'pack.release', { max: 64 });
  enumeration(value.lifecycle, ['active', 'planned', 'deprecated'], 'pack.lifecycle');
  enumeration(value.maturity, ['candidate', 'guided', 'executable', 'certified'], 'pack.maturity');
  digest(value.sourceDigest, 'pack.sourceDigest');

  fields(value.compatibility, ['runtime', 'packageManager', 'packages', 'database', 'referenceCombinations'], ['runtime', 'packageManager', 'packages', 'database', 'referenceCombinations'], 'pack.compatibility');
  fields(value.compatibility.runtime, ['node'], ['node'], 'pack.compatibility.runtime');
  fields(value.compatibility.runtime.node, ['major', 'minMinor'], ['major', 'minMinor'], 'pack.compatibility.runtime.node');
  integer(value.compatibility.runtime.node.major, 'pack.compatibility.runtime.node.major', { min: 1, max: 99 });
  integer(value.compatibility.runtime.node.minMinor, 'pack.compatibility.runtime.node.minMinor', { min: 0, max: 999 });
  fields(value.compatibility.packageManager, ['name', 'lockfile'], ['name', 'lockfile'], 'pack.compatibility.packageManager');
  enumeration(value.compatibility.packageManager.name, ['npm', 'pnpm', 'yarn'], 'pack.compatibility.packageManager.name');
  safePath(value.compatibility.packageManager.lockfile, 'pack.compatibility.packageManager.lockfile');
  const packageNames = new Set();
  list(value.compatibility.packages, 'pack.compatibility.packages', { min: 1, max: 128 }).forEach((entry, index) => {
    validatePackage(entry, `pack.compatibility.packages[${index}]`);
    if (packageNames.has(entry.name)) fail(`pack.compatibility.packages[${index}].name`, `duplicate package ${entry.name}`);
    packageNames.add(entry.name);
  });
  fields(value.compatibility.database, ['engine', 'major', 'extensions'], ['engine', 'major', 'extensions'], 'pack.compatibility.database');
  enumeration(value.compatibility.database.engine, ['postgresql'], 'pack.compatibility.database.engine');
  integer(value.compatibility.database.major, 'pack.compatibility.database.major', { min: 1, max: 99 });
  uniqueStrings(value.compatibility.database.extensions, 'pack.compatibility.database.extensions');
  validateCatalog(value.compatibility.referenceCombinations, 'pack.compatibility.referenceCombinations', (entry, path) => {
    fields(entry, ['id', 'runtime', 'packageManager', 'packages', 'database'], ['id', 'runtime', 'packageManager', 'packages', 'database'], path);
    id(entry.id, `${path}.id`);
    fields(entry.runtime, ['node'], ['node'], `${path}.runtime`);
    string(entry.runtime.node, `${path}.runtime.node`, { max: 64 });
    fields(entry.packageManager, ['version'], ['version'], `${path}.packageManager`);
    string(entry.packageManager.version, `${path}.packageManager.version`, { max: 64 });
    const referencePackages = new Set();
    list(entry.packages, `${path}.packages`, { min: 1, max: 128 }).forEach((item, itemIndex) => {
      const itemPath = `${path}.packages[${itemIndex}]`;
      fields(item, ['name', 'version'], ['name', 'version'], itemPath);
      string(item.name, `${itemPath}.name`, { max: 214, pattern: PACKAGE });
      string(item.version, `${itemPath}.version`, { max: 64 });
      if (referencePackages.has(item.name)) fail(`${itemPath}.name`, `duplicate package ${item.name}`);
      referencePackages.add(item.name);
    });
    if (referencePackages.size !== packageNames.size || [...packageNames].some((name) => !referencePackages.has(name))) fail(`${path}.packages`, 'must declare every compatible package exactly once');
    fields(entry.database, ['version', 'extensions'], ['version', 'extensions'], `${path}.database`);
    string(entry.database.version, `${path}.database.version`, { max: 64 });
    uniqueStrings(entry.database.extensions, `${path}.database.extensions`);
  });

  fields(value.detection, ['requiredPaths', 'requiredPackages', 'forbiddenPackages'], ['requiredPaths', 'requiredPackages', 'forbiddenPackages'], 'pack.detection');
  uniqueStrings(value.detection.requiredPaths, 'pack.detection.requiredPaths', { min: 1 }).forEach((entry, index) => safePath(entry, `pack.detection.requiredPaths[${index}]`));
  uniqueStrings(value.detection.requiredPackages, 'pack.detection.requiredPackages', { min: 1 }).forEach((entry, index) => string(entry, `pack.detection.requiredPackages[${index}]`, { pattern: PACKAGE }));
  uniqueStrings(value.detection.forbiddenPackages, 'pack.detection.forbiddenPackages').forEach((entry, index) => string(entry, `pack.detection.forbiddenPackages[${index}]`, { pattern: PACKAGE }));

  validateArchitecture(value.architecture);
  fields(value.generation, ['requiredPaths', 'forbiddenPaths'], ['requiredPaths', 'forbiddenPaths'], 'pack.generation');
  uniqueStrings(value.generation.requiredPaths, 'pack.generation.requiredPaths', { min: 1 }).forEach((entry, index) => safePath(entry, `pack.generation.requiredPaths[${index}]`));
  uniqueStrings(value.generation.forbiddenPaths, 'pack.generation.forbiddenPaths').forEach((entry, index) => safeGlob(entry, `pack.generation.forbiddenPaths[${index}]`));
  validateQualityMatrix(value.qualityMatrix);
  validateCatalog(value.failureCatalog, 'pack.failureCatalog', (entry, path) => {
    fields(entry, ['id', 'owner', 'severity', 'repair'], ['id', 'owner', 'severity', 'repair'], path);
    id(entry.id, `${path}.id`); id(entry.owner, `${path}.owner`);
    enumeration(entry.severity, ['error', 'warning'], `${path}.severity`); string(entry.repair, `${path}.repair`, { max: 4096 });
  });
  validateCatalog(value.repairCatalog, 'pack.repairCatalog', (entry, path) => {
    fields(entry, ['id', 'owns', 'maxAttempts'], ['id', 'owns', 'maxAttempts'], path);
    id(entry.id, `${path}.id`); uniqueStrings(entry.owns, `${path}.owns`, { min: 1 }).forEach((owner, index) => id(owner, `${path}.owns[${index}]`));
    integer(entry.maxAttempts, `${path}.maxAttempts`, { min: 1, max: 16 });
  });
  validateCatalog(value.knownLimitations, 'pack.knownLimitations', (entry, path) => {
    fields(entry, ['id', 'statement'], ['id', 'statement'], path);
    id(entry.id, `${path}.id`); string(entry.statement, `${path}.statement`, { max: 4096 });
  });
  return normalized(value);
}

export function packContractDigest(value) {
  return canonicalValueDigest(validateGoldenPathPack(value));
}

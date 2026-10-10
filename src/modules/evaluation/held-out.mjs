import fs from 'node:fs';
import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest, isSafeRelative, sha256 } from '../../shared/index.mjs';

export const HELD_OUT_SET_VERSION = 1;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const CASE_FIELDS = ['id', 'repository', 'requirement', 'repositoryDigest', 'requirementDigest', 'platforms', 'structurallyDistinct'];

function fail(path_, message) { throw usageError(`${path_}: ${message}`); }

function digestFile(file) { return sha256(fs.readFileSync(file, 'utf8')); }

function walk(directory, prefix = '') {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) entries.push(...walk(absolute, relative));
    else if (entry.isFile()) entries.push({ relative, absolute });
  }
  return entries;
}

export function digestHeldOutTree(root) {
  return sha256(walk(root).map((entry) => `${entry.relative}:${digestFile(entry.absolute)}`).join('\n'));
}

export function digestHeldOutFile(file) { return digestFile(file); }

function providerPath(root, relative, label) {
  if (typeof relative !== 'string' || relative.length === 0 || relative.length > 1024 || !isSafeRelative(relative)) fail(label, 'expected a safe provider-relative path');
  const absolute = path.resolve(root, relative);
  if (absolute !== root && !absolute.startsWith(`${root}${path.sep}`)) fail(label, 'provider path escapes the provider root');
  return absolute;
}

// The provider root is read-only input: the loader verifies but never writes inside it.
export function loadHeldOutEvaluationSet(root) {
  if (typeof root !== 'string' || root.length === 0) fail('heldOut.root', 'a provider root is required');
  const resolved = path.resolve(root);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) fail('heldOut.root', 'the provider root must be an existing directory');
  const manifestPath = path.join(resolved, 'manifest.json');
  if (!fs.existsSync(manifestPath)) fail('heldOut.manifest', 'manifest.json is required');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')); } catch { fail('heldOut.manifest', 'manifest.json is not valid JSON'); }
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) fail('heldOut.manifest', 'expected an object');
  for (const key of Object.keys(manifest)) if (!['schemaVersion', 'id', 'cases'].includes(key)) fail(`heldOut.${key}`, 'unknown field');
  if (manifest.schemaVersion !== HELD_OUT_SET_VERSION) fail('heldOut.schemaVersion', `unsupported version ${manifest.schemaVersion}`);
  if (!ID.test(manifest.id ?? '')) fail('heldOut.id', 'invalid provider id');
  if (!Array.isArray(manifest.cases) || manifest.cases.length === 0 || manifest.cases.length > 128) fail('heldOut.cases', 'expected 1 to 128 cases');
  const seen = new Set();
  const cases = manifest.cases.map((entry, index) => {
    const casePath = `heldOut.cases[${index}]`;
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) fail(casePath, 'expected an object');
    for (const key of Object.keys(entry)) if (!CASE_FIELDS.includes(key)) fail(`${casePath}.${key}`, 'unknown field');
    for (const key of CASE_FIELDS) if (!Object.hasOwn(entry, key)) fail(`${casePath}.${key}`, 'required field is missing');
    if (!ID.test(entry.id)) fail(`${casePath}.id`, 'invalid case id');
    if (seen.has(entry.id)) fail(`${casePath}.id`, `duplicate case ${entry.id}`);
    seen.add(entry.id);
    const repository = providerPath(resolved, entry.repository, `${casePath}.repository`);
    const requirement = providerPath(resolved, entry.requirement, `${casePath}.requirement`);
    if (!fs.existsSync(repository) || !fs.statSync(repository).isDirectory()) fail(`${casePath}.repository`, 'the case repository must exist');
    if (!fs.existsSync(requirement) || !fs.statSync(requirement).isFile()) fail(`${casePath}.requirement`, 'the case requirement must exist');
    if (!DIGEST.test(entry.repositoryDigest ?? '') || digestHeldOutTree(repository) !== entry.repositoryDigest) fail(`${casePath}.repositoryDigest`, 'declared repository digest does not match the provider files');
    if (!DIGEST.test(entry.requirementDigest ?? '') || digestFile(requirement) !== entry.requirementDigest) fail(`${casePath}.requirementDigest`, 'declared requirement digest does not match the provider file');
    if (!Array.isArray(entry.platforms) || entry.platforms.length === 0 || entry.platforms.some((platform) => typeof platform !== 'string' || platform.length === 0)) fail(`${casePath}.platforms`, 'expected at least one platform');
    if (typeof entry.structurallyDistinct !== 'boolean') fail(`${casePath}.structurallyDistinct`, 'expected a boolean');
    return Object.freeze({
      id: entry.id, repository: entry.repository, requirement: entry.requirement,
      repositoryDigest: entry.repositoryDigest, requirementDigest: entry.requirementDigest,
      platforms: Object.freeze([...entry.platforms]), structurallyDistinct: entry.structurallyDistinct,
      inputDigest: canonicalValueDigest({ repositoryDigest: entry.repositoryDigest, requirementDigest: entry.requirementDigest }),
      absolute: Object.freeze({ repository, requirement }),
    });
  });
  return Object.freeze({
    schemaVersion: HELD_OUT_SET_VERSION,
    id: manifest.id,
    root: resolved,
    sourceDigest: canonicalValueDigest({ id: manifest.id, cases: cases.map((entry) => ({ id: entry.id, inputDigest: entry.inputDigest })) }),
    cases: Object.freeze(cases),
  });
}

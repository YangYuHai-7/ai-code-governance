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

export const HELD_OUT_RUN_VERSION = 1;
const RUN_STATUSES = Object.freeze(['passed', 'incomplete', 'blocked']);
const RUN_BLOCKING = Object.freeze(['provider-authority', 'held-out-overlap', 'provider-mutated']);

function digestCaseRepository(entry) { return digestHeldOutTree(entry.absolute.repository); }
function digestCaseRequirement(entry) { return digestFile(entry.absolute.requirement); }

export function validateHeldOutEvaluationRun(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('heldOutRun', 'expected an object');
  const allowed = ['schemaVersion', 'id', 'status', 'cases', 'gaps', 'sourceDigest', 'evaluatedAt'];
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`heldOutRun.${key}`, 'unknown field');
  for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`heldOutRun.${key}`, 'required field is missing');
  if (value.schemaVersion !== HELD_OUT_RUN_VERSION) fail('heldOutRun.schemaVersion', `unsupported version ${value.schemaVersion}`);
  if (!ID.test(value.id)) fail('heldOutRun.id', 'invalid run id');
  if (!RUN_STATUSES.includes(value.status)) fail('heldOutRun.status', 'unsupported status');
  if (!Array.isArray(value.cases)) fail('heldOutRun.cases', 'expected an array');
  value.cases.forEach((entry, index) => {
    const casePath = `heldOutRun.cases[${index}]`;
    for (const key of ['caseId', 'runId', 'verdict', 'level', 'inputDigest', 'outputDigest']) if (typeof entry?.[key] !== 'string' || entry[key].length === 0) fail(`${casePath}.${key}`, 'expected a string');
    if (!DIGEST.test(entry.inputDigest) || !DIGEST.test(entry.outputDigest)) fail(casePath, 'expected canonical digests');
  });
  if (!Array.isArray(value.gaps)) fail('heldOutRun.gaps', 'expected an array');
  value.gaps.forEach((gap, index) => {
    if (typeof gap?.code !== 'string' || gap.code.length === 0) fail(`heldOutRun.gaps[${index}].code`, 'expected a code');
    if (typeof gap?.detail !== 'string' || gap.detail.length === 0) fail(`heldOutRun.gaps[${index}].detail`, 'expected a detail');
  });
  if (!DIGEST.test(value.sourceDigest ?? '')) fail('heldOutRun.sourceDigest', 'expected a canonical digest');
  if (typeof value.evaluatedAt !== 'string' || Number.isNaN(Date.parse(value.evaluatedAt))) fail('heldOutRun.evaluatedAt', 'expected an ISO date-time');
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

// Evaluator-owned inputs are read-only: every case runs in an isolated copy and the provider
// digests are re-verified afterwards, so a mutated provider can never pass silently.
export async function runHeldOutEvaluationSet(set, dependencies = {}) {
  if (!set || typeof set !== 'object' || !Array.isArray(set.cases) || set.schemaVersion !== HELD_OUT_SET_VERSION || !DIGEST.test(set.sourceDigest ?? '')) fail('heldOutRun.set', 'a loaded held-out evaluation set is required');
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const gaps = [];
  const add = (code, detail) => gaps.push({ code, detail });
  const reference = dependencies.referenceDigests ?? {};
  const threshold = dependencies.thresholdPolicy?.minimumStructurallyDistinctCases ?? 0;
  const cases = [];

  if (dependencies.authorized !== true) {
    add('provider-authority', 'held-out evaluation requires explicit provider authority; no case was copied or executed');
    return validateHeldOutEvaluationRun({ schemaVersion: HELD_OUT_RUN_VERSION, id: `held-out-run.${set.sourceDigest.slice(0, 24)}`, status: 'blocked', cases, gaps, sourceDigest: set.sourceDigest, evaluatedAt: clock() });
  }
  for (const entry of set.cases) {
    if (entry.repositoryDigest === reference.repository || entry.requirementDigest === reference.requirement) {
      add('held-out-overlap', `${entry.id} reuses reference digests and is not held out`);
    }
  }
  if (gaps.some((gap) => gap.code === 'held-out-overlap')) {
    return validateHeldOutEvaluationRun({ schemaVersion: HELD_OUT_RUN_VERSION, id: `held-out-run.${set.sourceDigest.slice(0, 24)}`, status: 'blocked', cases, gaps, sourceDigest: set.sourceDigest, evaluatedAt: clock() });
  }
  const distinct = set.cases.filter((entry) => entry.structurallyDistinct === true).length;
  if (distinct < threshold) add('insufficient-distinct-cases', `${distinct} structurally distinct cases are available; ${threshold} are required`);
  if (typeof dependencies.copyCase !== 'function' || typeof dependencies.evaluateCase !== 'function') fail('heldOutRun.dependencies', 'copyCase and evaluateCase effects are required');
  if (typeof dependencies.workRoot !== 'string' || dependencies.workRoot.length === 0) fail('heldOutRun.workRoot', 'an isolated work root is required');
  const runIds = new Set();
  for (const entry of set.cases) {
    const destination = `${dependencies.workRoot.replace(/[\\/]$/, '')}/${entry.id}`;
    const root = await dependencies.copyCase(entry, destination);
    const result = await dependencies.evaluateCase({ caseEntry: entry, workRoot: root ?? destination });
    const runId = typeof result?.runId === 'string' && result.runId.length > 0 ? result.runId : `run.${entry.id}`;
    if (runIds.has(runId)) add('duplicate-run', `run ${runId} was reused across cases; independence is not proven`);
    runIds.add(runId);
    if (result?.verdict !== 'passed') add(`case-not-passed:${entry.id}`, `${entry.id} reported ${result?.verdict ?? 'no verdict'}`);
    cases.push({
      caseId: entry.id, runId,
      verdict: typeof result?.verdict === 'string' ? result.verdict : 'blocked',
      level: typeof result?.level === 'string' ? result.level : 'E0-generated',
      inputDigest: entry.inputDigest,
      outputDigest: canonicalValueDigest(result ?? { missing: true }),
    });
  }
  for (const entry of set.cases) {
    if (digestCaseRepository(entry) !== entry.repositoryDigest || digestCaseRequirement(entry) !== entry.requirementDigest) {
      add('provider-mutated', `${entry.id} provider inputs changed during evaluation`);
    }
  }
  const blocked = gaps.some((gap) => RUN_BLOCKING.includes(gap.code));
  const status = blocked ? 'blocked' : gaps.length === 0 ? 'passed' : 'incomplete';
  return validateHeldOutEvaluationRun({
    schemaVersion: HELD_OUT_RUN_VERSION,
    id: `held-out-run.${canonicalValueDigest({ source: set.sourceDigest, cases: cases.map((entry) => entry.caseId) }).slice(0, 24)}`,
    status, cases, gaps, sourceDigest: set.sourceDigest, evaluatedAt: clock(),
  });
}

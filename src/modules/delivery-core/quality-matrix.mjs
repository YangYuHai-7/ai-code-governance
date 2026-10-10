import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest, isSafeRelative } from '../../shared/index.mjs';
import { validateQualityMatrix } from '../stack-packs/index.mjs';
import { validateEvidenceIr } from './contracts.mjs';
import { riskProfileSetDigest, validateRiskProfileSet } from './risk-profiles.mjs';

export const QUALITY_MATRIX_RUN_VERSION = 1;
export const QUALITY_GATE_RESULT_STATUS = Object.freeze(['passed', 'failed', 'blocked', 'not-run', 'stale', 'unsupported', 'not-applicable']);

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const DIGEST_KEYS = ['requirement', 'architecture', 'repository', 'pack', 'risk', 'environment'];

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

function id(value, path) { string(value, path, { max: 128, pattern: ID }); }
function digest(value, path, nullable = false) {
  if (nullable && value === null) return;
  string(value, path, { max: 64, pattern: DIGEST });
}

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `expected an integer from ${min} to ${max}`);
}

function list(value, path, { min = 0, max = 4096 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected an array with ${min} to ${max} items`);
  return value;
}

function safePath(value, path) {
  string(value, path, { max: 1024 });
  if (!isSafeRelative(value)) fail(path, 'expected a safe repository-relative path');
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

function validateDigestSet(value) {
  fields(value, DIGEST_KEYS, DIGEST_KEYS, 'qualityMatrixPlan.digests');
  for (const key of DIGEST_KEYS) digest(value[key], `qualityMatrixPlan.digests.${key}`, key === 'architecture');
  return value;
}

function gatePlan(entry, applicability, reason) {
  return {
    id: entry.id,
    owner: entry.owner,
    purpose: entry.purpose,
    applicability,
    reason,
    timeoutMs: entry.timeoutMs,
    maxOutputBytes: entry.maxOutputBytes,
    artifactBudgetBytes: entry.artifactBudgetBytes,
    evidence: entry.evidence,
  };
}

function pathActivated(entry, scopes, changedPaths) {
  const prefixes = scopes?.[entry.id];
  if (!Array.isArray(prefixes) || prefixes.length === 0) return false;
  return prefixes.some((prefix) => changedPaths.some((changed) => changed === prefix || changed.startsWith(prefix.endsWith('/') ? prefix : `${prefix}/`)));
}

export function planQualityMatrix(input) {
  fields(input, ['packId', 'qualityMatrix', 'compatibility', 'riskProfileSet', 'changedPaths', 'pathScopes', 'digests'], ['packId', 'qualityMatrix', 'compatibility', 'riskProfileSet', 'changedPaths', 'digests'], 'qualityMatrixPlan');
  id(input.packId, 'qualityMatrixPlan.packId');
  const matrix = validateQualityMatrix(input.qualityMatrix);
  const risk = validateRiskProfileSet(input.riskProfileSet);
  const digests = validateDigestSet(input.digests);
  const compatibility = object(input.compatibility, 'qualityMatrixPlan.compatibility');
  if (compatibility.status !== 'compatible') fail('qualityMatrixPlan.compatibility', 'production verification requires a compatible environment');
  if (compatibility.packDigest !== risk.packDigest) fail('qualityMatrixPlan.compatibility', 'compatibility result is not bound to the current Pack');
  if (digests.requirement !== risk.requirementDigest) fail('qualityMatrixPlan.digests.requirement', 'requirement digest is not bound to the risk profile set');
  if (digests.pack !== risk.packDigest) fail('qualityMatrixPlan.digests.pack', 'pack digest is not bound to the risk profile set');
  if (digests.risk !== riskProfileSetDigest(risk)) fail('qualityMatrixPlan.digests.risk', 'risk digest is not bound to the risk profile set');
  const changedPaths = list(input.changedPaths, 'qualityMatrixPlan.changedPaths').map((entry, index) => {
    safePath(entry, `qualityMatrixPlan.changedPaths[${index}]`);
    return entry;
  });
  const scopes = input.pathScopes === undefined ? {} : object(input.pathScopes, 'qualityMatrixPlan.pathScopes');
  for (const [gateId, prefixes] of Object.entries(scopes)) {
    id(gateId, `qualityMatrixPlan.pathScopes.${gateId}`);
    list(prefixes, `qualityMatrixPlan.pathScopes.${gateId}`, { min: 1, max: 128 }).forEach((prefix, index) => safePath(prefix, `qualityMatrixPlan.pathScopes.${gateId}[${index}]`));
  }
  const matrixIds = new Set(matrix.gates.map((gate) => gate.id));
  for (const gateId of risk.requiredGateIds) if (!matrixIds.has(gateId)) fail('qualityMatrixPlan.riskProfileSet', `quality matrix is missing activated gate ${gateId}`);

  const gates = matrix.gates.map((entry) => {
    if (entry.applicability === 'always' && entry.required) return gatePlan(entry, 'required', null);
    if (entry.applicability === 'risk-activated' && risk.requiredGateIds.includes(entry.id)) return gatePlan(entry, 'required', null);
    if (entry.applicability === 'path-activated' && pathActivated(entry, scopes, changedPaths)) return gatePlan(entry, 'required', null);
    const reason = entry.required
      ? `no activated risk profile or changed path requires ${entry.id}`
      : `the Pack marks ${entry.id} optional`;
    return gatePlan(entry, 'not-applicable', reason);
  });
  const requiredGateIds = gates.filter((gate) => gate.applicability === 'required').map((gate) => gate.id).sort();
  const runId = `quality-run.${canonicalValueDigest({ packId: input.packId, matrixId: matrix.id, requiredGateIds, digests, changedPaths: [...changedPaths].sort() }).slice(0, 24)}`;
  return validateQualityMatrixPlan({ schemaVersion: QUALITY_MATRIX_RUN_VERSION, id: runId, packId: input.packId, matrixId: matrix.id, requiredGateIds, gates, digests });
}

export function validateQualityMatrixPlan(value) {
  const allowed = ['schemaVersion', 'id', 'packId', 'matrixId', 'requiredGateIds', 'gates', 'digests'];
  fields(value, allowed, allowed, 'qualityMatrixPlan');
  if (value.schemaVersion !== QUALITY_MATRIX_RUN_VERSION) fail('qualityMatrixPlan.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'qualityMatrixPlan.id');
  id(value.packId, 'qualityMatrixPlan.packId');
  id(value.matrixId, 'qualityMatrixPlan.matrixId');
  const ids = new Set();
  list(value.requiredGateIds, 'qualityMatrixPlan.requiredGateIds', { min: 1, max: 256 }).forEach((gate, index) => {
    id(gate, `qualityMatrixPlan.requiredGateIds[${index}]`);
    if (ids.has(gate)) fail(`qualityMatrixPlan.requiredGateIds[${index}]`, `duplicate gate ${gate}`);
    ids.add(gate);
  });
  const planned = new Set();
  list(value.gates, 'qualityMatrixPlan.gates', { min: 1, max: 256 }).forEach((gate, index) => {
    const path = `qualityMatrixPlan.gates[${index}]`;
    fields(gate, ['id', 'owner', 'purpose', 'applicability', 'reason', 'timeoutMs', 'maxOutputBytes', 'artifactBudgetBytes', 'evidence'], ['id', 'owner', 'purpose', 'applicability', 'reason', 'timeoutMs', 'maxOutputBytes', 'artifactBudgetBytes', 'evidence'], path);
    id(gate.id, `${path}.id`);
    if (planned.has(gate.id)) fail(`${path}.id`, `duplicate gate ${gate.id}`);
    planned.add(gate.id);
    id(gate.owner, `${path}.owner`);
    string(gate.purpose, `${path}.purpose`);
    if (!['required', 'not-applicable'].includes(gate.applicability)) fail(`${path}.applicability`, 'unsupported applicability');
    integer(gate.timeoutMs, `${path}.timeoutMs`, { min: 1 });
    integer(gate.maxOutputBytes, `${path}.maxOutputBytes`, { min: 1 });
    integer(gate.artifactBudgetBytes, `${path}.artifactBudgetBytes`, { min: 0 });
    string(gate.evidence, `${path}.evidence`, { max: 4096 });
    if (gate.applicability === 'required') { if (gate.reason !== null) fail(`${path}.reason`, 'a required gate must not carry a reason'); }
    else string(gate.reason, `${path}.reason`, { max: 4096 });
  });
  const requiredFromGates = value.gates.filter((gate) => gate.applicability === 'required').map((gate) => gate.id).sort();
  if (requiredFromGates.length !== value.requiredGateIds.length || requiredFromGates.some((gate, index) => gate !== value.requiredGateIds[index])) fail('qualityMatrixPlan.requiredGateIds', 'required gate IDs do not match the planned gates');
  validateDigestSet(value.digests);
  return normalized(value);
}

function validateResult(entry, path) {
  fields(entry, ['gateId', 'status', 'reason', 'failureClassification', 'cleanup', 'durationMs'], ['gateId', 'status'], path);
  id(entry.gateId, `${path}.gateId`);
  if (!QUALITY_GATE_RESULT_STATUS.includes(entry.status)) fail(`${path}.status`, 'unsupported gate status');
  if (entry.reason !== undefined && entry.reason !== null) string(entry.reason, `${path}.reason`, { max: 4096 });
  if (entry.status === 'not-applicable' && !entry.reason) fail(`${path}.reason`, 'not-applicable requires a reason');
  if (entry.status === 'failed' && !entry.failureClassification) fail(`${path}.failureClassification`, 'a failed gate requires a failure classification');
  if (entry.failureClassification !== undefined && entry.failureClassification !== null) string(entry.failureClassification, `${path}.failureClassification`, { max: 128, pattern: ID });
  if (entry.cleanup !== undefined) {
    fields(entry.cleanup, ['status', 'reason'], ['status'], `${path}.cleanup`);
    if (!['clean', 'failed'].includes(entry.cleanup.status)) fail(`${path}.cleanup.status`, 'unsupported cleanup status');
    if (entry.cleanup.reason !== undefined && entry.cleanup.reason !== null) string(entry.cleanup.reason, `${path}.cleanup.reason`, { max: 4096 });
    if (entry.cleanup.status === 'failed' && !entry.cleanup.reason) fail(`${path}.cleanup.reason`, 'failed cleanup requires a reason');
  }
  if (entry.durationMs !== undefined) integer(entry.durationMs, `${path}.durationMs`, { min: 0 });
  return entry;
}

function derivedStatus(results) {
  if (results.some((entry) => entry.status === 'failed')) return 'failed';
  const satisfied = results.every((entry) => entry.status === 'passed' || (entry.status === 'not-applicable' && Boolean(entry.reason)));
  return satisfied ? 'passed' : 'blocked';
}

function validateArtifactDigests(value, requiredGateIds, artifactBytes) {
  const paths = new Set();
  const entries = list(value, 'qualityMatrixRun.artifactDigests').map((entry, index) => {
    const path = `qualityMatrixRun.artifactDigests[${index}]`;
    fields(entry, ['gateId', 'path', 'digest', 'bytes'], ['gateId', 'path', 'digest', 'bytes'], path);
    id(entry.gateId, `${path}.gateId`);
    if (!requiredGateIds.includes(entry.gateId)) fail(`${path}.gateId`, `gate ${entry.gateId} is not required by the plan`);
    safePath(entry.path, `${path}.path`);
    if (paths.has(entry.path)) fail(`${path}.path`, `duplicate artifact ${entry.path}`);
    paths.add(entry.path);
    digest(entry.digest, `${path}.digest`);
    integer(entry.bytes, `${path}.bytes`, { min: 0, max: 512 * 1024 * 1024 });
    return entry;
  });
  const total = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  if (artifactBytes !== total) fail('qualityMatrixRun.artifactBytes', 'artifact byte total does not match the recorded artifacts');
  return entries;
}

export function validateQualityMatrixRun(value) {
  const allowed = ['schemaVersion', 'id', 'planId', 'requiredGateIds', 'results', 'status', 'digests', 'artifactDigests', 'artifactBytes', 'completedAt'];
  fields(value, allowed, allowed, 'qualityMatrixRun');
  if (value.schemaVersion !== QUALITY_MATRIX_RUN_VERSION) fail('qualityMatrixRun.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'qualityMatrixRun.id');
  id(value.planId, 'qualityMatrixRun.planId');
  const required = new Set();
  list(value.requiredGateIds, 'qualityMatrixRun.requiredGateIds', { min: 1, max: 256 }).forEach((gate, index) => {
    id(gate, `qualityMatrixRun.requiredGateIds[${index}]`);
    if (required.has(gate)) fail(`qualityMatrixRun.requiredGateIds[${index}]`, `duplicate gate ${gate}`);
    required.add(gate);
  });
  const results = list(value.results, 'qualityMatrixRun.results', { min: 1, max: 256 }).map((entry, index) => validateResult(entry, `qualityMatrixRun.results[${index}]`));
  const seen = new Set();
  for (const result of results) {
    if (!required.has(result.gateId)) fail('qualityMatrixRun.results', `gate ${result.gateId} is not required by the plan`);
    if (seen.has(result.gateId)) fail('qualityMatrixRun.results', `duplicate result for gate ${result.gateId}`);
    seen.add(result.gateId);
  }
  for (const gate of required) if (!seen.has(gate)) fail('qualityMatrixRun.results', `every required gate must have exactly one result; missing required gate ${gate}`);
  if (!['passed', 'failed', 'blocked'].includes(value.status)) fail('qualityMatrixRun.status', 'unsupported run status');
  if (value.status !== derivedStatus(results)) fail('qualityMatrixRun.status', 'run status does not match the validated results');
  validateDigestSet(value.digests);
  const artifacts = validateArtifactDigests(value.artifactDigests, [...required], value.artifactBytes);
  integer(value.artifactBytes, 'qualityMatrixRun.artifactBytes', { min: 0, max: 512 * 1024 * 1024 });
  string(value.completedAt, 'qualityMatrixRun.completedAt', { max: 64 });
  if (Number.isNaN(Date.parse(value.completedAt))) fail('qualityMatrixRun.completedAt', 'expected an ISO date-time');
  return normalized({ ...value, artifactDigests: artifacts });
}

export function evaluateQualityMatrixRun({ plan, results, artifacts = [], environment }) {
  const current = validateQualityMatrixPlan(plan);
  const environmentDigest = environment === undefined || environment === null
    ? current.digests.environment
    : (typeof environment === 'string' ? environment : environment.digest);
  digest(environmentDigest, 'qualityMatrixRun.environment');
  if (environmentDigest !== current.digests.environment) fail('qualityMatrixRun.environment', 'environment digest is stale; rerun verification for the current environment');
  const rawResults = list(results, 'qualityMatrixRun.results', { min: 1, max: 256 });
  const byGate = new Map();
  const normalizedResults = rawResults.map((entry, index) => {
    const result = validateResult(entry, `qualityMatrixRun.results[${index}]`);
    if (!current.requiredGateIds.includes(result.gateId)) fail(`qualityMatrixRun.results[${index}].gateId`, `gate ${result.gateId} is not required by the plan`);
    if (byGate.has(result.gateId)) fail(`qualityMatrixRun.results[${index}].gateId`, `duplicate result for gate ${result.gateId}`);
    byGate.set(result.gateId, result);
    return result;
  });
  const missing = current.requiredGateIds.filter((gate) => !byGate.has(gate));
  if (missing.length) fail('qualityMatrixRun.results', `missing required gate ${missing[0]}`);
  const budgets = new Map(current.gates.filter((gate) => gate.applicability === 'required').map((gate) => [gate.id, gate.artifactBudgetBytes]));
  const artifactBytes = new Map();
  const artifactDigests = list(artifacts, 'qualityMatrixRun.artifactDigests').map((entry, index) => {
    const path = `qualityMatrixRun.artifactDigests[${index}]`;
    fields(entry, ['gateId', 'path', 'digest', 'bytes'], ['gateId', 'path', 'digest', 'bytes'], path);
    id(entry.gateId, `${path}.gateId`);
    if (!budgets.has(entry.gateId)) fail(`${path}.gateId`, `gate ${entry.gateId} is not required by the plan`);
    safePath(entry.path, `${path}.path`);
    digest(entry.digest, `${path}.digest`);
    integer(entry.bytes, `${path}.bytes`, { min: 0, max: 512 * 1024 * 1024 });
    const total = (artifactBytes.get(entry.gateId) ?? 0) + entry.bytes;
    if (total > budgets.get(entry.gateId)) fail(`${path}.bytes`, `artifact budget exceeded for gate ${entry.gateId}`);
    artifactBytes.set(entry.gateId, total);
    return entry;
  });
  const totalBytes = artifactDigests.reduce((sum, entry) => sum + entry.bytes, 0);
  return validateQualityMatrixRun({
    schemaVersion: QUALITY_MATRIX_RUN_VERSION,
    id: `quality-run-result.${canonicalValueDigest({ planId: current.id, results: normalizedResults, artifacts: artifactDigests }).slice(0, 24)}`,
    planId: current.id,
    requiredGateIds: current.requiredGateIds,
    results: normalizedResults,
    status: derivedStatus(normalizedResults),
    digests: current.digests,
    artifactDigests,
    artifactBytes: totalBytes,
    completedAt: new Date().toISOString(),
  });
}

export function qualityMatrixRunDigest(value) {
  return canonicalValueDigest(validateQualityMatrixRun(value), { omit: ['completedAt'] });
}

function driverFor(drivers, purpose) {
  if (purpose === 'migration') return drivers.database;
  if (purpose === 'e2e') return drivers.browser;
  if (purpose === 'integration' || purpose === 'contract') return drivers.http;
  return drivers.command;
}

function resultFor(gate, receipt) {
  const status = ['passed', 'failed', 'blocked'].includes(receipt?.status) ? receipt.status : 'blocked';
  const entry = { gateId: gate.id, status, cleanup: { status: 'clean', reason: null } };
  if (receipt?.cleanup?.status === 'failed') entry.cleanup = { status: 'failed', reason: receipt.cleanup.reason ?? 'cleanup failed' };
  if (status === 'failed') entry.failureClassification = receipt?.failure?.classification ?? 'functional';
  if (status === 'blocked') entry.failureClassification = receipt?.failure?.classification ?? 'infrastructure';
  if (status !== 'passed') entry.reason = receipt?.failure?.message ?? `gate ${gate.id} did not pass`;
  if (Number.isSafeInteger(receipt?.durationMs) && receipt.durationMs >= 0) entry.durationMs = receipt.durationMs;
  return entry;
}

function skippedResult(gateId, reason) {
  return { gateId, status: 'not-run', reason, cleanup: { status: 'clean', reason: null } };
}

function evidenceFor(plan, sessionId, run, entry, artifacts) {
  return validateEvidenceIr({
    schemaVersion: 1,
    id: `evidence.gate.${canonicalValueDigest({ runId: run.id, gateId: entry.gateId }).slice(0, 24)}`,
    sessionId,
    source: 'automated-test',
    verificationLevel: 'enforced',
    semanticDigest: plan.digests.requirement,
    repositoryDigest: plan.digests.repository,
    commandDigest: null,
    resultDigest: canonicalValueDigest(entry),
    artifactDigests: artifacts.map((artifact) => ({ path: artifact.path, digest: artifact.digest })),
    status: entry.status === 'passed' ? 'passed' : entry.status === 'failed' ? 'failed' : entry.status === 'not-run' ? 'unrun' : 'blocked',
    recordedAt: new Date().toISOString(),
  });
}

// Executes one planned quality matrix: deterministic gate order, fail-fast with guaranteed cleanup,
// and one Evidence IR record per gate. Effects remain behind the injected drivers and ports.
export async function executeQualityMatrix({ root, plan, drivers, context = {}, policy = {}, signal = null }) {
  fields({ root, plan, drivers, context, policy, signal }, ['root', 'plan', 'drivers', 'context', 'policy', 'signal'], ['root', 'plan', 'drivers', 'context', 'policy', 'signal'], 'qualityMatrixExecution');
  string(root, 'qualityMatrixExecution.root', { max: 4096 });
  const current = validateQualityMatrixPlan(plan);
  object(drivers, 'qualityMatrixExecution.drivers');
  if (!Object.values(drivers).some((driver) => typeof driver === 'function')) fail('qualityMatrixExecution.drivers', 'at least one gate driver is required');
  object(context, 'qualityMatrixExecution.context');
  object(policy, 'qualityMatrixExecution.policy');
  string(policy.sessionId, 'qualityMatrixExecution.policy.sessionId', { max: 128, pattern: ID });
  const failFast = policy.failFast === undefined ? true : policy.failFast;
  if (typeof failFast !== 'boolean') fail('qualityMatrixExecution.policy.failFast', 'expected a boolean');
  if (signal !== null && typeof signal?.aborted !== 'boolean') fail('qualityMatrixExecution.signal', 'expected an AbortSignal');

  const results = [];
  const collected = [];
  let cleanup = Object.freeze({ status: 'clean', reason: null });
  let stopped = null;
  try {
    for (const gateId of current.requiredGateIds) {
      const gate = current.gates.find((candidate) => candidate.id === gateId);
      if (signal?.aborted) { results.push(skippedResult(gateId, 'verification was aborted')); continue; }
      if (stopped) { results.push(skippedResult(gateId, `not executed after ${stopped}`)); continue; }
      const driver = driverFor(drivers, gate.purpose);
      if (typeof driver !== 'function') {
        results.push({ gateId, status: 'blocked', reason: `no driver is registered for purpose ${gate.purpose}`, failureClassification: 'capability', cleanup: { status: 'clean', reason: null } });
        stopped = gateId;
        continue;
      }
      let receipt;
      try { receipt = await driver({ ...context, root }, gate); }
      catch (error) { receipt = { gateId: gate.id, status: 'blocked', failure: { classification: 'infrastructure', message: error.message }, artifacts: [] }; }
      const entry = resultFor(gate, receipt);
      results.push(entry);
      for (const artifact of receipt?.artifacts ?? []) collected.push({ gateId, path: artifact.path, digest: artifact.digest, bytes: artifact.bytes });
      if (entry.status !== 'passed' && failFast) stopped = gateId;
    }
  } finally {
    if (typeof context.process?.cleanupAll === 'function') {
      try { cleanup = await context.process.cleanupAll('quality-matrix-finished'); }
      catch (error) { cleanup = Object.freeze({ status: 'failed', reason: error.message }); }
    }
  }
  const run = evaluateQualityMatrixRun({ plan: current, results, artifacts: collected, environment: current.digests.environment });
  const evidence = run.results.map((entry) => evidenceFor(current, policy.sessionId, run, entry, collected.filter((artifact) => artifact.gateId === entry.gateId)));
  return Object.freeze({ run, evidence: Object.freeze(evidence), cleanup });
}

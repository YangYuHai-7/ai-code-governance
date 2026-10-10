import { usageError } from '../../kernel/index.mjs';

export const GOLDEN_PATH_EVALUATION_VERSION = 1;
export const EVALUATION_LEVELS = Object.freeze(['E0-generated', 'E1-deterministic', 'E2-integrated', 'E3-agent-executable']);
export const EVALUATION_VERDICTS = Object.freeze(['passed', 'failed', 'blocked', 'incomplete']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;

function fail(path, message) { throw usageError(`${path}: ${message}`); }
function object(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object'); return value; }
function fields(value, allowed, required, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of required) if (!Object.hasOwn(value, key)) fail(`${path}.${key}`, 'required field is missing');
}
function string(value, path, { max = 4096, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail(path, 'invalid string');
}
function list(value, path, { max = 256 } = {}) {
  if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== 'string' || entry.length === 0)) fail(path, 'expected a string array');
  return value;
}
function integer(value, path) { if (!Number.isSafeInteger(value) || value < 0) fail(path, 'expected a non-negative integer'); }

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) freeze(entry);
  return value;
}

export function validateGoldenPathEvaluation(value) {
  const allowed = ['schemaVersion', 'id', 'packId', 'agent', 'requirementPath', 'requirementDigest', 'level', 'verdict', 'environment', 'matrix', 'trace', 'budget', 'failureHistory', 'cleanup', 'entrypoint', 'rollback', 'gaps', 'evaluatedAt'];
  fields(value, allowed, allowed, 'goldenPathEvaluation');
  if (value.schemaVersion !== GOLDEN_PATH_EVALUATION_VERSION) fail('goldenPathEvaluation.schemaVersion', `unsupported version ${value.schemaVersion}`);
  string(value.id, 'goldenPathEvaluation.id', { max: 128 });
  if (!ID.test(value.id)) fail('goldenPathEvaluation.id', 'invalid id');
  string(value.packId, 'goldenPathEvaluation.packId', { max: 128 });
  fields(value.agent, ['id', 'version', 'real', 'live'], ['id', 'version', 'real', 'live'], 'goldenPathEvaluation.agent');
  string(value.agent.id, 'goldenPathEvaluation.agent.id', { max: 128 });
  string(value.agent.version, 'goldenPathEvaluation.agent.version', { max: 64, nullable: true });
  for (const key of ['real', 'live']) if (typeof value.agent[key] !== 'boolean') fail(`goldenPathEvaluation.agent.${key}`, 'expected a boolean');
  string(value.requirementPath, 'goldenPathEvaluation.requirementPath', { max: 1024 });
  if (!DIGEST.test(value.requirementDigest)) fail('goldenPathEvaluation.requirementDigest', 'expected a canonical digest');
  if (!EVALUATION_LEVELS.includes(value.level)) fail('goldenPathEvaluation.level', 'unsupported level');
  if (!EVALUATION_VERDICTS.includes(value.verdict)) fail('goldenPathEvaluation.verdict', 'unsupported verdict');
  fields(value.environment, ['digest', 'capabilities'], ['digest', 'capabilities'], 'goldenPathEvaluation.environment');
  if (!DIGEST.test(value.environment.digest)) fail('goldenPathEvaluation.environment.digest', 'expected a canonical digest');
  if (!Array.isArray(value.environment.capabilities)) fail('goldenPathEvaluation.environment.capabilities', 'expected an array');
  value.environment.capabilities.forEach((check, index) => {
    const path = `goldenPathEvaluation.environment.capabilities[${index}]`;
    fields(check, ['name', 'status', 'detail'], ['name', 'status', 'detail'], path);
    string(check.name, `${path}.name`, { max: 64 });
    if (!['passed', 'blocked'].includes(check.status)) fail(`${path}.status`, 'unsupported capability status');
    string(check.detail, `${path}.detail`, { max: 512 });
  });
  fields(value.matrix, ['status', 'runId', 'requiredGateIds', 'resolvedGateIds'], ['status', 'runId', 'requiredGateIds', 'resolvedGateIds'], 'goldenPathEvaluation.matrix');
  if (!['passed', 'failed', 'blocked', 'not-run'].includes(value.matrix.status)) fail('goldenPathEvaluation.matrix.status', 'unsupported matrix status');
  string(value.matrix.runId, 'goldenPathEvaluation.matrix.runId', { max: 128, nullable: true });
  list(value.matrix.requiredGateIds, 'goldenPathEvaluation.matrix.requiredGateIds');
  list(value.matrix.resolvedGateIds, 'goldenPathEvaluation.matrix.resolvedGateIds');
  fields(value.trace, ['requirement', 'architecture', 'patch', 'test', 'evidence', 'review'], ['requirement', 'architecture', 'patch', 'test', 'evidence', 'review'], 'goldenPathEvaluation.trace');
  for (const key of Object.keys(value.trace)) string(value.trace[key], `goldenPathEvaluation.trace.${key}`, { max: 128, nullable: true });
  fields(value.budget, ['agentTurns', 'elapsedMs'], ['agentTurns', 'elapsedMs'], 'goldenPathEvaluation.budget');
  integer(value.budget.agentTurns, 'goldenPathEvaluation.budget.agentTurns');
  integer(value.budget.elapsedMs, 'goldenPathEvaluation.budget.elapsedMs');
  list(value.failureHistory, 'goldenPathEvaluation.failureHistory');
  fields(value.cleanup, ['status', 'reason'], ['status', 'reason'], 'goldenPathEvaluation.cleanup');
  if (!['clean', 'failed'].includes(value.cleanup.status)) fail('goldenPathEvaluation.cleanup.status', 'unsupported cleanup status');
  string(value.cleanup.reason, 'goldenPathEvaluation.cleanup.reason', { nullable: true, max: 4096 });
  string(value.entrypoint, 'goldenPathEvaluation.entrypoint', { max: 1024, nullable: true });
  string(value.rollback, 'goldenPathEvaluation.rollback', { max: 4096, nullable: true });
  list(value.gaps, 'goldenPathEvaluation.gaps');
  string(value.evaluatedAt, 'goldenPathEvaluation.evaluatedAt', { max: 64 });
  if (Number.isNaN(Date.parse(value.evaluatedAt))) fail('goldenPathEvaluation.evaluatedAt', 'expected an ISO date-time');
  return freeze(JSON.parse(JSON.stringify(value)));
}

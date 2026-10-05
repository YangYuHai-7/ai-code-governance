import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest, sha256 } from '../../shared/index.mjs';
import {
  canonicalContractDigest,
  validateArchitectureIr,
  validateDeliverySession,
  validateRequirementIr,
} from './contracts.mjs';

const VOLATILE = ['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt'];
const TRANSITIONS = Object.freeze({
  'approve-requirements': { from: ['requirements-pending', 'draft'], to: 'requirements-approved' },
  'set-architecture': { from: ['requirements-approved'], to: 'architecture-ready' },
  'approve-plan': { from: ['architecture-ready'], to: 'plan-approved' },
  'start-execution': { from: ['plan-approved', 'repairing'], to: 'executing' },
  'start-verification': { from: ['executing'], to: 'verifying' },
  'request-repair': { from: ['verifying'], to: 'repairing' },
  'ready-for-review': { from: ['verifying'], to: 'review-ready' },
  block: { from: ['draft', 'requirements-pending', 'requirements-approved', 'architecture-ready', 'plan-approved', 'executing', 'verifying', 'repairing', 'review-ready'], to: 'blocked' },
  fail: { from: ['draft', 'requirements-pending', 'requirements-approved', 'architecture-ready', 'plan-approved', 'executing', 'verifying', 'repairing'], to: 'failed' },
  complete: { from: ['review-ready'], to: 'completed' },
  cancel: { from: ['draft', 'requirements-pending', 'requirements-approved', 'architecture-ready', 'plan-approved', 'executing', 'verifying', 'repairing', 'review-ready', 'blocked', 'failed'], to: 'cancelled' },
});

function digestValue(value) { return canonicalValueDigest(value, { omit: VOLATILE }); }
function now(clock) { return (clock ?? (() => new Date().toISOString()))(); }

function validateSessionId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(id)) throw usageError('Invalid delivery session id.');
}

export function createDeliverySession({ id, requestText, requirement = null, architecture = null, authority, budgets, repositorySnapshot, clock }) {
  validateSessionId(id);
  if (typeof requestText !== 'string' || requestText.trim().length === 0) throw usageError('Delivery session requestText is required.');
  if (!authority || typeof authority !== 'object' || Array.isArray(authority)) throw usageError('Delivery session authority is required.');
  if (!repositorySnapshot || typeof repositorySnapshot !== 'object' || Array.isArray(repositorySnapshot)) throw usageError('Delivery session repository snapshot is required.');
  const normalizedRequirement = requirement === null ? null : validateRequirementIr(requirement);
  const normalizedArchitecture = architecture === null ? null : validateArchitectureIr(architecture);
  const requirementDigest = normalizedRequirement ? canonicalContractDigest('requirement', normalizedRequirement) : null;
  const architectureDigest = normalizedArchitecture ? canonicalContractDigest('architecture', normalizedArchitecture) : null;
  if (normalizedArchitecture && normalizedArchitecture.requirementDigest !== requirementDigest) throw usageError('Architecture requirementDigest does not bind the current requirement.');
  const timestamp = now(clock);
  return validateDeliverySession({
    schemaVersion: 1,
    id,
    state: normalizedArchitecture ? 'architecture-ready' : normalizedRequirement ? 'requirements-approved' : 'requirements-pending',
    sequence: 0,
    requestDigest: sha256(requestText.trim()),
    requirementDigest,
    architectureDigest,
    authorityDigest: digestValue(authority),
    repositoryDigest: digestValue(repositorySnapshot),
    previousDigest: null,
    idempotencyKey: `create:${id}`,
    checkpoints: [],
    budgets,
    requestText: requestText.trim(),
    requirement: normalizedRequirement,
    architecture: normalizedArchitecture,
    authority,
    repositorySnapshot,
    usage: { agentTurns: 0, commands: 0, changedFiles: 0, changedBytes: 0, inputTokens: 'unverified', outputTokens: 'unverified', cost: 'unverified' },
    lastFailure: null,
    activeAgentId: null,
    createdAt: timestamp,
    updatedAt: timestamp,
  });
}

export function transitionDeliverySession(session, event) {
  const current = validateDeliverySession(session);
  if (!event || typeof event !== 'object' || Array.isArray(event)) throw usageError('Delivery session event is required.');
  if (typeof event.idempotencyKey !== 'string' || event.idempotencyKey.length === 0) throw usageError('Delivery session event idempotencyKey is required.');
  if (event.idempotencyKey === current.idempotencyKey) return session;
  const rule = TRANSITIONS[event.type];
  if (!rule || !rule.from.includes(current.state)) throw usageError(`Illegal delivery session transition: ${current.state} -> ${event.type ?? 'unknown'}.`);
  let requirement = current.requirement ?? null;
  let architecture = current.architecture ?? null;
  let requirementDigest = current.requirementDigest;
  let architectureDigest = current.architectureDigest;
  if (event.type === 'approve-requirements') {
    requirement = validateRequirementIr(event.requirement);
    requirementDigest = canonicalContractDigest('requirement', requirement);
    architecture = null; architectureDigest = null;
  }
  if (event.type === 'set-architecture') {
    architecture = validateArchitectureIr(event.architecture);
    if (architecture.requirementDigest !== requirementDigest) throw usageError('Architecture is stale for the approved requirement.');
    architectureDigest = canonicalContractDigest('architecture', architecture);
  }
  const next = {
    ...current,
    state: rule.to,
    sequence: current.sequence + 1,
    previousDigest: canonicalContractDigest('session', current),
    idempotencyKey: event.idempotencyKey,
    requirement,
    requirementDigest,
    architecture,
    architectureDigest,
    lastFailure: ['block', 'fail', 'request-repair'].includes(event.type) ? (event.failure ?? { category: event.type, message: event.reason ?? event.type }) : current.lastFailure,
    updatedAt: event.at ?? new Date().toISOString(),
  };
  return validateDeliverySession(next);
}

export function createSessionCheckpoint(session, reason, clock) {
  const current = validateDeliverySession(session);
  if (typeof reason !== 'string' || reason.length === 0 || reason.length > 2048) throw usageError('Checkpoint reason is required.');
  const previousDigest = canonicalContractDigest('session', current);
  const sequence = current.sequence + 1;
  const checkpoint = {
    sequence,
    state: current.state,
    reason,
    previousDigest,
    sessionDigest: previousDigest,
    createdAt: now(clock),
  };
  return validateDeliverySession({
    ...current,
    sequence,
    previousDigest,
    idempotencyKey: `checkpoint:${sequence}:${sha256(reason).slice(0, 12)}`,
    checkpoints: [...current.checkpoints, checkpoint].slice(-64),
    updatedAt: checkpoint.createdAt,
  });
}

export function resumeDeliverySession(session, currentInputs) {
  const current = validateDeliverySession(session);
  if (['completed', 'cancelled'].includes(current.state)) throw usageError(`Cannot resume terminal delivery session state ${current.state}.`);
  if (!currentInputs || typeof currentInputs !== 'object') throw usageError('Current delivery session inputs are required for resume.');
  for (const key of ['requirementDigest', 'architectureDigest', 'authorityDigest', 'repositoryDigest']) {
    if (currentInputs[key] !== current[key]) throw usageError(`Stale delivery session ${key}; refresh and obtain approval before resume.`);
  }
  return session;
}

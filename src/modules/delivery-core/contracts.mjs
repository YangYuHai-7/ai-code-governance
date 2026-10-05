import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';

export const REQUIREMENT_IR_VERSION = 2;
export const ARCHITECTURE_IR_VERSION = 1;
export const EVIDENCE_IR_VERSION = 1;
export const COMPLETION_CONTRACT_VERSION = 1;
export const DELIVERY_SESSION_VERSION = 1;
export const DELIVERY_SESSION_STATES = Object.freeze([
  'draft', 'requirements-pending', 'requirements-approved', 'architecture-ready',
  'plan-approved', 'executing', 'verifying', 'repairing', 'review-ready',
  'blocked', 'failed', 'completed', 'cancelled',
]);

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const VOLATILE_KEYS = new Set(['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt']);
const STAGES = Object.freeze(['governance', 'requirements', 'architecture', 'implementation', 'automated-verification', 'independent-review', 'human-acceptance', 'deployability', 'deployment']);

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

function string(value, path, { max = 8192, pattern = null, nullable = false } = {}) {
  if (nullable && value === null) return;
  if (typeof value !== 'string' || value.length < 1 || value.length > max || (pattern && !pattern.test(value))) fail(path, 'invalid string');
}

function id(value, path) { string(value, path, { max: 128, pattern: ID }); }
function digest(value, path, nullable = false) { string(value, path, { max: 64, pattern: HASH, nullable }); }

function integer(value, path, { min = 0, max = Number.MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < min || value > max) fail(path, `expected an integer from ${min} to ${max}`);
}

function number(value, path, { min = 0 } = {}) {
  if (!Number.isFinite(value) || value < min) fail(path, `expected a finite number >= ${min}`);
}

function enumeration(value, values, path) {
  if (!values.includes(value)) fail(path, `expected one of ${values.join(', ')}`);
}

function array(value, path, { max = 256, min = 0 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected an array with ${min} to ${max} items`);
  return value;
}

function bool(value, path) { if (typeof value !== 'boolean') fail(path, 'expected a boolean'); }

function textArray(value, path, options) {
  array(value, path, options).forEach((entry, index) => string(entry, `${path}[${index}]`));
}

function idsUnique(entries, path) {
  const seen = new Set();
  entries.forEach((entry, index) => {
    id(entry.id, `${path}[${index}].id`);
    if (seen.has(entry.id)) fail(`${path}[${index}].id`, `duplicate ID ${entry.id}`);
    seen.add(entry.id);
  });
  return seen;
}

function safePath(value, path) {
  string(value, path, { max: 1024 });
  const normalized = value.replaceAll('\\', '/');
  if (normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized) || normalized.split('/').includes('..') || normalized.includes('\0')) fail(path, 'expected a safe repository-relative path');
}

function timestamp(value, path) {
  if (value === undefined) return;
  string(value, path, { max: 64 });
  if (Number.isNaN(Date.parse(value))) fail(path, 'expected an ISO date-time');
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

function validateIdStatement(entry, path, statuses = null) {
  const allowed = statuses ? ['id', 'statement', 'status'] : ['id', 'statement'];
  fields(entry, allowed, allowed, path);
  id(entry.id, `${path}.id`);
  string(entry.statement, `${path}.statement`);
  if (statuses) enumeration(entry.status, statuses, `${path}.status`);
}

function validateField(entry, path) {
  fields(entry, ['id', 'name', 'type', 'required', 'rules'], ['id', 'name', 'type', 'rules'], path);
  id(entry.id, `${path}.id`); string(entry.name, `${path}.name`); string(entry.type, `${path}.type`);
  if (entry.required !== undefined) bool(entry.required, `${path}.required`);
  textArray(entry.rules, `${path}.rules`);
}

export function validateRequirementIr(value) {
  const allowed = ['schemaVersion', 'id', 'title', 'summary', 'actors', 'goals', 'scope', 'nonGoals', 'preconditions', 'businessRules', 'stateTransitions', 'inputs', 'outputs', 'failures', 'permissions', 'dataLifecycle', 'nfrs', 'rollout', 'rollback', 'acceptanceScenarios', 'assumptions', 'openQuestions', 'ownerDecisions', 'sourceEvidence', 'createdAt', 'updatedAt'];
  const required = allowed.filter((key) => !['createdAt', 'updatedAt'].includes(key));
  fields(value, allowed, required, 'requirement');
  if (value.schemaVersion !== REQUIREMENT_IR_VERSION) fail('requirement.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'requirement.id'); string(value.title, 'requirement.title'); string(value.summary, 'requirement.summary');

  array(value.actors, 'requirement.actors', { max: 128, min: 1 }).forEach((entry, index) => {
    const path = `requirement.actors[${index}]`; fields(entry, ['id', 'name', 'goals'], ['id', 'name', 'goals'], path);
    id(entry.id, `${path}.id`); string(entry.name, `${path}.name`); textArray(entry.goals, `${path}.goals`, { min: 1 });
  });
  const actorIds = idsUnique(value.actors, 'requirement.actors');
  array(value.goals, 'requirement.goals', { min: 1 }).forEach((entry, index) => {
    const path = `requirement.goals[${index}]`; fields(entry, ['id', 'actorId', 'statement'], ['id', 'actorId', 'statement'], path);
    id(entry.id, `${path}.id`); id(entry.actorId, `${path}.actorId`); string(entry.statement, `${path}.statement`);
    if (!actorIds.has(entry.actorId)) fail(`${path}.actorId`, 'unknown actor');
  });
  idsUnique(value.goals, 'requirement.goals');
  for (const name of ['scope', 'nonGoals', 'preconditions']) textArray(value[name], `requirement.${name}`, { min: name === 'scope' ? 1 : 0 });
  array(value.businessRules, 'requirement.businessRules', { min: 1 }).forEach((entry, index) => validateIdStatement(entry, `requirement.businessRules[${index}]`));
  idsUnique(value.businessRules, 'requirement.businessRules');
  array(value.stateTransitions, 'requirement.stateTransitions').forEach((entry, index) => {
    const path = `requirement.stateTransitions[${index}]`; fields(entry, ['id', 'from', 'event', 'to', 'guard'], ['id', 'from', 'event', 'to'], path);
    id(entry.id, `${path}.id`); string(entry.from, `${path}.from`); string(entry.event, `${path}.event`); string(entry.to, `${path}.to`);
    if (entry.guard !== undefined) string(entry.guard, `${path}.guard`);
    if (entry.from === entry.to) fail(path, 'state transition must change state');
  });
  idsUnique(value.stateTransitions, 'requirement.stateTransitions');
  for (const name of ['inputs', 'outputs']) {
    array(value[name], `requirement.${name}`).forEach((entry, index) => validateField(entry, `requirement.${name}[${index}]`));
    idsUnique(value[name], `requirement.${name}`);
  }
  array(value.failures, 'requirement.failures', { min: 1 }).forEach((entry, index) => {
    const path = `requirement.failures[${index}]`; fields(entry, ['id', 'condition', 'outcome'], ['id', 'condition', 'outcome'], path);
    id(entry.id, `${path}.id`); string(entry.condition, `${path}.condition`); string(entry.outcome, `${path}.outcome`);
  });
  idsUnique(value.failures, 'requirement.failures');
  array(value.permissions, 'requirement.permissions', { min: 1 }).forEach((entry, index) => {
    const path = `requirement.permissions[${index}]`; fields(entry, ['id', 'actorId', 'action', 'effect', 'condition'], ['id', 'actorId', 'action', 'effect'], path);
    id(entry.id, `${path}.id`); id(entry.actorId, `${path}.actorId`); string(entry.action, `${path}.action`); enumeration(entry.effect, ['allow', 'deny'], `${path}.effect`);
    if (!actorIds.has(entry.actorId)) fail(`${path}.actorId`, 'unknown actor');
    if (entry.condition !== undefined) string(entry.condition, `${path}.condition`);
  });
  idsUnique(value.permissions, 'requirement.permissions');
  array(value.dataLifecycle, 'requirement.dataLifecycle', { min: 1 }).forEach((entry, index) => {
    const path = `requirement.dataLifecycle[${index}]`; fields(entry, ['id', 'data', 'retention', 'deletion'], ['id', 'data', 'retention', 'deletion'], path);
    id(entry.id, `${path}.id`); string(entry.data, `${path}.data`); string(entry.retention, `${path}.retention`); string(entry.deletion, `${path}.deletion`);
  });
  idsUnique(value.dataLifecycle, 'requirement.dataLifecycle');
  array(value.nfrs, 'requirement.nfrs', { min: 1 }).forEach((entry, index) => {
    const path = `requirement.nfrs[${index}]`; fields(entry, ['id', 'category', 'requirement'], ['id', 'category', 'requirement'], path);
    id(entry.id, `${path}.id`); string(entry.category, `${path}.category`); string(entry.requirement, `${path}.requirement`);
  });
  idsUnique(value.nfrs, 'requirement.nfrs');
  fields(value.rollout, ['strategy', 'safeguards'], ['strategy', 'safeguards'], 'requirement.rollout');
  string(value.rollout.strategy, 'requirement.rollout.strategy'); textArray(value.rollout.safeguards, 'requirement.rollout.safeguards');
  fields(value.rollback, ['trigger', 'action'], ['trigger', 'action'], 'requirement.rollback');
  string(value.rollback.trigger, 'requirement.rollback.trigger'); string(value.rollback.action, 'requirement.rollback.action');
  array(value.acceptanceScenarios, 'requirement.acceptanceScenarios', { min: 1 }).forEach((entry, index) => {
    const path = `requirement.acceptanceScenarios[${index}]`; fields(entry, ['id', 'given', 'when', 'then'], ['id', 'given', 'when', 'then'], path);
    id(entry.id, `${path}.id`); textArray(entry.given, `${path}.given`, { min: 1 }); string(entry.when, `${path}.when`); textArray(entry.then, `${path}.then`, { min: 1 });
  });
  idsUnique(value.acceptanceScenarios, 'requirement.acceptanceScenarios');
  array(value.assumptions, 'requirement.assumptions').forEach((entry, index) => validateIdStatement(entry, `requirement.assumptions[${index}]`, ['stated', 'confirmed', 'rejected']));
  idsUnique(value.assumptions, 'requirement.assumptions');
  array(value.openQuestions, 'requirement.openQuestions').forEach((entry, index) => {
    const path = `requirement.openQuestions[${index}]`; fields(entry, ['id', 'question', 'material', 'status', 'answer'], ['id', 'question', 'material', 'status'], path);
    id(entry.id, `${path}.id`); string(entry.question, `${path}.question`); bool(entry.material, `${path}.material`); enumeration(entry.status, ['open', 'answered', 'deferred'], `${path}.status`);
    if (entry.answer !== undefined) string(entry.answer, `${path}.answer`);
    if (entry.material && entry.status === 'open') fail(path, 'material open question requires an owner decision');
    if (entry.status === 'answered' && !entry.answer) fail(`${path}.answer`, 'answered question requires an answer');
  });
  const questionIds = idsUnique(value.openQuestions, 'requirement.openQuestions');
  array(value.ownerDecisions, 'requirement.ownerDecisions').forEach((entry, index) => {
    const path = `requirement.ownerDecisions[${index}]`; fields(entry, ['id', 'questionId', 'decision', 'status'], ['id', 'questionId', 'decision', 'status'], path);
    id(entry.id, `${path}.id`); if (entry.questionId !== null) { id(entry.questionId, `${path}.questionId`); if (!questionIds.has(entry.questionId)) fail(`${path}.questionId`, 'unknown question'); }
    string(entry.decision, `${path}.decision`); enumeration(entry.status, ['proposed', 'approved', 'rejected'], `${path}.status`);
  });
  idsUnique(value.ownerDecisions, 'requirement.ownerDecisions');
  array(value.sourceEvidence, 'requirement.sourceEvidence', { min: 1 }).forEach((entry, index) => {
    const path = `requirement.sourceEvidence[${index}]`; fields(entry, ['id', 'source', 'level', 'digest'], ['id', 'source', 'level', 'digest'], path);
    id(entry.id, `${path}.id`); string(entry.source, `${path}.source`); enumeration(entry.level, ['stated', 'reachable', 'enforced', 'verified'], `${path}.level`); digest(entry.digest, `${path}.digest`);
  });
  idsUnique(value.sourceEvidence, 'requirement.sourceEvidence');
  timestamp(value.createdAt, 'requirement.createdAt'); timestamp(value.updatedAt, 'requirement.updatedAt');
  return normalized(value);
}

export function validateArchitectureIr(value) {
  const allowed = ['schemaVersion', 'id', 'requirementDigest', 'modules', 'publicContracts', 'dependencies', 'compositionRoots', 'decisions', 'constraints', 'risks', 'evidenceGaps', 'createdAt', 'updatedAt'];
  fields(value, allowed, allowed.filter((key) => !['createdAt', 'updatedAt'].includes(key)), 'architecture');
  if (value.schemaVersion !== ARCHITECTURE_IR_VERSION) fail('architecture.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'architecture.id'); digest(value.requirementDigest, 'architecture.requirementDigest');
  array(value.modules, 'architecture.modules', { min: 1 }).forEach((entry, index) => {
    const path = `architecture.modules[${index}]`; fields(entry, ['id', 'name', 'owns'], ['id', 'name', 'owns'], path);
    id(entry.id, `${path}.id`); string(entry.name, `${path}.name`); array(entry.owns, `${path}.owns`, { max: 512, min: 1 }).forEach((owned, ownedIndex) => safePath(owned, `${path}.owns[${ownedIndex}]`));
  });
  const moduleIds = idsUnique(value.modules, 'architecture.modules');
  array(value.publicContracts, 'architecture.publicContracts').forEach((entry, index) => {
    const path = `architecture.publicContracts[${index}]`; fields(entry, ['id', 'moduleId', 'kind', 'name'], ['id', 'moduleId', 'kind', 'name'], path);
    id(entry.id, `${path}.id`); id(entry.moduleId, `${path}.moduleId`); enumeration(entry.kind, ['function', 'class', 'http', 'rpc', 'event', 'schema', 'cli'], `${path}.kind`); string(entry.name, `${path}.name`);
    if (!moduleIds.has(entry.moduleId)) fail(`${path}.moduleId`, 'unknown module');
  });
  idsUnique(value.publicContracts, 'architecture.publicContracts');
  array(value.dependencies, 'architecture.dependencies', { max: 512 }).forEach((entry, index) => {
    const path = `architecture.dependencies[${index}]`; fields(entry, ['from', 'to', 'direction'], ['from', 'to', 'direction'], path);
    id(entry.from, `${path}.from`); id(entry.to, `${path}.to`); enumeration(entry.direction, ['inbound', 'outbound'], `${path}.direction`);
  });
  array(value.compositionRoots, 'architecture.compositionRoots', { max: 128, min: 1 }).forEach((entry, index) => {
    const path = `architecture.compositionRoots[${index}]`; fields(entry, ['id', 'path', 'modules'], ['id', 'path', 'modules'], path);
    id(entry.id, `${path}.id`); safePath(entry.path, `${path}.path`); array(entry.modules, `${path}.modules`, { min: 1 }).forEach((moduleId, moduleIndex) => { id(moduleId, `${path}.modules[${moduleIndex}]`); if (!moduleIds.has(moduleId)) fail(`${path}.modules[${moduleIndex}]`, 'unknown module'); });
  });
  idsUnique(value.compositionRoots, 'architecture.compositionRoots');
  for (const name of ['decisions', 'evidenceGaps']) {
    array(value[name], `architecture.${name}`).forEach((entry, index) => validateIdStatement(entry, `architecture.${name}[${index}]`, ['proposed', 'approved', 'rejected', 'open']));
    idsUnique(value[name], `architecture.${name}`);
  }
  array(value.constraints, 'architecture.constraints').forEach((entry, index) => {
    const path = `architecture.constraints[${index}]`; fields(entry, ['id', 'statement', 'level'], ['id', 'statement', 'level'], path);
    id(entry.id, `${path}.id`); string(entry.statement, `${path}.statement`); enumeration(entry.level, ['stated', 'reachable', 'enforced', 'verified'], `${path}.level`);
  });
  idsUnique(value.constraints, 'architecture.constraints');
  array(value.risks, 'architecture.risks').forEach((entry, index) => {
    const path = `architecture.risks[${index}]`; fields(entry, ['id', 'statement', 'mitigation'], ['id', 'statement', 'mitigation'], path);
    id(entry.id, `${path}.id`); string(entry.statement, `${path}.statement`); string(entry.mitigation, `${path}.mitigation`);
  });
  idsUnique(value.risks, 'architecture.risks');
  timestamp(value.createdAt, 'architecture.createdAt'); timestamp(value.updatedAt, 'architecture.updatedAt');
  return normalized(value);
}

export function validateEvidenceIr(value) {
  const allowed = ['schemaVersion', 'id', 'sessionId', 'source', 'verificationLevel', 'semanticDigest', 'repositoryDigest', 'commandDigest', 'resultDigest', 'artifactDigests', 'status', 'recordedAt'];
  fields(value, allowed, allowed.filter((key) => key !== 'recordedAt'), 'evidence');
  if (value.schemaVersion !== EVIDENCE_IR_VERSION) fail('evidence.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'evidence.id'); id(value.sessionId, 'evidence.sessionId');
  enumeration(value.source, ['operator-request', 'repository', 'agent-process', 'automated-test', 'independent-review', 'human-acceptance', 'deployment'], 'evidence.source');
  enumeration(value.verificationLevel, ['stated', 'reachable', 'enforced', 'verified'], 'evidence.verificationLevel');
  digest(value.semanticDigest, 'evidence.semanticDigest'); digest(value.repositoryDigest, 'evidence.repositoryDigest'); digest(value.commandDigest, 'evidence.commandDigest', true); digest(value.resultDigest, 'evidence.resultDigest');
  array(value.artifactDigests, 'evidence.artifactDigests', { max: 512 }).forEach((entry, index) => {
    const path = `evidence.artifactDigests[${index}]`; fields(entry, ['path', 'digest'], ['path', 'digest'], path); safePath(entry.path, `${path}.path`); digest(entry.digest, `${path}.digest`);
  });
  enumeration(value.status, ['passed', 'failed', 'blocked', 'unrun', 'unsupported'], 'evidence.status'); timestamp(value.recordedAt, 'evidence.recordedAt');
  return normalized(value);
}

export function validateCompletionContract(value) {
  const allowed = ['schemaVersion', 'sessionId', 'profile', 'requiredStages', 'gates', 'residualGaps', 'implementation', 'verification', 'acceptance', 'deployability', 'deployment', 'overall', 'evaluatedAt'];
  fields(value, allowed, allowed.filter((key) => key !== 'evaluatedAt'), 'completion');
  if (value.schemaVersion !== COMPLETION_CONTRACT_VERSION) fail('completion.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.sessionId, 'completion.sessionId'); enumeration(value.profile, ['advisory', 'production'], 'completion.profile');
  array(value.requiredStages, 'completion.requiredStages', { max: STAGES.length }).forEach((stage, index) => enumeration(stage, STAGES, `completion.requiredStages[${index}]`));
  if (new Set(value.requiredStages).size !== value.requiredStages.length) fail('completion.requiredStages', 'duplicate stage');
  const gates = new Map();
  array(value.gates, 'completion.gates', { max: STAGES.length }).forEach((gate, index) => {
    const path = `completion.gates[${index}]`; fields(gate, ['id', 'applicability', 'status', 'evidenceIds', 'reason'], ['id', 'applicability', 'status', 'evidenceIds', 'reason'], path);
    enumeration(gate.id, STAGES, `${path}.id`); enumeration(gate.applicability, ['applicable', 'not-applicable'], `${path}.applicability`); enumeration(gate.status, ['passed', 'failed', 'blocked', 'unrun', 'unsupported', 'stale', 'not-applicable'], `${path}.status`);
    array(gate.evidenceIds, `${path}.evidenceIds`).forEach((entry, evidenceIndex) => id(entry, `${path}.evidenceIds[${evidenceIndex}]`));
    if (gate.reason !== null) string(gate.reason, `${path}.reason`, { max: 4096 });
    if (gate.applicability === 'not-applicable' && !gate.reason) fail(`${path}.reason`, 'not-applicable gate requires a reason');
    if (gate.applicability === 'not-applicable' && gate.status !== 'not-applicable') fail(`${path}.status`, 'not-applicable gate requires not-applicable status');
    if (gate.applicability === 'applicable' && gate.status === 'not-applicable') fail(`${path}.status`, 'applicable gate cannot be not-applicable');
    if (gates.has(gate.id)) fail(`${path}.id`, `duplicate gate ${gate.id}`); gates.set(gate.id, gate);
  });
  for (const stage of value.requiredStages) if (!gates.has(stage)) fail('completion.gates', `required stage ${stage} has no gate`);
  textArray(value.residualGaps, 'completion.residualGaps');
  enumeration(value.implementation, ['missing', 'partial', 'complete'], 'completion.implementation'); enumeration(value.verification, ['unverified', 'failed', 'verified'], 'completion.verification'); enumeration(value.acceptance, ['unreviewed', 'rejected', 'accepted', 'not-applicable'], 'completion.acceptance'); enumeration(value.deployability, ['unknown', 'blocked', 'ready'], 'completion.deployability'); enumeration(value.deployment, ['not-deployed', 'failed', 'deployed', 'not-applicable'], 'completion.deployment'); enumeration(value.overall, ['incomplete', 'blocked', 'complete'], 'completion.overall');
  if (value.overall === 'complete') {
    if (value.residualGaps.length || value.requiredStages.some((stage) => !['passed', 'not-applicable'].includes(gates.get(stage)?.status))) fail('completion.overall', 'complete requires every required gate to pass or be explicitly not applicable');
    if (value.implementation !== 'complete' || value.verification !== 'verified' || value.deployability !== 'ready') fail('completion.overall', 'complete requires complete implementation, verified automation, and deployability');
  }
  if (value.profile === 'production' && value.requiredStages.some((stage) => !gates.has(stage))) fail('completion.gates', 'production profile requires every declared stage');
  timestamp(value.evaluatedAt, 'completion.evaluatedAt');
  return normalized(value);
}

export function validateDeliverySession(value) {
  const allowed = ['schemaVersion', 'id', 'state', 'sequence', 'requestDigest', 'requirementDigest', 'architectureDigest', 'authorityDigest', 'repositoryDigest', 'previousDigest', 'idempotencyKey', 'checkpoints', 'budgets', 'requestText', 'requirement', 'architecture', 'authority', 'repositorySnapshot', 'usage', 'lastFailure', 'activeAgentId', 'createdAt', 'updatedAt'];
  const required = ['schemaVersion', 'id', 'state', 'sequence', 'requestDigest', 'requirementDigest', 'architectureDigest', 'authorityDigest', 'repositoryDigest', 'previousDigest', 'idempotencyKey', 'checkpoints', 'budgets'];
  fields(value, allowed, required, 'session');
  if (value.schemaVersion !== DELIVERY_SESSION_VERSION) fail('session.schemaVersion', `unsupported version ${value.schemaVersion}`);
  id(value.id, 'session.id'); enumeration(value.state, DELIVERY_SESSION_STATES, 'session.state'); integer(value.sequence, 'session.sequence'); digest(value.requestDigest, 'session.requestDigest'); digest(value.requirementDigest, 'session.requirementDigest', true); digest(value.architectureDigest, 'session.architectureDigest', true); digest(value.authorityDigest, 'session.authorityDigest'); digest(value.repositoryDigest, 'session.repositoryDigest'); digest(value.previousDigest, 'session.previousDigest', true); string(value.idempotencyKey, 'session.idempotencyKey', { max: 256 });
  array(value.checkpoints, 'session.checkpoints', { max: 64 }).forEach((checkpoint, index) => {
    const path = `session.checkpoints[${index}]`; fields(checkpoint, ['sequence', 'state', 'reason', 'previousDigest', 'sessionDigest', 'createdAt'], ['sequence', 'state', 'reason', 'previousDigest', 'sessionDigest'], path);
    integer(checkpoint.sequence, `${path}.sequence`); enumeration(checkpoint.state, DELIVERY_SESSION_STATES, `${path}.state`); string(checkpoint.reason, `${path}.reason`, { max: 2048 }); digest(checkpoint.previousDigest, `${path}.previousDigest`, true); digest(checkpoint.sessionDigest, `${path}.sessionDigest`); timestamp(checkpoint.createdAt, `${path}.createdAt`);
  });
  fields(value.budgets, ['maxAgentTurns', 'maxCommands', 'maxChangedFiles', 'maxChangedBytes', 'maxElapsedMs', 'maxInputTokens', 'maxOutputTokens', 'maxCost'], ['maxAgentTurns', 'maxCommands', 'maxChangedFiles', 'maxChangedBytes', 'maxElapsedMs'], 'session.budgets');
  for (const key of ['maxAgentTurns', 'maxCommands', 'maxChangedFiles', 'maxChangedBytes', 'maxElapsedMs', 'maxInputTokens', 'maxOutputTokens']) if (value.budgets[key] !== undefined) integer(value.budgets[key], `session.budgets.${key}`, { min: 1 });
  if (value.budgets.maxCost !== undefined) number(value.budgets.maxCost, 'session.budgets.maxCost');
  if (value.requestText !== undefined) string(value.requestText, 'session.requestText', { max: 262144 });
  if (value.requirement !== undefined && value.requirement !== null) validateRequirementIr(value.requirement);
  if (value.architecture !== undefined && value.architecture !== null) validateArchitectureIr(value.architecture);
  for (const key of ['authority', 'repositorySnapshot', 'usage']) if (value[key] !== undefined) object(value[key], `session.${key}`);
  if (value.lastFailure !== undefined && value.lastFailure !== null) object(value.lastFailure, 'session.lastFailure');
  if (value.activeAgentId !== undefined && value.activeAgentId !== null) id(value.activeAgentId, 'session.activeAgentId');
  timestamp(value.createdAt, 'session.createdAt'); timestamp(value.updatedAt, 'session.updatedAt');
  return normalized(value);
}

export function canonicalContractDigest(kind, value) {
  const validators = {
    requirement: validateRequirementIr,
    architecture: validateArchitectureIr,
    evidence: validateEvidenceIr,
    completion: validateCompletionContract,
    session: validateDeliverySession,
  };
  if (!validators[kind]) fail('contract kind', `unsupported kind ${kind}`);
  return canonicalValueDigest(validators[kind](value), { omit: VOLATILE_KEYS });
}

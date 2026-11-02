import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest, isSafeRelative } from '../../shared/index.mjs';
import { packContractDigest, validateGoldenPathPack } from '../stack-packs/index.mjs';
import {
  canonicalContractDigest,
  validateArchitectureIr,
  validateRequirementIr,
} from './contracts.mjs';

export const RISK_PROFILE_SET_VERSION = 1;
export const RISK_PROFILE_APPLICABILITY = Object.freeze(['required', 'not-applicable', 'blocked']);

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
const MAX_TRIGGER_EVIDENCE_PER_SOURCE = 3;

// Every profile maps a material risk to the Pack-owned quality gates that own its evidence.
// `owner-dependent` profiles describe risks the Pack cannot verify yet: when the requirement makes
// them material they block completion until an owner names a supporting target and evidence provider.
const CATALOG = [
  {
    id: 'authentication', category: 'security', kind: 'supported', evidenceOwner: 'security',
    gateIds: ['security-probes', 'contract-tests'],
    triggers: { requirement: ['authenticat', 'sign in', 'sign-in', 'log in', 'login', 'credential', 'password', 'access token', 'session token'], repository: ['passport', 'jsonwebtoken', 'jose', '@nestjs/jwt', 'bcrypt', 'argon2', 'lucia'], architecture: ['transport'] },
  },
  {
    id: 'tenant-authorization', category: 'security', kind: 'supported', evidenceOwner: 'security',
    gateIds: ['security-probes', 'contract-tests'],
    triggers: { requirement: ['tenant', 'organization', 'organisation', 'authorization', 'authorisation', 'permission', 'role', 'workspace membership'], repository: [], architecture: [] },
  },
  {
    id: 'actor-input-validation', category: 'contracts', kind: 'supported', evidenceOwner: 'contracts',
    gateIds: ['contract-tests', 'unit-tests'],
    triggers: { requirement: ['input validation', 'validate', 'dto', 'contract validation'], repository: [], architecture: ['transport'] }, typedInputs: true,
  },
  {
    id: 'auditability', category: 'compliance', kind: 'supported', evidenceOwner: 'runtime',
    gateIds: ['runtime-observability', 'api-integration'],
    triggers: { requirement: ['audit', 'accountab', 'who changed', 'audit trail'], repository: [], architecture: [] },
  },
  {
    id: 'transaction-integrity', category: 'data', kind: 'supported', evidenceOwner: 'data',
    gateIds: ['migration-safety', 'api-integration'],
    triggers: { requirement: ['atomic', 'transaction', 'consistency', 'integrity'], repository: [], architecture: [] },
  },
  {
    id: 'concurrency', category: 'data', kind: 'supported', evidenceOwner: 'data',
    gateIds: ['migration-safety', 'api-integration'],
    triggers: { requirement: ['concurren', 'race condition', 'lost update', 'parallel write', 'optimistic lock'], repository: [], architecture: [] },
  },
  {
    id: 'accessibility', category: 'ux', kind: 'supported', evidenceOwner: 'ux',
    gateIds: ['browser-e2e'],
    triggers: { requirement: ['accessib', 'keyboard', 'screen reader', 'wcag', 'a11y', 'focus order'], repository: [], architecture: ['web-feature', 'ui-', 'frontend'] },
  },
  {
    id: 'latency-budget', category: 'performance', kind: 'supported', evidenceOwner: 'performance',
    gateIds: ['performance-budget'], budget: 'latency',
    triggers: { requirement: ['latency', 'response time', 'p95', 'p99', 'time to first byte'], repository: [], architecture: [] },
  },
  {
    id: 'throughput-budget', category: 'performance', kind: 'supported', evidenceOwner: 'performance',
    gateIds: ['performance-budget'], budget: 'throughput',
    triggers: { requirement: ['throughput', 'requests per second', ' qps', 'rps', 'sustained load'], repository: [], architecture: [] },
  },
  {
    id: 'bundle-budget', category: 'performance', kind: 'supported', evidenceOwner: 'performance',
    gateIds: ['performance-budget'], budget: 'frontend bundle',
    triggers: { requirement: ['bundle', 'payload size', 'javascript size', 'frontend size'], repository: [], architecture: ['web-feature', 'frontend'] },
  },
  {
    id: 'observability', category: 'runtime', kind: 'supported', evidenceOwner: 'runtime',
    gateIds: ['runtime-observability'],
    triggers: { requirement: ['observab', 'structured log', 'logs', 'metric', 'trace', 'health check', 'correlation', 'monitor'], repository: [], architecture: [] },
  },
  {
    id: 'resource-cleanup', category: 'runtime', kind: 'supported', evidenceOwner: 'runtime',
    gateIds: ['runtime-observability'],
    triggers: { requirement: ['cleanup', 'clean up', 'resource', 'timeout', 'time out', 'leak', 'graceful'], repository: [], architecture: [] },
  },
  {
    id: 'migration-safety', category: 'data', kind: 'supported', evidenceOwner: 'data',
    gateIds: ['migration-safety'],
    triggers: { requirement: ['migration', 'schema change', 'backfill'], repository: ['migration', 'migrate', 'drizzle'], architecture: [] },
  },
  {
    id: 'dependency-risk', category: 'security', kind: 'supported', evidenceOwner: 'security',
    gateIds: ['security-probes'],
    triggers: { requirement: ['dependenc', 'package upgrade', 'third-party', 'supply chain', 'advisory', 'sbom'], repository: [], architecture: [] },
  },
  {
    id: 'secret-risk', category: 'security', kind: 'supported', evidenceOwner: 'security',
    gateIds: ['security-probes'],
    triggers: { requirement: ['secret', 'api key', 'token storage', 'vault', 'credential storage', 'environment variable'], repository: ['.env', 'secret'], architecture: [] },
  },
  {
    id: 'privacy', category: 'privacy', kind: 'owner-dependent', evidenceOwner: 'owner', gateIds: [],
    triggers: { requirement: ['privacy', 'personal data', 'pii', 'gdpr', 'consent'], repository: [], architecture: [] },
  },
  {
    id: 'disaster-recovery', category: 'resilience', kind: 'owner-dependent', evidenceOwner: 'owner', gateIds: [],
    triggers: { requirement: ['disaster', 'recovery point', 'rpo', 'rto', 'backup restore'], repository: [], architecture: [] },
  },
  {
    id: 'residency', category: 'compliance', kind: 'owner-dependent', evidenceOwner: 'owner', gateIds: [],
    triggers: { requirement: ['residen', 'data region', 'data location', 'sovereignty'], repository: [], architecture: [] },
  },
  {
    id: 'high-availability', category: 'resilience', kind: 'owner-dependent', evidenceOwner: 'owner', gateIds: [],
    triggers: { requirement: ['high availability', 'failover', 'multi-region', 'uptime sla', 'redundan'], repository: [], architecture: [] },
  },
  {
    id: 'cloud-cost', category: 'cost', kind: 'owner-dependent', evidenceOwner: 'owner', gateIds: [],
    triggers: { requirement: ['cloud cost', 'cost budget', 'spend limit', 'infrastructure cost'], repository: [], architecture: [] },
  },
  {
    id: 'deployment', category: 'delivery', kind: 'owner-dependent', evidenceOwner: 'owner', gateIds: [],
    triggers: { requirement: ['production deploy', 'go-live', 'go live', 'release to production', 'deployment pipeline', 'deploy to production'], repository: [], architecture: [] },
  },
];

export const RISK_PROFILE_CATALOG = Object.freeze(CATALOG.map((entry) => Object.freeze({
  ...entry,
  gateIds: Object.freeze([...entry.gateIds]),
  triggers: Object.freeze(Object.fromEntries(Object.entries(entry.triggers).map(([source, values]) => [source, Object.freeze([...values])]))),
})));

const CATALOG_BY_ID = new Map(RISK_PROFILE_CATALOG.map((entry) => [entry.id, entry]));

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
function digest(value, path) { string(value, path, { max: 64, pattern: DIGEST }); }

function list(value, path, { min = 0, max = 256 } = {}) {
  if (!Array.isArray(value) || value.length < min || value.length > max) fail(path, `expected an array with ${min} to ${max} items`);
  return value;
}

function uniqueIds(entries, path) {
  const seen = new Set();
  entries.forEach((entry, index) => {
    id(entry.id, `${path}[${index}].id`);
    if (seen.has(entry.id)) fail(`${path}[${index}].id`, `duplicate ID ${entry.id}`);
    seen.add(entry.id);
  });
  return seen;
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

function requirementSources(requirement) {
  const sources = [
    { label: 'requirement.title', value: requirement.title },
    { label: 'requirement.summary', value: requirement.summary },
  ];
  requirement.actors.forEach((actor, index) => sources.push({ label: `requirement.actors[${index}]`, value: `${actor.name} ${actor.goals.join(' ')}` }));
  requirement.goals.forEach((goal, index) => sources.push({ label: `requirement.goals[${index}]`, value: goal.statement }));
  for (const name of ['scope', 'nonGoals', 'preconditions']) requirement[name].forEach((entry, index) => sources.push({ label: `requirement.${name}[${index}]`, value: entry }));
  requirement.businessRules.forEach((entry, index) => sources.push({ label: `requirement.businessRules[${index}]`, value: entry.statement }));
  requirement.stateTransitions.forEach((entry, index) => sources.push({ label: `requirement.stateTransitions[${index}]`, value: `${entry.from} ${entry.event} ${entry.to} ${entry.guard ?? ''}` }));
  for (const name of ['inputs', 'outputs']) requirement[name].forEach((entry, index) => sources.push({ label: `requirement.${name}[${index}]`, value: `${entry.name} ${entry.type} ${entry.rules.join(' ')}` }));
  requirement.failures.forEach((entry, index) => sources.push({ label: `requirement.failures[${index}]`, value: `${entry.condition} ${entry.outcome}` }));
  requirement.permissions.forEach((entry, index) => sources.push({ label: `requirement.permissions[${index}]`, value: `${entry.action} ${entry.effect} ${entry.condition ?? ''}` }));
  requirement.dataLifecycle.forEach((entry, index) => sources.push({ label: `requirement.dataLifecycle[${index}]`, value: `${entry.data} ${entry.retention} ${entry.deletion}` }));
  requirement.nfrs.forEach((entry, index) => sources.push({ label: `requirement.nfrs[${index}]`, value: `${entry.category} ${entry.requirement}` }));
  sources.push({ label: 'requirement.rollout', value: `${requirement.rollout.strategy} ${requirement.rollout.safeguards.join(' ')}` });
  sources.push({ label: 'requirement.rollback', value: `${requirement.rollback.trigger} ${requirement.rollback.action}` });
  requirement.acceptanceScenarios.forEach((entry, index) => sources.push({ label: `requirement.acceptanceScenarios[${index}]`, value: `${entry.when} ${entry.then.join(' ')}` }));
  requirement.assumptions.forEach((entry, index) => sources.push({ label: `requirement.assumptions[${index}]`, value: entry.statement }));
  requirement.openQuestions.forEach((entry, index) => sources.push({ label: `requirement.openQuestions[${index}]`, value: entry.question }));
  return sources;
}

function architectureSources(architecture) {
  if (!architecture) return [];
  const sources = [];
  architecture.modules.forEach((module, index) => {
    sources.push({ label: `architecture.modules[${index}].id`, value: module.id });
    sources.push({ label: `architecture.modules[${index}].name`, value: `${module.name} ${module.owns.join(' ')}` });
  });
  architecture.compositionRoots.forEach((root, index) => sources.push({ label: `architecture.compositionRoots[${index}]`, value: root.path }));
  return sources;
}

function repositorySources(repositoryFacts) {
  const sources = [];
  repositoryFacts.paths.forEach((entry, index) => sources.push({ label: `repository.paths[${index}]`, value: entry }));
  repositoryFacts.packages.forEach((entry, index) => sources.push({ label: `repository.packages[${index}]`, value: entry }));
  return sources;
}

function matchingSources(profile, sourceKind, sources) {
  const keywords = profile.triggers[sourceKind];
  const matched = [];
  let perSource = 0;
  for (const source of sources) {
    const lower = source.value.toLowerCase();
    if (!keywords.some((keyword) => lower.includes(keyword))) continue;
    if (perSource >= MAX_TRIGGER_EVIDENCE_PER_SOURCE) break;
    matched.push({ source: source.source, detail: `${source.label}: ${source.value}`.slice(0, 512) });
    perSource += 1;
  }
  return matched;
}

function collectTriggers(profile, requirement, architecture, repositoryFacts) {
  const evidenced = [
    ...matchingSources(profile, 'requirement', requirementSources(requirement).map((entry) => ({ ...entry, source: 'requirement' }))),
    ...matchingSources(profile, 'architecture', architectureSources(architecture).map((entry) => ({ ...entry, source: 'architecture' }))),
    ...matchingSources(profile, 'repository', repositorySources(repositoryFacts).map((entry) => ({ ...entry, source: 'repository' }))),
  ];
  if (profile.typedInputs && requirement.inputs.length > 0 && !evidenced.some((entry) => entry.source === 'requirement')) {
    evidenced.unshift({ source: 'requirement', detail: `requirement.inputs[0]: ${requirement.inputs[0].name}`.slice(0, 512) });
  }
  return evidenced;
}

function budgetSupplied(budgetProfile, requirement) {
  // A requirement-supplied numeric budget satisfies the profile; the Pack contract does not yet
  // declare numeric baselines, so an absent requirement budget stays blocked with an owner question.
  return requirementSources(requirement).some((source) => {
    const lower = source.value.toLowerCase();
    if (!budgetProfile.triggers.requirement.some((keyword) => lower.includes(keyword))) return false;
    return /\d/.test(source.value);
  });
}

function validateRepositoryFacts(value) {
  fields(value, ['paths', 'packages'], ['paths', 'packages'], 'repositoryFacts');
  list(value.paths, 'repositoryFacts.paths', { max: 4096 }).forEach((entry, index) => {
    string(entry, `repositoryFacts.paths[${index}]`, { max: 1024 });
    if (!isSafeRelative(entry)) fail(`repositoryFacts.paths[${index}]`, 'expected a safe repository-relative path');
  });
  list(value.packages, 'repositoryFacts.packages', { max: 4096 }).forEach((entry, index) => string(entry, `repositoryFacts.packages[${index}]`, { max: 214 }));
  return value;
}

export function activateRiskProfiles(input) {
  fields(input, ['requirement', 'architecture', 'repositoryFacts', 'pack'], ['requirement', 'architecture', 'repositoryFacts', 'pack'], 'riskActivation');
  const requirement = validateRequirementIr(input.requirement);
  const pack = validateGoldenPathPack(input.pack);
  const repositoryFacts = validateRepositoryFacts(input.repositoryFacts);
  const architecture = input.architecture === null || input.architecture === undefined ? null : validateArchitectureIr(input.architecture);
  const requirementDigest = canonicalContractDigest('requirement', requirement);
  if (architecture && architecture.requirementDigest !== requirementDigest) fail('riskActivation.architecture', 'architecture is bound to a different requirement digest');

  const gateIds = new Set(pack.qualityMatrix.gates.map((gate) => gate.id));
  const profiles = [];
  const ownerQuestions = [];
  const activated = new Set();

  for (const entry of RISK_PROFILE_CATALOG) {
    const triggerEvidence = collectTriggers(entry, requirement, architecture, repositoryFacts);
    const decisionId = `risk.${entry.id}`;
    if (triggerEvidence.length === 0) {
      profiles.push({ id: entry.id, category: entry.category, kind: entry.kind, applicability: 'not-applicable', decisionId, gateIds: [], evidenceOwner: entry.evidenceOwner, triggerEvidence: [], reason: `no requirement, repository, or architecture evidence activates ${entry.id}` });
      continue;
    }
    if (entry.kind === 'owner-dependent') {
      profiles.push({ id: entry.id, category: entry.category, kind: entry.kind, applicability: 'blocked', decisionId, gateIds: [], evidenceOwner: entry.evidenceOwner, triggerEvidence, reason: `${entry.id} is material but this Pack and environment declare no supported target or evidence provider; owner decision required` });
      ownerQuestions.push({ id: `question.${decisionId}`, profileId: entry.id, question: `Confirm whether ${entry.id} applies and name the supporting target and evidence provider.`, material: true });
      continue;
    }
    const ownedGates = entry.gateIds.filter((gate) => gateIds.has(gate));
    if (ownedGates.length === 0) {
      profiles.push({ id: entry.id, category: entry.category, kind: entry.kind, applicability: 'blocked', decisionId, gateIds: [], evidenceOwner: entry.evidenceOwner, triggerEvidence, reason: `the Pack declares no quality gate for ${entry.id}` });
      continue;
    }
    if (entry.budget && !budgetSupplied(entry, requirement)) {
      profiles.push({ id: entry.id, category: entry.category, kind: entry.kind, applicability: 'blocked', decisionId, gateIds: ownedGates, evidenceOwner: entry.evidenceOwner, triggerEvidence, reason: `the ${entry.budget} budget is missing from the requirement and the Pack declares no safe baseline` });
      ownerQuestions.push({ id: `question.${decisionId}`, profileId: entry.id, question: `Provide the ${entry.budget} budget, or approve a Pack baseline for ${entry.id}.`, material: true });
      continue;
    }
    profiles.push({ id: entry.id, category: entry.category, kind: entry.kind, applicability: 'required', decisionId, gateIds: ownedGates, evidenceOwner: entry.evidenceOwner, triggerEvidence, reason: null });
    activated.add(entry.id);
  }

  const requiredGateIds = pack.qualityMatrix.gates
    .filter((gate) => (gate.applicability === 'always' && gate.required)
      || RISK_PROFILE_CATALOG.some((entry) => activated.has(entry.id) && entry.gateIds.includes(gate.id)))
    .map((gate) => gate.id);

  return validateRiskProfileSet({
    schemaVersion: RISK_PROFILE_SET_VERSION,
    requirementDigest,
    packDigest: packContractDigest(pack),
    profiles,
    requiredGateIds,
    ownerQuestions,
  });
}

export function validateRiskProfileSet(value) {
  const allowed = ['schemaVersion', 'requirementDigest', 'packDigest', 'profiles', 'requiredGateIds', 'ownerQuestions'];
  fields(value, allowed, allowed, 'riskProfileSet');
  if (value.schemaVersion !== RISK_PROFILE_SET_VERSION) fail('riskProfileSet.schemaVersion', `unsupported version ${value.schemaVersion}`);
  digest(value.requirementDigest, 'riskProfileSet.requirementDigest');
  digest(value.packDigest, 'riskProfileSet.packDigest');
  list(value.profiles, 'riskProfileSet.profiles', { min: 1, max: 64 }).forEach((profile, index) => {
    const path = `riskProfileSet.profiles[${index}]`;
    fields(profile, ['id', 'category', 'kind', 'applicability', 'decisionId', 'gateIds', 'evidenceOwner', 'triggerEvidence', 'reason'], ['id', 'category', 'kind', 'applicability', 'decisionId', 'gateIds', 'evidenceOwner', 'triggerEvidence', 'reason'], path);
    id(profile.id, `${path}.id`);
    const entry = CATALOG_BY_ID.get(profile.id);
    if (!entry) fail(`${path}.id`, `unknown risk profile ${profile.id}`);
    if (profile.category !== entry.category) fail(`${path}.category`, 'does not match the catalog category');
    if (profile.kind !== entry.kind) fail(`${path}.kind`, 'does not match the catalog kind');
    if (profile.decisionId !== `risk.${entry.id}`) fail(`${path}.decisionId`, 'does not match the catalog decision ID');
    if (profile.evidenceOwner !== entry.evidenceOwner) fail(`${path}.evidenceOwner`, 'does not match the catalog evidence owner');
    if (!RISK_PROFILE_APPLICABILITY.includes(profile.applicability)) fail(`${path}.applicability`, 'unsupported applicability');
    const gates = list(profile.gateIds, `${path}.gateIds`, { max: 16 });
    const seenGates = new Set();
    gates.forEach((gate, gateIndex) => {
      id(gate, `${path}.gateIds[${gateIndex}]`);
      if (seenGates.has(gate)) fail(`${path}.gateIds[${gateIndex}]`, `duplicate gate ${gate}`);
      if (!entry.gateIds.includes(gate)) fail(`${path}.gateIds[${gateIndex}]`, `gate ${gate} is not owned by ${entry.id}`);
      seenGates.add(gate);
    });
    list(profile.triggerEvidence, `${path}.triggerEvidence`, { max: 16 }).forEach((evidence, evidenceIndex) => {
      const evidencePath = `${path}.triggerEvidence[${evidenceIndex}]`;
      fields(evidence, ['source', 'detail'], ['source', 'detail'], evidencePath);
      if (!['requirement', 'architecture', 'repository'].includes(evidence.source)) fail(`${evidencePath}.source`, 'unsupported trigger source');
      string(evidence.detail, `${evidencePath}.detail`, { max: 512 });
    });
    if (profile.applicability === 'required') {
      if (gates.length === 0) fail(`${path}.gateIds`, 'a required profile must own at least one quality gate');
      if (profile.reason !== null) fail(`${path}.reason`, 'a required profile must not carry a reason');
      if (profile.triggerEvidence.length === 0) fail(`${path}.triggerEvidence`, 'a required profile must record trigger evidence');
    } else {
      string(profile.reason, `${path}.reason`, { max: 4096 });
      if (profile.applicability === 'not-applicable' && gates.length > 0) fail(`${path}.gateIds`, 'a not-applicable profile must not declare gates');
      if (profile.applicability === 'not-applicable' && profile.triggerEvidence.length > 0) fail(`${path}.triggerEvidence`, 'a not-applicable profile must not record trigger evidence');
    }
  });
  uniqueIds(value.profiles, 'riskProfileSet.profiles');
  list(value.requiredGateIds, 'riskProfileSet.requiredGateIds', { min: 1, max: 256 }).forEach((gate, index) => id(gate, `riskProfileSet.requiredGateIds[${index}]`));
  const requiredGateIds = new Set(value.requiredGateIds);
  if (requiredGateIds.size !== value.requiredGateIds.length) fail('riskProfileSet.requiredGateIds', 'duplicate gate');
  for (const profile of value.profiles) {
    if (profile.applicability !== 'required') continue;
    for (const gateId of profile.gateIds) if (!requiredGateIds.has(gateId)) fail('riskProfileSet.requiredGateIds', `required profile ${profile.id} omits gate ${gateId}`);
  }
  list(value.ownerQuestions, 'riskProfileSet.ownerQuestions', { max: 64 }).forEach((question, index) => {
    const path = `riskProfileSet.ownerQuestions[${index}]`;
    fields(question, ['id', 'profileId', 'question', 'material'], ['id', 'profileId', 'question', 'material'], path);
    id(question.id, `${path}.id`);
    id(question.profileId, `${path}.profileId`);
    if (!CATALOG_BY_ID.has(question.profileId)) fail(`${path}.profileId`, `unknown risk profile ${question.profileId}`);
    string(question.question, `${path}.question`, { max: 4096 });
    if (question.material !== true) fail(`${path}.material`, 'owner questions must be material');
  });
  uniqueIds(value.ownerQuestions, 'riskProfileSet.ownerQuestions');
  return normalized(value);
}

export function riskProfileSetDigest(value) {
  return canonicalValueDigest(validateRiskProfileSet(value));
}

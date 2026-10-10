import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  RISK_PROFILE_CATALOG,
  RISK_PROFILE_SET_VERSION,
  activateRiskProfiles,
  validateRiskProfileSet,
} from '../src/modules/delivery-core/index.mjs';
import { loadGoldenPathPack } from '../src/modules/stack-packs/index.mjs';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = 'a'.repeat(64);
const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');

const ALWAYS_GATES = pack.qualityMatrix.gates.filter((gate) => gate.applicability === 'always').map((gate) => gate.id);
const ALL_GATES = pack.qualityMatrix.gates.map((gate) => gate.id);

function requirement(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'requirement.member-profile',
    title: 'Member profile management',
    summary: 'A signed-in member maintains their profile inside one tenant.',
    actors: [{ id: 'actor.member', name: 'Member', goals: ['Sign in and maintain the profile'] }],
    goals: [{ id: 'goal.profile', actorId: 'actor.member', statement: 'Keep the profile current' }],
    scope: ['Member profile maintenance'],
    nonGoals: ['Tenant administration'],
    preconditions: ['The member is authenticated'],
    businessRules: [
      { id: 'rule.tenant', statement: 'A member may only read or write records of their own tenant.' },
      { id: 'rule.audit', statement: 'Every successful write is audited with the acting member identity.' },
      { id: 'rule.atomic', statement: 'Each write is atomic across the profile and audit records.' },
    ],
    stateTransitions: [{ id: 'transition.save', from: 'idle', event: 'save', to: 'persisted' }],
    inputs: [{ id: 'input.displayName', name: 'displayName', type: 'string', required: true, rules: ['Validated against the published contract'] }],
    outputs: [{ id: 'output.profile', name: 'profile', type: 'object', rules: ['Only tenant-owned fields'] }],
    failures: [{ id: 'failure.concurrent', condition: 'Concurrent writes target the same profile', outcome: 'Reject the stale update' }],
    permissions: [{ id: 'permission.update', actorId: 'actor.member', action: 'member.profile.update', effect: 'allow', condition: 'The record tenant matches the actor tenant' }],
    dataLifecycle: [{ id: 'data.profile', data: 'Member profile', retention: 'Until account deletion', deletion: 'Hard delete on request' }],
    nfrs: [
      { id: 'nfr.latency', category: 'performance', requirement: 'API p95 latency stays under 250 ms' },
      { id: 'nfr.throughput', category: 'performance', requirement: 'Sustain 200 requests per second' },
      { id: 'nfr.bundle', category: 'performance', requirement: 'Keep the frontend bundle under 300 KB' },
      { id: 'nfr.observability', category: 'observability', requirement: 'Emit structured logs with request correlation and a health check' },
      { id: 'nfr.cleanup', category: 'reliability', requirement: 'Release connection resources and time out idle requests gracefully' },
      { id: 'nfr.accessibility', category: 'accessibility', requirement: 'Keyboard focus and screen reader support for the member form' },
      { id: 'nfr.migration', category: 'data', requirement: 'Apply the schema migration with a clean forward recovery path' },
      { id: 'nfr.dependency', category: 'security', requirement: 'Fail the build on vulnerable dependency advisories' },
      { id: 'nfr.secret', category: 'security', requirement: 'Load secrets from the environment and never from source control' },
    ],
    rollout: { strategy: 'incremental', safeguards: ['Feature flag'] },
    rollback: { trigger: 'Error budget exceeded', action: 'Disable the flag' },
    acceptanceScenarios: [{ id: 'acceptance.save', given: ['An authenticated member'], when: 'The member saves the profile', then: ['The profile is updated', 'An audit record is written'] }],
    assumptions: [],
    openQuestions: [],
    ownerDecisions: [],
    sourceEvidence: [{ id: 'source.request', source: 'operator-request', level: 'stated', digest: hash }],
    ...overrides,
  };
}

function minimalRequirement(overrides = {}) {
  return requirement({
    id: 'requirement.catalog-search',
    title: 'Catalog search',
    summary: 'A visitor searches the catalog.',
    actors: [{ id: 'actor.visitor', name: 'Visitor', goals: ['Find an item'] }],
    goals: [{ id: 'goal.search', actorId: 'actor.visitor', statement: 'Find matching items' }],
    scope: ['Catalog search'],
    nonGoals: ['Catalog administration'],
    preconditions: ['The catalog is reachable'],
    businessRules: [{ id: 'rule.query', statement: 'Ignore empty queries' }],
    stateTransitions: [],
    inputs: [],
    outputs: [],
    failures: [{ id: 'failure.catalog', condition: 'The catalog is unavailable', outcome: 'Return a retriable error' }],
    permissions: [{ id: 'permission.search', actorId: 'actor.visitor', action: 'catalog.search', effect: 'allow' }],
    dataLifecycle: [{ id: 'data.query', data: 'Query text', retention: 'Not retained', deletion: 'Discard after the response' }],
    nfrs: [{ id: 'nfr.plain', category: 'usability', requirement: 'Results appear without a manual refresh' }],
    acceptanceScenarios: [{ id: 'acceptance.search', given: ['A visible item'], when: 'A query is submitted', then: ['The item is returned'] }],
    ...overrides,
  });
}

function architecture(requirementDigest, overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'architecture.member-profile',
    requirementDigest,
    modules: [
      { id: 'web-feature', name: 'Web feature', owns: ['apps/web/src/features'] },
      { id: 'api-transport', name: 'API transport', owns: ['apps/api/src/transport'] },
      { id: 'api-domain', name: 'API domain', owns: ['apps/api/src/domain'] },
    ],
    publicContracts: [],
    dependencies: [],
    compositionRoots: [{ id: 'root.web', path: 'apps/web/src/main.tsx', modules: ['web-feature'] }],
    decisions: [],
    constraints: [],
    risks: [],
    evidenceGaps: [],
    ...overrides,
  };
}

function activate(overrides = {}) {
  const value = requirement(overrides.requirement);
  const input = {
    requirement: value,
    architecture: overrides.architecture === undefined ? null : overrides.architecture,
    repositoryFacts: overrides.repositoryFacts ?? { paths: [], packages: [] },
    pack: overrides.pack ?? pack,
  };
  return { value, result: activateRiskProfiles(input) };
}

test('the risk profile set is explicit, closed, and deterministic', () => {
  assert.equal(RISK_PROFILE_SET_VERSION, 1);
  assert.ok(Object.isFrozen(RISK_PROFILE_CATALOG));
  const { value, result } = activate();
  assert.equal(result.schemaVersion, 1);
  assert.match(result.requirementDigest, /^[a-f0-9]{64}$/);
  assert.match(result.packDigest, /^[a-f0-9]{64}$/);
  assert.notEqual(result.requirementDigest, activate({ requirement: { title: 'Member profile maintenance' } }).result.requirementDigest);
  assert.deepEqual(activate().result, result);
  assert.ok(Object.isFrozen(result));
  assert.ok(Object.isFrozen(result.profiles));
  const schema = JSON.parse(fs.readFileSync(path.join(root, 'assets/contracts/risk-profile-set-v1-schema.json'), 'utf8'));
  assert.equal(schema.$schema, 'https://json-schema.org/draft/2020-12/schema');
  assert.equal(schema.additionalProperties, false);
});

test('every supported spec risk activates from typed requirement evidence and maps to Pack gates', () => {
  const { result } = activate();
  const supported = ['authentication', 'tenant-authorization', 'actor-input-validation', 'auditability', 'transaction-integrity', 'concurrency', 'accessibility', 'latency-budget', 'throughput-budget', 'bundle-budget', 'observability', 'resource-cleanup', 'migration-safety', 'dependency-risk', 'secret-risk'];
  const byId = new Map(result.profiles.map((profile) => [profile.id, profile]));
  for (const id of supported) {
    const profile = byId.get(id);
    assert.equal(profile.applicability, 'required', id);
    assert.ok(profile.gateIds.length >= 1, id);
    assert.equal(profile.reason, null, id);
    assert.match(profile.decisionId, /^risk./);
    assert.ok(profile.evidenceOwner.length > 0, id);
    assert.ok(profile.triggerEvidence.length >= 1, id);
  }
  assert.deepEqual(result.requiredGateIds, ALL_GATES);
  for (const profile of result.profiles) for (const gateId of profile.gateIds) assert.ok(ALL_GATES.includes(gateId), gateId);
});

test('risks without requirement or repository evidence stay not applicable with a reason', () => {
  const result = activateRiskProfiles({ requirement: minimalRequirement(), architecture: null, repositoryFacts: { paths: [], packages: [] }, pack });
  for (const profile of result.profiles) {
    assert.equal(profile.applicability, 'not-applicable', profile.id);
    assert.ok(profile.reason.length > 0, profile.id);
    assert.deepEqual(profile.gateIds, [], profile.id);
  }
  assert.deepEqual(result.requiredGateIds, ALWAYS_GATES);
  assert.deepEqual(result.ownerQuestions, []);
});

test('repository and architecture evidence activate the matching profiles', () => {
  const minimal = minimalRequirement();
  const requirementDigest = activateRiskProfiles({ requirement: minimal, architecture: null, repositoryFacts: { paths: [], packages: [] }, pack }).requirementDigest;
  const result = activateRiskProfiles({
    requirement: minimal,
    architecture: architecture(requirementDigest),
    repositoryFacts: { paths: ['drizzle/migrations/0001_init.sql', '.env.example'], packages: ['@nestjs/jwt', 'drizzle-orm'] },
    pack,
  });
  const byId = new Map(result.profiles.map((profile) => [profile.id, profile]));
  for (const id of ['migration-safety', 'secret-risk', 'authentication', 'actor-input-validation', 'accessibility']) assert.equal(byId.get(id).applicability, 'required', id);
  assert.ok(byId.get('migration-safety').triggerEvidence.some((entry) => entry.source === 'repository'));
  assert.ok(byId.get('bundle-budget').triggerEvidence.some((entry) => entry.source === 'architecture'));
  assert.equal(byId.get('bundle-budget').applicability, 'blocked');
  assert.deepEqual(result.ownerQuestions.map((question) => question.id), ['question.risk.bundle-budget']);
});

test('a missing requirement budget asks the owner and blocks the profile; a supplied budget does not', () => {
  const { result } = activate({ requirement: { nfrs: [{ id: 'nfr.latency', category: 'performance', requirement: 'Meet the API latency budget' }] } });
  const latency = result.profiles.find((profile) => profile.id === 'latency-budget');
  assert.equal(latency.applicability, 'blocked');
  assert.match(latency.reason, /budget/i);
  assert.deepEqual(result.ownerQuestions.map((question) => question.id), ['question.risk.latency-budget']);
  assert.equal(result.ownerQuestions[0].material, true);

  const supplied = activate({ requirement: { nfrs: [{ id: 'nfr.latency', category: 'performance', requirement: 'Keep API p95 latency under 400 ms' }] } });
  assert.equal(supplied.result.profiles.find((profile) => profile.id === 'latency-budget').applicability, 'required');
  assert.deepEqual(supplied.result.ownerQuestions, []);
});

test('material but unsupported risks stay blocked with an owner question', () => {
  const { result } = activate({ requirement: {
    summary: 'A signed-in member maintains their profile inside one tenant with regulated personal data.',
    nfrs: [{ id: 'nfr.privacy', category: 'privacy', requirement: 'Keep personal data private and resident in one region with disaster recovery' }],
    businessRules: [
      { id: 'rule.tenant', statement: 'A member may only read or write records of their own tenant.' },
      { id: 'rule.audit', statement: 'Every successful write is audited with the acting member identity.' },
    ],
  } });
  const blocked = result.profiles.filter((profile) => profile.applicability === 'blocked' && profile.reason.includes('owner'));
  assert.ok(blocked.some((profile) => profile.id === 'privacy'));
  for (const profile of blocked) assert.ok(result.ownerQuestions.some((question) => question.profileId === profile.id), profile.id);
});

test('a Pack without the owning gate fails closed for the activated risk', () => {
  const traceability = pack.qualityMatrix.gates.find((gate) => gate.id === 'requirement-traceability');
  const minimalPack = { ...pack, qualityMatrix: { schemaVersion: 1, id: 'quality.minimal', gates: [traceability] } };
  const { result } = activate({ pack: minimalPack });
  const authentication = result.profiles.find((profile) => profile.id === 'authentication');
  assert.equal(authentication.applicability, 'blocked');
  assert.match(authentication.reason, /gate/i);
  assert.deepEqual(authentication.gateIds, []);
  assert.deepEqual(result.requiredGateIds, ['requirement-traceability']);
});

test('an architecture bound to a different requirement digest is rejected', () => {
  assert.throws(() => activateRiskProfiles({
    requirement: requirement(),
    architecture: architecture(hash),
    repositoryFacts: { paths: [], packages: [] },
    pack,
  }), /requirement digest/i);
});

test('the risk profile set validator rejects unknown fields, duplicates, and unjustified states', () => {
  const result = activate().result;
  assert.throws(() => validateRiskProfileSet({ ...result, extra: true }), /riskProfileSet.extra/);
  assert.throws(() => validateRiskProfileSet({ ...result, schemaVersion: 2 }), /riskProfileSet.schemaVersion/);
  assert.throws(() => validateRiskProfileSet({ ...result, profiles: [...result.profiles, result.profiles[0]] }), /duplicate/i);
  const required = result.profiles.find((profile) => profile.applicability === 'required');
  assert.throws(() => validateRiskProfileSet({ ...result, profiles: result.profiles.map((profile) => profile === required ? { ...profile, gateIds: [] } : profile) }), /gateIds/);
  assert.throws(() => validateRiskProfileSet({ ...result, profiles: result.profiles.map((profile) => profile === required ? { ...profile, reason: 'unjustified' } : profile) }), /reason/);
  assert.throws(() => validateRiskProfileSet({ ...result, profiles: result.profiles.map((profile) => profile === required ? { ...profile, applicability: 'not-applicable' } : profile) }), /reason/);
  assert.throws(() => validateRiskProfileSet({ ...result, ownerQuestions: [{ id: 'question.risk.x', profileId: required.id, question: 'Why?', material: false }] }), /material/);
  assert.throws(() => validateRiskProfileSet({ ...result, requirementDigest: 'not-a-digest' }), /requirementDigest/);
});

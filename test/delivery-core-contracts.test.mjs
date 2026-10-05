import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import {
  ARCHITECTURE_IR_VERSION,
  COMPLETION_CONTRACT_VERSION,
  DELIVERY_SESSION_STATES,
  DELIVERY_SESSION_VERSION,
  EVIDENCE_IR_VERSION,
  REQUIREMENT_IR_VERSION,
  canonicalContractDigest,
  validateArchitectureIr,
  validateCompletionContract,
  validateDeliverySession,
  validateEvidenceIr,
  validateRequirementIr,
} from '../src/modules/delivery-core/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const hash = 'a'.repeat(64);

function requirement(overrides = {}) {
  return {
    schemaVersion: 2,
    id: 'requirement.checkout',
    title: 'Complete checkout',
    summary: 'A signed-in buyer can submit an order.',
    actors: [{ id: 'actor.buyer', name: 'Buyer', goals: ['Submit an order'] }],
    goals: [{ id: 'goal.checkout', actorId: 'actor.buyer', statement: 'Submit a valid order' }],
    scope: ['Checkout submission'],
    nonGoals: ['Payment settlement'],
    preconditions: ['The buyer is authenticated'],
    businessRules: [{ id: 'rule.stock', statement: 'Every item must be available' }],
    stateTransitions: [{ id: 'transition.submit', from: 'draft', event: 'submit', to: 'submitted' }],
    inputs: [{ id: 'input.order', name: 'order', type: 'object', required: true, rules: ['At least one item'] }],
    outputs: [{ id: 'output.order', name: 'order', type: 'object', rules: ['Includes a stable identifier'] }],
    failures: [{ id: 'failure.stock', condition: 'An item is unavailable', outcome: 'Reject without creating an order' }],
    permissions: [{ id: 'permission.submit', actorId: 'actor.buyer', action: 'checkout.submit', effect: 'allow' }],
    dataLifecycle: [{ id: 'data.order', data: 'Order', retention: 'Project policy', deletion: 'Project policy' }],
    nfrs: [{ id: 'nfr.latency', category: 'performance', requirement: 'Complete within the approved service budget' }],
    rollout: { strategy: 'incremental', safeguards: ['Feature flag'] },
    rollback: { trigger: 'Error budget exceeded', action: 'Disable the feature flag' },
    acceptanceScenarios: [{ id: 'acceptance.checkout', given: ['A valid cart'], when: 'The buyer submits', then: ['One order is created'] }],
    assumptions: [{ id: 'assumption.inventory', statement: 'Inventory is authoritative', status: 'stated' }],
    openQuestions: [],
    ownerDecisions: [{ id: 'decision.scope', questionId: null, decision: 'Settlement is out of scope', status: 'approved' }],
    sourceEvidence: [{ id: 'source.request', source: 'operator-request', level: 'stated', digest: hash }],
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

function architecture(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'architecture.checkout',
    requirementDigest: canonicalContractDigest('requirement', requirement()),
    modules: [{ id: 'module.checkout', name: 'Checkout', owns: ['src/checkout/'] }],
    publicContracts: [{ id: 'contract.checkout', moduleId: 'module.checkout', kind: 'function', name: 'submitOrder' }],
    dependencies: [{ from: 'module.checkout', to: 'external.inventory', direction: 'outbound' }],
    compositionRoots: [{ id: 'composition.app', path: 'src/app.mjs', modules: ['module.checkout'] }],
    decisions: [{ id: 'architecture.decision.transaction', statement: 'The service owns transaction boundaries', status: 'approved' }],
    constraints: [{ id: 'constraint.no-shell', statement: 'Verification remains shell-free', level: 'enforced' }],
    risks: [{ id: 'risk.inventory', statement: 'Inventory can change concurrently', mitigation: 'Validate on submit' }],
    evidenceGaps: [],
    createdAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

function evidence(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'evidence.checkout-test',
    sessionId: 'session.checkout',
    source: 'automated-test',
    verificationLevel: 'verified',
    semanticDigest: canonicalContractDigest('requirement', requirement()),
    repositoryDigest: hash,
    commandDigest: hash,
    resultDigest: hash,
    artifactDigests: [{ path: 'reports/checkout.json', digest: hash }],
    status: 'passed',
    recordedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

function completion(overrides = {}) {
  const stages = ['governance', 'requirements', 'architecture', 'implementation', 'automated-verification', 'independent-review', 'human-acceptance', 'deployability', 'deployment'];
  return {
    schemaVersion: 1,
    sessionId: 'session.checkout',
    profile: 'production',
    requiredStages: stages,
    gates: stages.map((id) => ({ id, applicability: 'applicable', status: 'passed', evidenceIds: ['evidence.checkout-test'], reason: null })),
    residualGaps: [],
    implementation: 'complete',
    verification: 'verified',
    acceptance: 'accepted',
    deployability: 'ready',
    deployment: 'not-deployed',
    overall: 'complete',
    evaluatedAt: '2026-10-05T00:00:00.000Z',
    ...overrides,
  };
}

function session(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'session.checkout',
    state: 'requirements-approved',
    sequence: 1,
    requestDigest: hash,
    requirementDigest: canonicalContractDigest('requirement', requirement()),
    architectureDigest: null,
    authorityDigest: hash,
    repositoryDigest: hash,
    previousDigest: hash,
    idempotencyKey: 'approve-requirements-1',
    checkpoints: [],
    budgets: { maxAgentTurns: 4, maxCommands: 8, maxChangedFiles: 12, maxChangedBytes: 65536, maxElapsedMs: 60000 },
    createdAt: '2026-10-05T00:00:00.000Z',
    updatedAt: '2026-10-05T00:01:00.000Z',
    ...overrides,
  };
}

test('contract versions, states, and JSON Schema assets are explicit', () => {
  assert.equal(REQUIREMENT_IR_VERSION, 2);
  assert.equal(ARCHITECTURE_IR_VERSION, 1);
  assert.equal(EVIDENCE_IR_VERSION, 1);
  assert.equal(COMPLETION_CONTRACT_VERSION, 1);
  assert.equal(DELIVERY_SESSION_VERSION, 1);
  assert.ok(DELIVERY_SESSION_STATES.includes('repairing'));
  assert.ok(Object.isFrozen(DELIVERY_SESSION_STATES));
  for (const file of ['requirement-ir-v2-schema.json', 'architecture-ir-v1-schema.json', 'evidence-ir-v1-schema.json', 'completion-contract-v1-schema.json', 'delivery-session-v1-schema.json']) {
    const schema = JSON.parse(fs.readFileSync(path.join(root, 'assets/contracts', file), 'utf8'));
    assert.equal(schema.additionalProperties, false, file);
    assert.ok(schema.$schema?.includes('json-schema'), file);
  }
});

test('valid complete contracts normalize into deeply frozen values', () => {
  const values = [
    validateRequirementIr(requirement()),
    validateArchitectureIr(architecture()),
    validateEvidenceIr(evidence()),
    validateCompletionContract(completion()),
    validateDeliverySession(session()),
  ];
  for (const value of values) {
    assert.ok(Object.isFrozen(value));
    assert.ok(Object.isFrozen(Object.values(value).find(Array.isArray)));
  }
});

test('unknown fields, unsupported versions, duplicate IDs, and unsafe paths fail closed', () => {
  assert.throws(() => validateRequirementIr(requirement({ unexpected: true })), /requirement\.unexpected/);
  assert.throws(() => validateRequirementIr(requirement({ schemaVersion: 3 })), /requirement\.schemaVersion/);
  assert.throws(() => validateRequirementIr(requirement({ businessRules: [requirement().businessRules[0], requirement().businessRules[0]] })), /duplicate.*rule\.stock/i);
  assert.throws(() => validateArchitectureIr(architecture({ modules: [{ id: 'module.checkout', name: 'Checkout', owns: ['../secrets'] }] })), /architecture\.modules\[0\]\.owns\[0\]/);
  assert.throws(() => validateEvidenceIr(evidence({ artifactDigests: [{ path: '/tmp/report.json', digest: hash }] })), /evidence\.artifactDigests\[0\]\.path/);
});

test('material open questions and invalid state bindings are rejected', () => {
  assert.throws(() => validateRequirementIr(requirement({ openQuestions: [{ id: 'question.money', question: 'Who authorizes refunds?', material: true, status: 'open' }] })), /material open question/);
  assert.throws(() => validateRequirementIr(requirement({ stateTransitions: [{ id: 'transition.loop', from: 'draft', event: 'submit', to: 'draft' }] })), /state transition/);
  assert.throws(() => validateArchitectureIr(architecture({ requirementDigest: 'not-a-digest' })), /architecture\.requirementDigest/);
  assert.throws(() => validateDeliverySession(session({ state: 'unknown' })), /session\.state/);
});

test('production completion requires explicit, passing applicable gates and justified N/A gates', () => {
  const missing = completion({ gates: completion().gates.slice(1) });
  assert.throws(() => validateCompletionContract(missing), /required stage governance/);
  const unjustified = completion({ gates: completion().gates.map((gate) => gate.id === 'deployment' ? { ...gate, applicability: 'not-applicable', status: 'not-applicable', evidenceIds: [], reason: null } : gate) });
  assert.throws(() => validateCompletionContract(unjustified), /completion\.gates\[8\]\.reason/);
  const failed = completion({ overall: 'complete', gates: completion().gates.map((gate) => gate.id === 'automated-verification' ? { ...gate, status: 'failed' } : gate) });
  assert.throws(() => validateCompletionContract(failed), /overall.*complete/);
});

test('canonical semantic digests ignore volatile timestamps but bind semantic mutations', () => {
  const original = requirement();
  const later = { ...original, createdAt: '2027-01-01T00:00:00.000Z', updatedAt: '2027-01-02T00:00:00.000Z' };
  assert.equal(canonicalContractDigest('requirement', original), canonicalContractDigest('requirement', later));
  assert.notEqual(canonicalContractDigest('requirement', original), canonicalContractDigest('requirement', { ...original, summary: 'A buyer can submit two orders.' }));
  assert.match(canonicalContractDigest('session', session()), /^[a-f0-9]{64}$/);
  assert.throws(() => canonicalContractDigest('unknown', {}), /contract kind/);
});

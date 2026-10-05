import assert from 'node:assert/strict';
import test from 'node:test';
import {
  acceptRequirementCandidate,
  compileRequirement,
  prepareRequirementCompilation,
} from '../src/modules/delivery-core/index.mjs';

const hash = 'a'.repeat(64);

function candidate(overrides = {}) {
  return {
    schemaVersion: 2, id: 'requirement.search', title: 'Search catalog', summary: 'A visitor searches the catalog.',
    actors: [{ id: 'actor.visitor', name: 'Visitor', goals: ['Find an item'] }],
    goals: [{ id: 'goal.search', actorId: 'actor.visitor', statement: 'Find matching items' }],
    scope: ['Catalog search'], nonGoals: ['Catalog administration'], preconditions: ['The catalog is reachable'],
    businessRules: [{ id: 'rule.query', statement: 'Ignore empty queries' }],
    stateTransitions: [{ id: 'transition.search', from: 'idle', event: 'search', to: 'showing-results' }],
    inputs: [{ id: 'input.query', name: 'query', type: 'string', required: true, rules: ['Non-empty'] }],
    outputs: [{ id: 'output.results', name: 'results', type: 'array', rules: ['Only visible products'] }],
    failures: [{ id: 'failure.catalog', condition: 'Catalog is unavailable', outcome: 'Return a retriable error' }],
    permissions: [{ id: 'permission.search', actorId: 'actor.visitor', action: 'catalog.search', effect: 'allow' }],
    dataLifecycle: [{ id: 'data.query', data: 'Query', retention: 'Not retained', deletion: 'Discard after response' }],
    nfrs: [{ id: 'nfr.latency', category: 'performance', requirement: 'Meet the service latency budget' }],
    rollout: { strategy: 'incremental', safeguards: ['Feature flag'] }, rollback: { trigger: 'Error budget exceeded', action: 'Disable the flag' },
    acceptanceScenarios: [{ id: 'acceptance.search', given: ['A visible product'], when: 'A matching query is submitted', then: ['The product is returned'] }],
    assumptions: [], openQuestions: [], ownerDecisions: [],
    sourceEvidence: [{ id: 'source.request', source: 'operator-request', level: 'stated', digest: hash }],
    ...overrides,
  };
}

test('preparation is deterministic for one-line and complete requests', () => {
  const first = prepareRequirementCompilation({ requestText: 'Add catalog search', repositoryEvidence: [{ path: 'package.json', digest: hash }], ownerDecisions: [] });
  const second = prepareRequirementCompilation({ requestText: 'Add catalog search', repositoryEvidence: [{ path: 'package.json', digest: hash }], ownerDecisions: [] });
  assert.equal(first.inputDigest, second.inputDigest);
  assert.match(first.prompt, /Requirement IR v2/);
  assert.equal(first.schemaPath, 'assets/contracts/requirement-ir-v2-schema.json');
  assert.ok(first.boundaries.includes('Do not invent owner decisions.'));
  assert.notEqual(first.inputDigest, prepareRequirementCompilation({ requestText: 'Add catalog filtering', repositoryEvidence: [], ownerDecisions: [] }).inputDigest);
});

test('candidate acceptance rejects invalid semantics and returns owner material questions', () => {
  const compilation = prepareRequirementCompilation({ requestText: 'Add search', repositoryEvidence: [], ownerDecisions: [] });
  assert.equal(acceptRequirementCandidate({ compilation, candidate: candidate() }).status, 'accepted');
  const contradictory = candidate({ stateTransitions: [
    { id: 'transition.one', from: 'idle', event: 'search', to: 'showing-results' },
    { id: 'transition.two', from: 'idle', event: 'search', to: 'failed' },
  ] });
  assert.equal(acceptRequirementCandidate({ compilation, candidate: contradictory }).status, 'rejected');
  assert.match(acceptRequirementCandidate({ compilation, candidate: contradictory }).findings.join(' '), /contradictory/i);
  const question = candidate({ openQuestions: [{ id: 'question.visibility', question: 'Which products are visible?', material: true, status: 'open' }] });
  const pending = acceptRequirementCandidate({ compilation, candidate: question });
  assert.equal(pending.status, 'questions-required');
  assert.deepEqual(pending.materialQuestions.map((entry) => entry.id), ['question.visibility']);
  assert.equal(acceptRequirementCandidate({ compilation, candidate: candidate({ failures: [] }) }).status, 'rejected');
  assert.equal(acceptRequirementCandidate({ compilation, candidate: candidate({ permissions: [] }) }).status, 'rejected');
});

test('compileRequirement binds process evidence but never treats process success as approval', async () => {
  const adapter = {
    async generateStructured() { return { candidate: candidate(), bytes: Buffer.byteLength(JSON.stringify(candidate())), processEvidence: { agentId: 'fake', exitCode: 0, status: 'succeeded' } }; },
  };
  const result = await compileRequirement({ requestText: 'Add search', repositoryEvidence: [], ownerDecisions: [], adapter });
  assert.equal(result.status, 'accepted');
  assert.equal(result.processEvidence.exitCode, 0);
  assert.match(result.requirementDigest, /^[a-f0-9]{64}$/);

  const invalid = { ...adapter, async generateStructured() { return { candidate: { schemaVersion: 2 }, bytes: 19, processEvidence: { agentId: 'fake', exitCode: 0, status: 'succeeded' } }; } };
  const rejected = await compileRequirement({ requestText: 'Add search', repositoryEvidence: [], ownerDecisions: [], adapter: invalid });
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.processEvidence.exitCode, 0);
});

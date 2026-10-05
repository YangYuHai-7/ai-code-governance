export const digest = 'a'.repeat(64);

export function requirementFixture(overrides = {}) {
  return {
    schemaVersion: 2, id: 'requirement.fixture', title: 'Fixture requirement', summary: 'A user completes one governed action.',
    actors: [{ id: 'actor.user', name: 'User', goals: ['Complete the action'] }],
    goals: [{ id: 'goal.complete', actorId: 'actor.user', statement: 'Complete the action' }],
    scope: ['Governed action'], nonGoals: [], preconditions: ['The user is authorized'],
    businessRules: [{ id: 'rule.once', statement: 'Apply the action once' }],
    stateTransitions: [{ id: 'transition.complete', from: 'ready', event: 'complete', to: 'completed' }],
    inputs: [{ id: 'input.request', name: 'request', type: 'object', required: true, rules: ['Validated'] }],
    outputs: [{ id: 'output.result', name: 'result', type: 'object', rules: ['Traceable'] }],
    failures: [{ id: 'failure.invalid', condition: 'Input is invalid', outcome: 'Reject without mutation' }],
    permissions: [{ id: 'permission.complete', actorId: 'actor.user', action: 'fixture.complete', effect: 'allow' }],
    dataLifecycle: [{ id: 'data.fixture', data: 'Fixture', retention: 'Project policy', deletion: 'Project policy' }],
    nfrs: [{ id: 'nfr.fixture', category: 'reliability', requirement: 'Remain idempotent' }],
    rollout: { strategy: 'incremental', safeguards: ['Feature flag'] }, rollback: { trigger: 'Verification failure', action: 'Disable the flag' },
    acceptanceScenarios: [{ id: 'acceptance.fixture', given: ['A valid request'], when: 'The action runs', then: ['One result exists'] }],
    assumptions: [], openQuestions: [], ownerDecisions: [], sourceEvidence: [{ id: 'source.fixture', source: 'operator-request', level: 'stated', digest }],
    ...overrides,
  };
}

export function authorityFixture(overrides = {}) {
  return { allowedPaths: ['src/fixture.mjs'], allowedCommands: [], allowNetwork: false, allowExternalEffects: false, maxChangedFiles: 2, maxChangedBytes: 4096, ...overrides };
}

export function repositoryFixture(overrides = {}) {
  return { digest, files: [], ...overrides };
}

export function budgetsFixture(overrides = {}) {
  return { maxAgentTurns: 4, maxCommands: 8, maxChangedFiles: 2, maxChangedBytes: 4096, maxElapsedMs: 60000, ...overrides };
}

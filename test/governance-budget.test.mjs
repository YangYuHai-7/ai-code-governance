import assert from 'node:assert/strict';
import test from 'node:test';
import { evaluateGovernanceCost } from '../src/generator.mjs';

// The model under test: every Skill-governance size ceiling is an advisory. The one hard load
// gate is the owner-declared startup budget in docs/ai/context-map.yaml, enforced by the checker
// against the real closure, so a per-artifact cap here would be a second, hidden limit.
const LIMITS = {
  maximumFiles: 30,
  maximumBytes: 96 * 1024,
  maximumManagementProfileTokens: 2400,
  maximumAlwaysRuleTokens: 256,
  maximumWorkflowTokens: 2000,
};

function cost(increment) {
  return { increment };
}

test('every size ceiling is advisory and the cost path never blocks', () => {
  const over = evaluateGovernanceCost(cost({ files: 64, bytes: 256 * 1024, managementProfileTokens: 9000, alwaysRuleTokens: 300, workflowTokens: 9000 }), LIMITS);
  assert.deepEqual(Object.keys(over), ['advisories'], 'the policy returns guidance, never a gate verdict');
  assert.deepEqual(over.advisories.map((entry) => entry.id).sort(), [
    'always-rule-tokens', 'management-increment-bytes', 'management-increment-files', 'management-profile-tokens', 'workflow-tokens',
  ]);
});

test('an always rule over 256 tokens is not blocked when the declared startup budget covers it', () => {
  // The negative probe for the previous design: this used to be the one hard gate. Now it is a
  // single advisory, and the checker decides against context_budget.startup_max_tokens instead.
  const result = evaluateGovernanceCost(cost({ files: 4, bytes: 4096, managementProfileTokens: 800, alwaysRuleTokens: 400, workflowTokens: 900 }), LIMITS);
  assert.deepEqual(result.advisories.map((entry) => entry.id), ['always-rule-tokens']);
});

test('a framework inside every ceiling reports nothing at all', () => {
  const result = evaluateGovernanceCost(cost({ files: 4, bytes: 4096, managementProfileTokens: 800, alwaysRuleTokens: 120, workflowTokens: 900 }), LIMITS);
  assert.deepEqual(result, { advisories: [] });
});

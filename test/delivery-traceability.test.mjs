import assert from 'node:assert/strict';
import test from 'node:test';
import { buildTraceabilityGraph, evaluateTraceability } from '../src/modules/delivery-core/index.mjs';
import { architectureFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';
import { canonicalContractDigest } from '../src/modules/delivery-core/contracts.mjs';

function input(overrides = {}) {
  const requirement = requirementFixture();
  const architecture = architectureFixture(canonicalContractDigest('requirement', requirement));
  const requirementIds = ['goal.complete', 'rule.once', 'acceptance.fixture'];
  return {
    requirement, architecture,
    patches: [{ id: 'patch.fixture', path: 'src/fixture.mjs', requirementIds, architectureIds: ['decision.fixture'] }],
    tests: [{ id: 'test.fixture', path: 'test/fixture.test.mjs', requirementIds, evidenceIds: ['evidence.fixture'] }],
    evidence: [{ id: 'evidence.fixture', status: 'passed', verificationLevel: 'verified' }],
    ...overrides,
  };
}

test('traceability maps every material requirement through architecture, code, tests, and evidence', () => {
  const graph = buildTraceabilityGraph(input());
  const result = evaluateTraceability(graph);
  assert.equal(result.status, 'complete');
  assert.deepEqual(result.orphanChanges, []);
  assert.deepEqual(result.unverifiedNodes, []);
  assert.equal(result.requirementCoverage.every((entry) => entry.status === 'covered'), true);
});

test('traceability reports missing ownership, orphan changes, unowned tests, and stale evidence', () => {
  const graph = buildTraceabilityGraph(input({
    patches: [{ id: 'patch.orphan', path: 'src/orphan.mjs', requirementIds: [], architectureIds: [] }],
    tests: [{ id: 'test.unknown', path: 'test/unknown.test.mjs', requirementIds: ['requirement.unknown'], evidenceIds: ['evidence.stale'] }],
    evidence: [{ id: 'evidence.stale', status: 'passed', verificationLevel: 'reachable' }],
  }));
  const result = evaluateTraceability(graph);
  assert.equal(result.status, 'incomplete');
  assert.deepEqual(result.orphanChanges, ['src/orphan.mjs']);
  assert.ok(result.unverifiedNodes.includes('evidence.stale'));
  assert.ok(result.gaps.some((gap) => /unknown requirement/i.test(gap)));
  assert.ok(result.requirementCoverage.some((entry) => entry.status === 'missing'));
});

test('traceability rejects unsafe and duplicate material paths', () => {
  assert.throws(() => buildTraceabilityGraph(input({ patches: [{ id: 'patch.bad', path: '../escape', requirementIds: [], architectureIds: [] }] })), /safe repository-relative/);
  assert.throws(() => buildTraceabilityGraph(input({ patches: [input().patches[0], input().patches[0]] })), /duplicate.*patch.fixture/i);
});

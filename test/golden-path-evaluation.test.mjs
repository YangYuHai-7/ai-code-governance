import assert from 'node:assert/strict';
import test from 'node:test';
import { runGoldenPathEvaluation } from '../src/modules/evaluation/index.mjs';

const PACK = 'react-mantine-nest-fastify-drizzle-postgresql';

function dependencies(overrides = {}) {
  const calls = { turns: 0, reviewAuthority: null };
  const base = {
    calls,
    packs: { ids: [PACK], loadPack: (id) => ({ id, qualityMatrix: { gates: [{ id: 'unit-tests' }] } }) },
    agents: { ids: ['codex'] },
    preflight: { status: 'passed', checks: ['node', 'package-manager', 'postgresql', 'browser', 'ports', 'disk', 'executables'].map((name) => ({ name, status: 'passed', detail: name })) },
    probes: { status: 'passed', ids: ['cross-tenant-access'] },
    matrix: { status: 'passed', runId: 'quality-run-result.abc', requiredGateIds: ['unit-tests'], resolvedGateIds: ['unit-tests'] },
    readRequirement: () => ({ id: 'requirement.reference', entrypoint: 'npm run start:local', rollback: 'revert migration 0001', scenarios: ['acceptance.flow'] }),
    turns: {
      requirement: async () => { calls.turns += 1; return { status: 'succeeded', proposal: { requirement: {} } }; },
      architecture: async () => { calls.turns += 1; return { status: 'succeeded', proposal: { architecture: {} } }; },
      patch: async () => { calls.turns += 1; return { status: 'succeeded', proposal: { files: ['apps/api/src/application/board-service.ts'] }, unauthorizedPaths: [] }; },
      review: async (context) => { calls.turns += 1; calls.reviewAuthority = context.authority; return { status: 'succeeded', findings: [], authority: context.authority }; },
    },
    agent: { id: 'codex', version: '0.98.0', real: true },
    clock: () => '2026-10-05T00:00:00.000Z',
  };
  const merged = { ...base, ...overrides };
  merged.calls = calls;
  return merged;
}

function evaluate(input = {}, overrides = {}) {
  return runGoldenPathEvaluation({ packId: PACK, requirement: 'requirement.json', ...input }, dependencies(overrides));
}

test('unknown Packs, Agents, and unsafe requirement or output paths are rejected', async () => {
  await assert.rejects(() => runGoldenPathEvaluation({ packId: 'unknown-pack', requirement: 'requirement.json' }, dependencies()), /unknown Pack/i);
  await assert.rejects(() => evaluate({ agent: 'unknown-agent' }), /unknown Agent/i);
  await assert.rejects(() => evaluate({ requirement: '../outside.json' }), /requirement/i);
  await assert.rejects(() => evaluate({ requirement: '/absolute.json' }), /requirement/i);
  await assert.rejects(() => evaluate({ requirement: ['a.json', 'b.json'] }), /requirement/i);
  await assert.rejects(() => evaluate({ output: '../escape.json' }), /output/i);
});

test('a preflight without live authorization stops at E0 and never calls an Agent', async () => {
  const deps = dependencies();
  const receipt = await evaluate({}, deps);
  assert.equal(receipt.level, 'E1-deterministic');
  assert.equal(receipt.verdict, 'incomplete');
  assert.ok(receipt.gaps.some((gap) => /live-agent/i.test(gap)));
  assert.equal(deps.calls.turns, 0);
});

test('missing external capabilities produce a blocked receipt instead of a pass', async () => {
  const receipt = await evaluate({ liveAgent: true }, { preflight: { status: 'blocked', checks: [{ name: 'postgresql', status: 'blocked', detail: 'no server' }, { name: 'browser', status: 'blocked', detail: 'no browser' }] } });
  assert.equal(receipt.verdict, 'blocked');
  assert.equal(receipt.level, 'E0-generated');
  assert.match(receipt.gaps.join(' '), /postgresql/);
});

test('valid Agent output that exceeds workspace authority fails the evaluation', async () => {
  const receipt = await evaluate({ liveAgent: true }, { turns: {
    requirement: async () => ({ status: 'succeeded', proposal: { requirement: {} } }),
    architecture: async () => ({ status: 'succeeded', proposal: { architecture: {} } }),
    patch: async () => ({ status: 'succeeded', proposal: { files: [] }, unauthorizedPaths: ['apps/web/src/main.tsx'] }),
    review: async (context) => ({ status: 'succeeded', findings: [], authority: context.authority }),
  } });
  assert.equal(receipt.verdict, 'failed');
  assert.match(receipt.gaps.join(' '), /apps\/web\/src\/main\.tsx/);
  assert.ok(receipt.failureHistory.some((entry) => /authority/i.test(entry)));
});

test('E3 requires a real adapter, a complete matrix, and an isolated read-only review turn', async () => {
  const fakeAdapter = dependencies();
  const faked = await evaluate({ liveAgent: true, agent: 'codex' }, { agent: { id: 'codex', version: '0.98.0', real: false } });
  assert.notEqual(faked.level, 'E3-agent-executable');
  assert.ok(faked.gaps.some((gap) => /real adapter/i.test(gap)));
  assert.equal(fakeAdapter.calls.turns, 0);

  const real = dependencies();
  const receipt = await evaluate({ liveAgent: true, agent: 'codex' }, { });
  assert.equal(receipt.level, 'E3-agent-executable');
  assert.equal(receipt.verdict, 'passed');
  assert.equal(receipt.entrypoint, 'npm run start:local');
  assert.match(receipt.rollback, /revert/i);
  assert.equal(receipt.trace.review, 'independent-review');
  assert.ok(real.calls.reviewAuthority === null || real.calls.reviewAuthority === 'read-only');
});

test('a read-only review turn that writes is rejected and an incomplete matrix stays incomplete', async () => {
  const reviewWrite = await evaluate({ liveAgent: true }, { turns: {
    requirement: async () => ({ status: 'succeeded', proposal: {} }),
    architecture: async () => ({ status: 'succeeded', proposal: {} }),
    patch: async () => ({ status: 'succeeded', proposal: { files: [] } }),
    review: async () => ({ status: 'succeeded', findings: [], authority: 'workspace-write' }),
  } });
  assert.equal(reviewWrite.verdict, 'failed');
  assert.ok(reviewWrite.gaps.some((gap) => /read-only/i.test(gap)));

  const incomplete = await evaluate({ liveAgent: true }, { matrix: { status: 'blocked', runId: null, requiredGateIds: ['unit-tests'], resolvedGateIds: [] } });
  assert.notEqual(incomplete.level, 'E3-agent-executable');
  assert.equal(incomplete.verdict, 'incomplete');
  assert.ok(incomplete.gaps.some((gap) => /matrix/i.test(gap)));
});

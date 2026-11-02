import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { evaluationCommand } from '../src/cli/commands/evaluation.mjs';
import { digestEvaluationRepository, runGoldenPathEvaluation } from '../src/modules/evaluation/index.mjs';

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

test('failed Agent findings are retained in the evaluation failure history', async () => {
  const receipt = await evaluate({ liveAgent: true }, { turns: {
    requirement: async () => ({ status: 'failed', findings: ['transport timed out'] }),
    architecture: async () => ({ status: 'succeeded', proposal: {} }),
    patch: async () => ({ status: 'succeeded', proposal: {}, unauthorizedPaths: [] }),
    review: async () => ({ status: 'succeeded', findings: [], authority: 'read-only' }),
  } });
  assert.ok(receipt.failureHistory.some((entry) => /requirement.*transport timed out/i.test(entry)));
});

test('the evaluation receipt records elapsed execution time from a monotonic clock', async () => {
  const ticks = [1_000, 1_275];
  const receipt = await evaluate({ liveAgent: true }, { monotonicClock: () => ticks.shift() });
  assert.equal(receipt.budget.elapsedMs, 275);
});

test('Agent changes invalidate a matrix that was captured before the patch', async () => {
  const receipt = await evaluate({ liveAgent: true }, { turns: {
    requirement: async () => ({ status: 'succeeded', proposal: {} }),
    architecture: async () => ({ status: 'succeeded', proposal: {} }),
    patch: async () => ({ status: 'succeeded', proposal: {}, unauthorizedPaths: [], changedPaths: ['project/app.ts'] }),
    review: async () => ({ status: 'succeeded', findings: [], authority: 'read-only' }),
  } });
  assert.notEqual(receipt.level, 'E3-agent-executable');
  assert.equal(receipt.matrix.status, 'blocked');
  assert.ok(receipt.gaps.some((gap) => /predates Agent changes|rerun/i.test(gap)));
});

test('the live CLI builds real Agent dependencies and can issue an E3 receipt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-evaluation-cli-'));
  fs.writeFileSync(path.join(root, 'requirement.json'), JSON.stringify({
    id: 'requirement.cli-live',
    entrypoint: 'npm run start:local',
    rollback: { action: 'revert the candidate change' },
    acceptanceScenarios: [{ id: 'acceptance.cli-live' }],
  }));
  let calls = 0;
  const liveDependencies = dependencies();
  const receipt = await evaluationCommand(root, 'golden-path', {
    requirement: 'requirement.json', agent: 'codex', 'live-agent': true, json: true,
  }, {
    buildLiveDependencies: async ({ document, requirementPath }) => {
      calls += 1;
      assert.equal(document.id, 'requirement.cli-live');
      assert.equal(requirementPath, 'requirement.json');
      return liveDependencies;
    },
    writeReport: () => {},
  });
  assert.equal(calls, 1);
  assert.equal(receipt.level, 'E3-agent-executable');
  assert.equal(receipt.verdict, 'passed');
  fs.rmSync(root, { recursive: true, force: true });
});

test('evaluation repository evidence is content-bound and portable across isolated copies', () => {
  const first = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-evaluation-digest-a-'));
  const second = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-evaluation-digest-b-'));
  fs.mkdirSync(path.join(first, 'project'), { recursive: true });
  fs.mkdirSync(path.join(second, 'project'), { recursive: true });
  fs.writeFileSync(path.join(first, 'project', 'app.js'), 'export const value = 1;\n');
  fs.writeFileSync(path.join(second, 'project', 'app.js'), 'export const value = 1;\n');
  fs.mkdirSync(path.join(second, 'project', 'dist'), { recursive: true });
  fs.mkdirSync(path.join(second, 'project', 'test-results'), { recursive: true });
  fs.writeFileSync(path.join(second, 'project', 'dist', 'bundle.js'), 'generated output\n');
  fs.writeFileSync(path.join(second, 'project', 'test-results', 'last-run.json'), '{}\n');
  assert.equal(digestEvaluationRepository(first), digestEvaluationRepository(second));
  fs.rmSync(first, { recursive: true, force: true });
  fs.rmSync(second, { recursive: true, force: true });
});

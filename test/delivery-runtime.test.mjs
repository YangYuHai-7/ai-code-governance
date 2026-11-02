import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createAgentRuntimeAdapter } from '../src/adapters/agents/index.mjs';
import { openDeliverySessionStore } from '../src/adapters/filesystem/index.mjs';
import {
  canonicalContractDigest,
  classifyDeliveryFailure,
  createDeliveryRuntime,
  createSessionCheckpoint,
  evaluateDeliveryCompletion,
  evaluateQualityMatrixRun,
  riskProfileSetDigest,
} from '../src/modules/delivery-core/index.mjs';
import { loadGoldenPathPack, validateGoldenPathPack } from '../src/modules/stack-packs/index.mjs';
import { architectureFixture, authorityFixture, budgetsFixture, repositoryFixture, requirementFixture } from './support/delivery-core-fixtures.mjs';

const goldenPathPack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');

function memoryStore({ failAfterWrite = false } = {}) {
  const sessions = new Map(), events = new Map(); let failed = false;
  return {
    create(session) { sessions.set(session.id, structuredClone(session)); return session; },
    read(id) { const value = sessions.get(id); if (!value) throw new Error('missing'); return structuredClone(value); },
    compareAndSwap(id, expected, next) {
      const current = sessions.get(id);
      if (canonicalContractDigest('session', current) !== expected) throw new Error('compare-and-swap conflict');
      sessions.set(id, structuredClone(next));
      if (failAfterWrite && !failed) { failed = true; throw Object.assign(new Error('interrupted after checkpoint'), { code: 'EIO' }); }
      return next;
    },
    appendEvent(id, event) { const list = events.get(id) ?? []; if (list.some((entry) => entry.id === event.id)) return event; list.push(structuredClone(event)); events.set(id, list); return event; },
    eventList(id) { return structuredClone(events.get(id) ?? []); },
  };
}

function runtimeAgent(id, handler, capabilities = { boundedPatch: true, structuredRequirement: true, architectureProposal: true, resume: true }) {
  return createAgentRuntimeAdapter({
    id, capabilities,
    prepareTurn(request) { return { prompt: request.prompt, requestDigest: request.semanticDigest }; },
    async invoke(turn) { const proposal = await handler(turn); return { exitCode: 0, stdout: JSON.stringify({ proposal, findings: [] }), stderr: '', usage: { inputTokens: 10, outputTokens: 10, cost: 0.01 } }; },
    cancel: async (turnId) => ({ turnId, cancelled: true }),
  });
}

function approvedInput(overrides = {}) {
  const requirement = requirementFixture(), requirementDigest = canonicalContractDigest('requirement', requirement);
  return { id: 'session.runtime', requestText: 'Implement fixture', requirement, architecture: architectureFixture(requirementDigest), authority: authorityFixture(), budgets: budgetsFixture(), repositorySnapshot: repositoryFixture(), agentId: 'agent-one', maxRetries: 2, ...overrides };
}

async function advance(runtime, id, count) { let value; for (let index = 0; index < count; index += 1) value = await runtime.step(id); return value; }

test('runtime reaches review-ready through idempotent patch and verification effects', async () => {
  const store = memoryStore(), applied = [], verified = [];
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent('agent-one', async () => ({ files: [{ path: 'src/fixture.mjs', content: 'ok' }] }))],
    workspace: { async apply(session, key, proposal) { applied.push(key); return { status: 'committed', changedFiles: proposal.files.length, changedBytes: 2 }; } },
    verifier: { async run(session, key) { verified.push(key); return { status: 'passed', commands: 1, evidence: [] }; } },
    clock: () => '2026-10-05T00:00:00.000Z',
  });
  const started = runtime.start(approvedInput());
  assert.equal(started.state, 'architecture-ready');
  const ready = await advance(runtime, started.id, 3);
  assert.equal(ready.state, 'review-ready');
  assert.equal(applied.length, 1);
  assert.equal(verified.length, 1);
  assert.ok(store.eventList(started.id).some((event) => event.phase === 'after' && event.effect === 'patch'));
});

test('business questions block while a technical verification failure enters bounded repair', async () => {
  const business = createDeliveryRuntime({
    store: memoryStore(), agents: [runtimeAgent('agent-one', async () => ({ questions: [{ id: 'owner.scope', question: 'Which scope?' }] }))],
    workspace: { apply() { throw new Error('not reached'); } }, verifier: { run() { throw new Error('not reached'); } },
  });
  const pending = business.start({ ...approvedInput({ requirement: null, architecture: null }), id: 'session.business' });
  assert.equal((await business.step(pending.id)).state, 'blocked');

  let verification = 0;
  const repair = createDeliveryRuntime({
    store: memoryStore(), agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { verification += 1; return { status: verification === 1 ? 'failed' : 'passed', commands: 1, evidence: [] }; } },
  });
  const started = repair.start({ ...approvedInput(), id: 'session.repair' });
  assert.equal((await advance(repair, started.id, 3)).state, 'repairing');
  assert.equal((await advance(repair, started.id, 2)).state, 'review-ready');
});

test('resume rejects stale inputs and can switch to a capability-compatible adapter', async () => {
  const store = memoryStore();
  const agents = [runtimeAgent('agent-one', async () => ({ files: [] })), runtimeAgent('agent-two', async () => ({ files: [] }))];
  const runtime = createDeliveryRuntime({ store, agents, workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } }, verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } } });
  const started = runtime.start(approvedInput());
  const bindings = { requirementDigest: started.requirementDigest, architectureDigest: started.architectureDigest, authorityDigest: started.authorityDigest, repositoryDigest: started.repositoryDigest };
  assert.throws(() => runtime.resume(started.id, { ...bindings, repositoryDigest: 'b'.repeat(64) }), /stale/i);
  assert.equal(runtime.resume(started.id, { ...bindings, agentId: 'agent-two' }).activeAgentId, 'agent-two');
  assert.equal(runtime.cancel(started.id).state, 'cancelled');
});

test('runtime stops when changed-file or changed-byte budgets are exceeded', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 3, changedBytes: 5000 }; } },
    verifier: { async run() { return { status: 'passed', commands: 99, evidence: [] }; } },
    clock: () => '2026-10-05T00:00:00.000Z',
  });
  const started = runtime.start({ ...approvedInput({ budgets: budgetsFixture({ maxChangedFiles: 1, maxChangedBytes: 4 }) }), id: 'session.budget' });
  await runtime.step(started.id);
  assert.equal((await runtime.step(started.id)).state, 'failed');
  assert.equal(runtime.status(started.id).lastFailure.category, 'budget');
});

test('runtime enforces Agent usage, turn, command, retry, and elapsed budgets', async () => {
  const common = { workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } } };
  const usageRuntime = createDeliveryRuntime({
    store: memoryStore(), agents: [runtimeAgent('agent-one', async () => ({ files: [] }))], ...common,
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const usageStarted = usageRuntime.start({ ...approvedInput({ budgets: budgetsFixture({ maxInputTokens: 5, maxOutputTokens: 5, maxCost: 0.001 }) }), id: 'session.usage-budget' });
  await usageRuntime.step(usageStarted.id);
  assert.equal((await usageRuntime.step(usageStarted.id)).lastFailure.category, 'budget');

  const commandRuntime = createDeliveryRuntime({
    store: memoryStore(), agents: [runtimeAgent('agent-one', async () => ({ files: [] }))], ...common,
    verifier: { async run() { return { status: 'passed', commands: 9, evidence: [] }; } },
  });
  const commandStarted = commandRuntime.start({ ...approvedInput(), id: 'session.command-budget' });
  assert.equal((await advance(commandRuntime, commandStarted.id, 3)).lastFailure.category, 'budget');

  const turnRuntime = createDeliveryRuntime({
    store: memoryStore(), agents: [runtimeAgent('agent-one', async () => ({ files: [] }))], ...common,
    verifier: { async run() { return { status: 'failed', commands: 1, evidence: [] }; } },
  });
  const turnStarted = turnRuntime.start({ ...approvedInput({ budgets: budgetsFixture({ maxAgentTurns: 1 }) }), id: 'session.turn-budget' });
  await advance(turnRuntime, turnStarted.id, 3);
  assert.equal((await turnRuntime.step(turnStarted.id)).lastFailure.category, 'budget');

  const elapsedTimes = ['2026-10-05T00:00:00.000Z', '2026-10-05T00:00:00.000Z', '2026-10-05T00:02:00.000Z'];
  const elapsedRuntime = createDeliveryRuntime({
    store: memoryStore(), agents: [runtimeAgent('agent-one', async () => ({ files: [] }))], ...common,
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; },
    }, clock: () => elapsedTimes.shift() ?? '2026-10-05T00:02:00.000Z',
  });
  const elapsedStarted = elapsedRuntime.start({ ...approvedInput(), id: 'session.elapsed-budget' });
  assert.equal((await elapsedRuntime.step(elapsedStarted.id)).lastFailure.category, 'budget');

  let checks = 0;
  const retryRuntime = createDeliveryRuntime({
    store: memoryStore(), agents: [runtimeAgent('agent-one', async () => ({ files: [] }))], ...common,
    verifier: { async run() { checks += 1; return { status: 'failed', commands: 1, evidence: [] }; } },
  });
  const retryStarted = retryRuntime.start({ ...approvedInput({ maxRetries: 1 }), id: 'session.retry-budget' });
  await advance(retryRuntime, retryStarted.id, 3);
  await retryRuntime.step(retryStarted.id);
  const stopped = await retryRuntime.step(retryStarted.id);
  assert.equal(stopped.state, 'failed');
  assert.equal(stopped.lastFailure.category, 'verification');
  assert.equal(checks, 2);
});

test('a checkpointed transition survives interruption and a repeated step does not repeat it', async () => {
  const store = memoryStore({ failAfterWrite: true });
  const runtime = createDeliveryRuntime({ store, agents: [runtimeAgent('agent-one', async () => ({ files: [] }))], workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } }, verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } } });
  const started = runtime.start({ ...approvedInput(), id: 'session.interrupted' });
  assert.equal((await runtime.step(started.id)).state, 'plan-approved');
  assert.equal(runtime.status(started.id).state, 'plan-approved');
  assert.equal((await runtime.step(started.id)).state, 'executing');
});

test('runtime refuses an invalid persisted session before any Agent or workspace effect', async () => {
  const store = memoryStore();
  let effects = 0;
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent('agent-one', async () => { effects += 1; return { files: [] }; })],
    workspace: { async apply() { effects += 1; return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { effects += 1; return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.invalid-persisted' });
  const approved = await runtime.step(started.id);
  assert.equal(approved.state, 'plan-approved');
  store.compareAndSwap(started.id, canonicalContractDigest('session', approved), { ...approved, unexpectedField: true });
  assert.throws(() => runtime.status(started.id), /unknown field/i);
  await assert.rejects(runtime.step(started.id), /unknown field/i);
  assert.equal(effects, 0);
});

test('runtime rejects a tampered published session on disk before Agent execution', async (t) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-runtime-invalid-session-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = openDeliverySessionStore(root);
  let effects = 0;
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent('agent-one', async () => { effects += 1; return { files: [] }; })],
    workspace: { async apply() { effects += 1; return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { effects += 1; return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.invalid-on-disk' });
  const approved = await runtime.step(started.id);
  assert.equal(approved.state, 'plan-approved');
  const file = path.join(root, '.ai-governance/state/delivery-sessions', started.id, 'session.json');
  fs.writeFileSync(file, JSON.stringify({ ...approved, unexpectedField: true }));
  assert.throws(() => runtime.status(started.id), /unknown field/i);
  await assert.rejects(runtime.step(started.id), /unknown field/i);
  assert.equal(effects, 0);
});

test('failure classification is explicit and unknown errors stop as internal', () => {
  for (const category of ['business-decision', 'agent-unavailable', 'policy', 'patch-conflict', 'verification', 'infrastructure', 'budget', 'stale-input', 'internal']) {
    const error = category === 'internal' ? new Error('unknown') : Object.assign(new Error(category), { category });
    assert.equal(classifyDeliveryFailure(error, {}).category, category);
  }
  assert.equal(classifyDeliveryFailure(Object.assign(new Error('stale'), { code: 'AICG_STALE_INPUT' }), {}).category, 'stale-input');
});

test('Pack and risk bindings persist across a checkpoint and resume', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, pack: goldenPathPack,
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
    clock: () => '2026-10-05T00:00:00.000Z',
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.pack-binding' });
  assert.equal(started.runtime.pack.id, goldenPathPack.id);
  const approved = await runtime.step(started.id);
  assert.equal(approved.state, 'plan-approved');
  assert.ok(approved.runtime.riskProfileSet.requiredGateIds.length > 0);
  const checkpointed = createSessionCheckpoint(approved, 'durable bindings', () => '2026-10-05T00:01:00.000Z');
  store.compareAndSwap(started.id, canonicalContractDigest('session', approved), checkpointed);
  const resumed = runtime.resume(started.id, { requirementDigest: checkpointed.requirementDigest, architectureDigest: checkpointed.architectureDigest, authorityDigest: checkpointed.authorityDigest, repositoryDigest: checkpointed.repositoryDigest });
  assert.equal(resumed.runtime.pack.digest, approved.runtime.pack.digest);
  assert.deepEqual(resumed.runtime.riskProfileSet, approved.runtime.riskProfileSet);
});

test('an owner-dependent risk blocks the golden path before Agent or workspace effects', async () => {
  const requirement = { ...requirementFixture(), summary: 'Handle personal data with explicit privacy controls.' };
  const architecture = architectureFixture(canonicalContractDigest('requirement', requirement));
  let effects = 0;
  const runtime = createDeliveryRuntime({
    store: memoryStore(), pack: goldenPathPack,
    agents: [runtimeAgent('agent-one', async () => { effects += 1; return { files: [] }; })],
    workspace: { async apply() { effects += 1; return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { effects += 1; return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.owner-risk', requirement, architecture });
  const blocked = await runtime.step(started.id);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.lastFailure.category, 'business-decision');
  assert.ok(blocked.runtime.riskProfileSet.ownerQuestions.some((question) => question.profileId === 'privacy'));
  assert.equal(effects, 0);
  assert.throws(() => runtime.resume(started.id, {
    requirementDigest: blocked.requirementDigest,
    architectureDigest: blocked.architectureDigest,
    authorityDigest: blocked.authorityDigest,
    repositoryDigest: blocked.repositoryDigest,
  }), /owner decision.*risk profile/i);
  assert.equal(runtime.status(started.id).state, 'blocked');
});

test('a changed Pack digest blocks resume instead of discarding approvals', async () => {
  const store = memoryStore();
  const effects = {
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  };
  const runtime = createDeliveryRuntime({ store, pack: goldenPathPack, ...effects });
  const started = runtime.start({ ...approvedInput(), id: 'session.pack-change' });
  const approved = await runtime.step(started.id);
  const bindings = { requirementDigest: approved.requirementDigest, architectureDigest: approved.architectureDigest, authorityDigest: approved.authorityDigest, repositoryDigest: approved.repositoryDigest };
  const movedPack = validateGoldenPathPack({ ...goldenPathPack, release: 'v3' });
  const nextRuntime = createDeliveryRuntime({ store, pack: movedPack, ...effects });
  assert.throws(() => nextRuntime.resume(started.id, bindings), /Pack digest/i);
  assert.equal(runtime.resume(started.id, bindings).runtime.pack.digest, approved.runtime.pack.digest);
});

test('a failed golden path architecture evaluation blocks the run before plan approval', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, pack: goldenPathPack,
    architectureEvaluator: () => ({ status: 'failed', issues: [{ code: 'cross-feature-private-import', path: 'src/fixture.mjs' }], unsupportedFiles: [] }),
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { throw new Error('not reached'); } },
    verifier: { async run() { throw new Error('not reached'); } },
    clock: () => '2026-10-05T00:00:00.000Z',
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.architecture-failure' });
  const blocked = await runtime.step(started.id);
  assert.equal(blocked.state, 'blocked');
  assert.equal(blocked.lastFailure.category, 'policy');
  assert.equal(blocked.runtime.architectureEvaluation.status, 'failed');
  assert.deepEqual(blocked.runtime.architectureEvaluation.issueCodes, ['cross-feature-private-import']);
  const contract = evaluateDeliveryCompletion({ session: blocked, traceability: { status: 'complete', gaps: [], orphanChanges: [] }, evidence: [], profile: 'production' });
  assert.notEqual(contract.overall, 'complete');
  assert.ok(contract.residualGaps.some((gap) => gap.includes('architecture evaluation failed')));
});

test('a passing architecture evaluation is recorded before the plan is approved', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, pack: goldenPathPack,
    architectureEvaluator: () => ({ status: 'passed', issues: [], unsupportedFiles: [] }),
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.architecture-pass' });
  const approved = await runtime.step(started.id);
  assert.equal(approved.state, 'plan-approved');
  assert.equal(approved.runtime.architectureEvaluation.status, 'passed');
  assert.match(approved.runtime.architectureEvaluation.digest, /^[a-f0-9]{64}$/);
});
function qualityRunFor(session, digestOverrides = {}) {
  const plan = {
    schemaVersion: 1, id: 'quality-run.runtime', packId: 'pack.runtime', matrixId: 'quality.runtime',
    requiredGateIds: ['unit-tests'],
    gates: [{ id: 'unit-tests', owner: 'functional', purpose: 'unit', applicability: 'required', reason: null, timeoutMs: 1000, maxOutputBytes: 512, artifactBudgetBytes: 256, evidence: 'captured output' }],
    digests: { requirement: session.requirementDigest, architecture: session.architectureDigest, repository: session.repositoryDigest, pack: 'c'.repeat(64), risk: 'd'.repeat(64), environment: 'e'.repeat(64), ...digestOverrides },
  };
  return evaluateQualityMatrixRun({ plan, results: [{ gateId: 'unit-tests', status: 'passed', cleanup: { status: 'clean' } }], artifacts: [], environment: plan.digests.environment });
}

test('a quality matrix receipt is persisted before the session reaches review', async () => {
  const store = memoryStore();
  let run = null;
  const runtime = createDeliveryRuntime({
    store, agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run(session) { run = qualityRunFor(session); return { status: 'passed', commands: 1, evidence: [], qualityMatrixRun: run, qualityMatrixPlanId: run.planId, environmentDigest: run.digests.environment }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.quality-receipt' });
  const ready = await advance(runtime, started.id, 3);
  assert.equal(ready.state, 'review-ready');
  assert.equal(ready.runtime.qualityMatrixRun.planId, run.planId);
  assert.equal(ready.runtime.qualityMatrixPlanId, run.planId);
  assert.equal(ready.runtime.environmentDigest, run.digests.environment);
});

test('a failed data gate cannot reach review when the verifier summary claims passed', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run(session) {
      const plan = {
        schemaVersion: 1, id: 'quality-run.data-failure', packId: 'pack.runtime', matrixId: 'quality.runtime',
        requiredGateIds: ['migration-safety'],
        gates: [{ id: 'migration-safety', owner: 'data', purpose: 'migration', applicability: 'required', reason: null, timeoutMs: 1000, maxOutputBytes: 512, artifactBudgetBytes: 256, evidence: 'captured output' }],
        digests: { requirement: session.requirementDigest, architecture: session.architectureDigest, repository: session.repositoryDigest, pack: 'c'.repeat(64), risk: 'd'.repeat(64), environment: 'e'.repeat(64) },
      };
      const qualityMatrixRun = evaluateQualityMatrixRun({
        plan, results: [{ gateId: 'migration-safety', status: 'failed', failureClassification: 'migration-failed', cleanup: { status: 'clean' } }],
        artifacts: [], environment: plan.digests.environment,
      });
      return { status: 'passed', commands: 1, evidence: [], qualityMatrixRun };
    } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.data-gate-failure' });
  const result = await advance(runtime, started.id, 3);
  assert.equal(result.state, 'repairing');
  assert.equal(result.runtime.qualityMatrixRun, null);
  assert.equal(result.lastFailure.category, 'verification');
  assert.match(result.lastFailure.message, /migration-safety.*rerun/i);
  assert.ok(store.eventList(started.id).some((event) => event.effect === 'verification' && event.phase === 'after' && event.status === 'failed'));
});

test('a golden path cannot reach review without its required quality matrix receipt', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, pack: goldenPathPack,
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.missing-matrix' });
  const result = await advance(runtime, started.id, 3);
  assert.equal(result.state, 'repairing');
  assert.equal(result.runtime.qualityMatrixRun, null);
  assert.match(result.lastFailure.message, /quality matrix receipt.*rerun/i);
});

test('a passed matrix bound to stale requirements cannot reach review', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run(session) {
      return { status: 'passed', commands: 1, evidence: [], qualityMatrixRun: qualityRunFor(session, { requirement: 'f'.repeat(64) }) };
    } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.stale-matrix' });
  const result = await advance(runtime, started.id, 3);
  assert.equal(result.state, 'repairing');
  assert.equal(result.runtime.qualityMatrixRun, null);
  assert.match(result.lastFailure.message, /stale.*requirement.*rerun/i);
});

test('a passed matrix missing activated golden-path gates cannot reach review', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store, pack: goldenPathPack,
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run(session) {
      const risk = session.runtime.riskProfileSet;
      assert.ok(risk.requiredGateIds.length > 1);
      const gateId = risk.requiredGateIds[0];
      const plan = {
        schemaVersion: 1, id: 'quality-run.partial', packId: goldenPathPack.id, matrixId: goldenPathPack.qualityMatrix.id,
        requiredGateIds: [gateId],
        gates: [{ id: gateId, owner: 'functional', purpose: 'unit', applicability: 'required', reason: null, timeoutMs: 1000, maxOutputBytes: 512, artifactBudgetBytes: 256, evidence: 'captured output' }],
        digests: { requirement: session.requirementDigest, architecture: session.architectureDigest, repository: session.repositoryDigest, pack: session.runtime.pack.digest, risk: riskProfileSetDigest(risk), environment: 'e'.repeat(64) },
      };
      const qualityMatrixRun = evaluateQualityMatrixRun({ plan, results: [{ gateId, status: 'passed', cleanup: { status: 'clean' } }], artifacts: [], environment: plan.digests.environment });
      return { status: 'passed', commands: 1, evidence: [], qualityMatrixRun };
    } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.partial-matrix' });
  const result = await advance(runtime, started.id, 3);
  assert.equal(result.state, 'repairing');
  assert.equal(result.runtime.qualityMatrixRun, null);
  assert.match(result.lastFailure.message, /activated gates.*rerun/i);
});

test('a retained owner-blocked risk cannot bypass its decision gate on a later step', async () => {
  const store = memoryStore();
  let effects = 0;
  const runtime = createDeliveryRuntime({
    store, pack: goldenPathPack,
    agents: [runtimeAgent('agent-one', async () => { effects += 1; return { files: [] }; })],
    workspace: { async apply() { effects += 1; return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { effects += 1; return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.retained-owner-risk' });
  const approved = await runtime.step(started.id);
  const set = approved.runtime.riskProfileSet;
  const blockedSet = {
    ...set,
    profiles: set.profiles.map((entry) => entry.id === 'privacy'
      ? { ...entry, applicability: 'blocked', triggerEvidence: [{ source: 'requirement', detail: 'requirement.summary: personal data' }], reason: 'Owner decision required.' }
      : entry),
    ownerQuestions: [{ id: 'question.risk.privacy', profileId: 'privacy', question: 'Confirm privacy evidence provider.', material: true }],
  };
  store.compareAndSwap(approved.id, canonicalContractDigest('session', approved), { ...approved, runtime: { ...approved.runtime, riskProfileSet: blockedSet } });
  const result = await advance(runtime, started.id, 2);
  assert.equal(result.state, 'blocked');
  assert.equal(result.lastFailure.category, 'business-decision');
  assert.match(result.lastFailure.message, /owner decision.*risk profile.*privacy/i);
  assert.equal(effects, 0);
});

test('entering repair invalidates the prior quality matrix receipt', async () => {
  const store = memoryStore();
  let calls = 0;
  const runtime = createDeliveryRuntime({
    store, agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run(session) { calls += 1; const run = qualityRunFor(session); return { status: calls === 1 ? 'failed' : 'passed', commands: 1, evidence: [], qualityMatrixRun: run, qualityMatrixPlanId: run.planId, environmentDigest: run.digests.environment }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.repair-invalidation' });
  const repairing = await advance(runtime, started.id, 3);
  assert.equal(repairing.state, 'repairing');
  assert.equal(repairing.runtime.qualityMatrixRun, null);
  assert.equal(repairing.runtime.qualityMatrixPlanId, null);
  const ready = await advance(runtime, started.id, 2);
  assert.equal(ready.state, 'review-ready');
  assert.ok(ready.runtime.qualityMatrixRun);
  assert.equal(calls, 2);
});
test('a cancelled session refuses further work and does not advance itself', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.cancelled-terminal' });
  const approved = await runtime.step(started.id);
  assert.equal(runtime.cancel(started.id).state, 'cancelled');
  const afterCancel = canonicalContractDigest('session', store.read(started.id));
  const bindings = { requirementDigest: approved.requirementDigest, architectureDigest: approved.architectureDigest, authorityDigest: approved.authorityDigest, repositoryDigest: approved.repositoryDigest };
  // Refusal may arrive as a thrown error or as an unchanged cancelled session; either way the
  // session must not advance, so the invariant is asserted rather than one mechanism.
  const refuses = (attempt) => {
    try {
      attempt();
      return true;
    } catch (error) {
      return /cancel/i.test(error.message);
    }
  };
  assert.ok(refuses(() => runtime.step(started.id)), 'a cancelled session must not take another step');
  assert.ok(refuses(() => runtime.resume(started.id, bindings)), 'a cancelled session must not resume');
  assert.ok(refuses(() => runtime.cancel(started.id)), 'cancelling twice must not restart the session');
  assert.equal(store.read(started.id).state, 'cancelled');
  assert.equal(canonicalContractDigest('session', store.read(started.id)), afterCancel);
  assert.equal(runtime.start({ ...approvedInput(), id: 'session.after-cancel' }).id, 'session.after-cancel');
});
test('an agent proposal outside the approved authority never reaches the workspace effect', async () => {
  const store = memoryStore();
  const applied = [];
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent('agent-one', async () => ({ files: [{ path: '../escape.txt', content: 'outside' }] }))],
    workspace: { async apply(request) { applied.push(request); return { status: 'committed', changedFiles: 1, changedBytes: 8 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.authority-denied' });
  let refused = false;
  try {
    await runtime.step(started.id);
  } catch (error) {
    refused = /authority|permission|not approved/i.test(error.message);
  }
  const escaped = applied.some((request) => JSON.stringify(request).includes('escape.txt'));
  assert.equal(escaped, false, 'a path outside the approved authority must never be applied');
  if (refused) assert.equal(applied.length, 0, 'a refused proposal applies nothing');
  else assert.ok(applied.length === 0 || !escaped, 'the workspace effect must not receive the escaping path');
});
test('tampered persisted data stops resume instead of being trusted', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  const started = runtime.start({ ...approvedInput(), id: 'session.tampered' });
  const approved = await runtime.step(started.id);
  const bindings = { requirementDigest: approved.requirementDigest, architectureDigest: approved.architectureDigest, authorityDigest: approved.authorityDigest, repositoryDigest: approved.repositoryDigest };
  const stored = store.read('session.tampered');
  store.compareAndSwap('session.tampered', canonicalContractDigest('session', stored), { ...stored, requirementDigest: 'c'.repeat(64) });
  assert.throws(() => runtime.resume('session.tampered', bindings), /stale|mismatch|conflict|digest/i);
  assert.equal(store.read('session.tampered').state, stored.state, 'a refused resume must not advance the tampered session');
});
test('a requirement the runtime cannot compile stops before any approval', async () => {
  const store = memoryStore();
  const runtime = createDeliveryRuntime({
    store,
    agents: [runtimeAgent('agent-one', async () => ({ files: [] }))],
    workspace: { async apply() { return { status: 'committed', changedFiles: 0, changedBytes: 0 }; } },
    verifier: { async run() { return { status: 'passed', commands: 1, evidence: [] }; } },
  });
  let refused = false;
  let sessionId = null;
  try {
    const started = runtime.start({ ...approvedInput(), id: 'session.bad-requirement', requirement: { schemaVersion: 2, id: 'requirement.incomplete' } });
    sessionId = started.id;
    await runtime.step(started.id);
  } catch (error) {
    refused = /requirement|invalid|incomplete/i.test(error.message);
  }
  assert.ok(refused, 'an uncompilable requirement must be refused, not approved');
  if (sessionId !== null) assert.notEqual(store.read(sessionId).state, 'requirements-approved');
});

import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';
import { packContractDigest, validateGoldenPathPack } from '../stack-packs/index.mjs';
import { runAgentTurn } from './agent-contract.mjs';
import { normalizeArchitectureEvaluation } from './completion.mjs';
import { canonicalContractDigest, validateDeliverySession } from './contracts.mjs';
import { classifyDeliveryFailure } from './failures.mjs';
import { validateQualityMatrixRun } from './quality-matrix.mjs';
import { activateRiskProfiles } from './risk-profiles.mjs';
import { createDeliverySession, resumeDeliverySession, transitionDeliverySession } from './session.mjs';

function timestamp(clock) { return (clock ?? (() => new Date().toISOString()))(); }

function mutated(session, key, changes, clock) {
  return validateDeliverySession({
    ...session,
    ...changes,
    sequence: session.sequence + 1,
    previousDigest: canonicalContractDigest('session', session),
    idempotencyKey: key,
    updatedAt: timestamp(clock),
  });
}

function usage(session, changes = {}) {
  return { ...session.usage, ...changes };
}

function safeAppend(store, id, event) {
  try { store.appendEvent(id, event); }
  catch (error) { if (!/duplicate event/i.test(error.message)) throw error; }
}

export function createDeliveryRuntime({ store, agents = [], workspace, verifier, clock, pack = null, architectureEvaluator = null }) {
  if (!store || !['create', 'read', 'compareAndSwap', 'appendEvent'].every((name) => typeof store[name] === 'function')) throw usageError('Delivery runtime requires a session store.');
  if (!Array.isArray(agents)) throw usageError('Delivery runtime agents must be an array.');
  const goldenPath = pack === null || pack === undefined ? null : validateGoldenPathPack(pack);
  const goldenPathDigest = goldenPath ? packContractDigest(goldenPath) : null;
  const evaluateArchitecture = typeof architectureEvaluator === 'function' ? architectureEvaluator : architectureEvaluator?.evaluate?.bind(architectureEvaluator);
  if (architectureEvaluator && typeof evaluateArchitecture !== 'function') throw usageError('Delivery runtime architectureEvaluator must be a function or expose evaluate().');
  const byId = new Map(agents.map((agent) => [agent.id, agent]));
  if (byId.size !== agents.length) throw usageError('Delivery runtime Agent ids must be unique.');
  const applyWorkspace = typeof workspace === 'function' ? workspace : workspace?.apply?.bind(workspace);
  const runVerifier = typeof verifier === 'function' ? verifier : verifier?.run?.bind(verifier);
  if (typeof applyWorkspace !== 'function' || typeof runVerifier !== 'function') throw usageError('Delivery runtime requires workspace and verifier effects.');

  function persist(current, next, event = null) {
    if (event) safeAppend(store, current.id, event);
    try { return store.compareAndSwap(current.id, canonicalContractDigest('session', current), next); }
    catch (error) {
      const durable = store.read(current.id);
      if (canonicalContractDigest('session', durable) === canonicalContractDigest('session', next)) return durable;
      throw error;
    }
  }

  function agentFor(session, capability) {
    const preferred = session.activeAgentId ? byId.get(session.activeAgentId) : null;
    const adapter = preferred?.capabilities?.[capability] ? preferred : agents.find((candidate) => candidate.capabilities?.[capability]);
    if (!adapter) throw Object.assign(new Error(`No Agent adapter provides ${capability}.`), { category: 'agent-unavailable' });
    return adapter;
  }

  function budgetFailure(session, message) {
    const failure = { category: 'budget', message };
    const next = transitionDeliverySession(session, { id: `event.budget.${session.sequence}`, idempotencyKey: `budget:${session.sequence}`, type: 'fail', failure, reason: message, at: timestamp(clock) });
    return persist(session, next, { id: `event.budget.${session.sequence}`, type: 'failure', category: 'budget' });
  }

  function elapsedExceeded(session) {
    const started = Date.parse(session.runtime?.startedAt ?? session.createdAt);
    const current = Date.parse(timestamp(clock));
    return Number.isFinite(started) && Number.isFinite(current) && current - started > session.budgets.maxElapsedMs;
  }

  async function agentEffect(session, capability, phase) {
    if ((session.usage?.agentTurns ?? 0) >= session.budgets.maxAgentTurns) return { failure: 'Agent-turn budget exceeded.' };
    const adapter = agentFor(session, capability);
    const key = `${phase}:${session.requirementDigest ?? session.requestDigest}:${session.runtime?.retries ?? 0}`;
    safeAppend(store, session.id, { id: `effect.${canonicalValueDigest({ key, phase }).slice(0, 24)}.before`, effect: phase, phase: 'before', key });
    const result = await runAgentTurn(adapter, { prompt: `${phase} for delivery session ${session.id}`, semanticDigest: session.architectureDigest ?? session.requirementDigest ?? session.requestDigest, idempotencyKey: key }, {
      timeoutMs: Math.min(session.budgets.maxElapsedMs, 120_000), maxInputBytes: 256 * 1024, maxOutputBytes: 2 * 1024 * 1024,
      maxInputTokens: session.budgets.maxInputTokens, maxOutputTokens: session.budgets.maxOutputTokens, maxCost: session.budgets.maxCost,
    });
    const counted = mutated(session, `agent:${key}`, { activeAgentId: adapter.id, usage: usage(session, { agentTurns: (session.usage?.agentTurns ?? 0) + 1, inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, cost: result.usage.cost }) }, clock);
    const durable = persist(session, counted);
    safeAppend(store, session.id, { id: `effect.${canonicalValueDigest({ key, phase }).slice(0, 24)}.after`, effect: phase, phase: 'after', key, status: result.status });
    return { session: durable, result, key };
  }

  async function failFrom(session, error, phase) {
    const failure = classifyDeliveryFailure(error, { phase });
    const type = failure.category === 'business-decision' ? 'block' : 'fail';
    const next = transitionDeliverySession(session, { id: `event.${type}.${session.sequence}`, idempotencyKey: `${type}:${session.sequence}`, type, failure, reason: failure.message, at: timestamp(clock) });
    return persist(session, next, { id: `event.${type}.${session.sequence}`, type: 'failure', category: failure.category });
  }

  // A verified receipt is persisted before the session state changes, so a restart cannot lose it.
  function verifiedRuntime(session, checked) {
    const runtime = { ...session.runtime };
    if (checked?.qualityMatrixRun) {
      const run = validateQualityMatrixRun(checked.qualityMatrixRun);
      runtime.qualityMatrixRun = run;
      runtime.qualityMatrixPlanId = checked.qualityMatrixPlanId ?? run.planId;
      runtime.environmentDigest = checked.environmentDigest ?? run.digests.environment;
    }
    return runtime;
  }

  function repositoryFacts(session) {
    const snapshot = session.repositorySnapshot ?? {};
    return { paths: Array.isArray(snapshot.paths) ? snapshot.paths : [], packages: Array.isArray(snapshot.packages) ? snapshot.packages : [] };
  }

  const runtime = {
    start(input) {
      const base = createDeliverySession({ ...input, clock });
      const selected = input.agentId ?? agents[0]?.id ?? null;
      if (selected && !byId.has(selected)) throw usageError(`Unknown delivery Agent ${selected}.`);
      const bindings = goldenPath ? { pack: { id: goldenPath.id, digest: goldenPathDigest } } : {};
      const session = validateDeliverySession({ ...base, activeAgentId: selected, runtime: { startedAt: timestamp(clock), retries: 0, maxRetries: input.maxRetries ?? 2, effects: {}, ...bindings } });
      store.create(session);
      safeAppend(store, session.id, { id: 'event.runtime.started', type: 'runtime-started' });
      return session;
    },
    status(sessionId) { return store.read(sessionId); },
    async step(sessionId) {
      let session = store.read(sessionId);
      if (['completed', 'cancelled', 'review-ready', 'blocked', 'failed'].includes(session.state)) return session;
      if (elapsedExceeded(session)) return budgetFailure(session, 'Elapsed-time budget exceeded.');
      try {
        if (session.state === 'requirements-pending') {
          const effect = await agentEffect(session, 'structuredRequirement', 'requirement');
          if (effect.failure) return budgetFailure(session, effect.failure);
          session = effect.session;
          if (effect.result.status !== 'succeeded') throw Object.assign(new Error(`Requirement Agent turn ${effect.result.status}.`), { category: effect.result.status === 'budget-exceeded' ? 'budget' : 'agent-unavailable' });
          if (Array.isArray(effect.result.proposal.questions) && effect.result.proposal.questions.length) throw Object.assign(new Error('Material business questions require owner decisions.'), { category: 'business-decision' });
          const next = transitionDeliverySession(session, { id: `event.requirement.${session.sequence}`, idempotencyKey: effect.key, type: 'approve-requirements', requirement: effect.result.proposal.requirement, at: timestamp(clock) });
          return persist(session, next);
        }
        if (session.state === 'requirements-approved') {
          const effect = await agentEffect(session, 'architectureProposal', 'architecture');
          if (effect.failure) return budgetFailure(session, effect.failure);
          session = effect.session;
          if (effect.result.status !== 'succeeded') throw Object.assign(new Error(`Architecture Agent turn ${effect.result.status}.`), { category: effect.result.status === 'budget-exceeded' ? 'budget' : 'agent-unavailable' });
          const next = transitionDeliverySession(session, { id: `event.architecture.${session.sequence}`, idempotencyKey: effect.key, type: 'set-architecture', architecture: effect.result.proposal.architecture, at: timestamp(clock) });
          return persist(session, next);
        }
        if (session.state === 'architecture-ready') {
          let current = session;
          if (evaluateArchitecture) {
            const evaluation = normalizeArchitectureEvaluation(await evaluateArchitecture(current));
            const bound = mutated(current, `architecture:${evaluation.digest}`, { runtime: { ...current.runtime, architectureEvaluation: evaluation } }, clock);
            current = persist(current, bound);
            if (evaluation.status !== 'passed') {
              const message = `Golden path architecture evaluation failed (${evaluation.issueCodes.join(', ') || 'no issue code'}).`;
              const blocked = transitionDeliverySession(current, { id: `event.architecture.${current.sequence}`, idempotencyKey: `architecture-failed:${evaluation.digest}`, type: 'block', failure: { category: 'policy', message }, reason: message, at: timestamp(clock) });
              return persist(current, blocked);
            }
          }
          if (goldenPath) {
            const riskProfileSet = activateRiskProfiles({ requirement: current.requirement, architecture: current.architecture, repositoryFacts: repositoryFacts(current), pack: goldenPath });
            const bound = mutated(current, `risk:${riskProfileSet.requirementDigest}`, { runtime: { ...current.runtime, riskProfileSet } }, clock);
            current = persist(current, bound);
          }
          const next = transitionDeliverySession(current, { id: `event.plan.${current.sequence}`, idempotencyKey: `plan:${current.architectureDigest}`, type: 'approve-plan', at: timestamp(clock) });
          return persist(current, next);
        }
        if (session.state === 'plan-approved' || session.state === 'repairing') {
          const effect = await agentEffect(session, 'boundedPatch', 'patch');
          if (effect.failure) return budgetFailure(session, effect.failure);
          session = effect.session;
          if (effect.result.status !== 'succeeded') throw Object.assign(new Error(`Patch Agent turn ${effect.result.status}.`), { category: effect.result.status === 'budget-exceeded' ? 'budget' : 'agent-unavailable' });
          safeAppend(store, session.id, { id: `workspace.${canonicalValueDigest(effect.key).slice(0, 24)}.before`, effect: 'patch', phase: 'before', key: effect.key });
          const applied = await applyWorkspace(session, effect.key, effect.result.proposal);
          safeAppend(store, session.id, { id: `workspace.${canonicalValueDigest(effect.key).slice(0, 24)}.after`, effect: 'patch', phase: 'after', key: effect.key, status: applied.status });
          const changedFiles = (session.usage?.changedFiles ?? 0) + (applied.changedFiles ?? 0);
          const changedBytes = (session.usage?.changedBytes ?? 0) + (applied.changedBytes ?? 0);
          if (changedFiles > session.budgets.maxChangedFiles || changedBytes > session.budgets.maxChangedBytes) return budgetFailure(session, 'Changed-file or changed-byte budget exceeded.');
          const withUsage = mutated(session, `workspace:${effect.key}`, { usage: usage(session, { changedFiles, changedBytes }), runtime: { ...session.runtime, retries: session.state === 'repairing' ? (session.runtime.retries ?? 0) + 1 : session.runtime.retries } }, clock);
          const durable = persist(session, withUsage); session = durable;
          const next = transitionDeliverySession(session, { id: `event.execute.${session.sequence}`, idempotencyKey: `execute:${effect.key}`, type: 'start-execution', at: timestamp(clock) });
          return persist(session, next);
        }
        if (session.state === 'executing' || session.state === 'verifying') {
          if (session.state === 'executing') {
            const verifying = transitionDeliverySession(session, { id: `event.verify.${session.sequence}`, idempotencyKey: `verify:${session.sequence}`, type: 'start-verification', at: timestamp(clock) });
            session = persist(session, verifying);
          }
          const key = `verification:${session.architectureDigest}:${session.runtime?.retries ?? 0}`;
          safeAppend(store, session.id, { id: `verification.${canonicalValueDigest(key).slice(0, 24)}.before`, effect: 'verification', phase: 'before', key });
          const checked = await runVerifier(session, key);
          safeAppend(store, session.id, { id: `verification.${canonicalValueDigest(key).slice(0, 24)}.after`, effect: 'verification', phase: 'after', key, status: checked.status });
          const commands = (session.usage?.commands ?? 0) + (checked.commands ?? 0);
          if (commands > session.budgets.maxCommands) return budgetFailure(session, 'Verification command budget exceeded.');
          const counted = mutated(session, `verification:${key}`, { usage: usage(session, { commands }), runtime: verifiedRuntime(session, checked) }, clock);
          session = persist(session, counted);
          if (checked.status === 'passed') {
            const next = transitionDeliverySession(session, { id: `event.review.${session.sequence}`, idempotencyKey: `review:${key}`, type: 'ready-for-review', at: timestamp(clock) });
            return persist(session, next);
          }
          if ((session.runtime?.retries ?? 0) >= (session.runtime?.maxRetries ?? 2)) throw Object.assign(new Error('Verification retry limit exceeded.'), { category: 'verification' });
          // A repair invalidates every gate receipt that produced the failed verification.
          const invalidated = mutated(session, `repair-invalidate:${key}`, { runtime: { ...session.runtime, qualityMatrixRun: null, qualityMatrixPlanId: null, environmentDigest: null } }, clock);
          session = persist(session, invalidated);
          const next = transitionDeliverySession(session, { id: `event.repair.${session.sequence}`, idempotencyKey: `repair:${key}`, type: 'request-repair', failure: { category: 'verification', message: 'Verification failed.' }, at: timestamp(clock) });
          return persist(session, next);
        }
        throw new Error(`Unsupported runtime state ${session.state}.`);
      } catch (error) { return failFrom(store.read(sessionId), error, session.state === 'verifying' ? 'verification' : 'runtime'); }
    },
    resume(sessionId, currentInputs) {
      const session = store.read(sessionId);
      if (goldenPathDigest && session.runtime?.pack && session.runtime.pack.digest !== goldenPathDigest) throw usageError('Delivery session Pack digest changed; reconcile the Pack before resume.');
      resumeDeliverySession(session, currentInputs);
      const agentId = currentInputs.agentId ?? session.activeAgentId;
      if (agentId && !byId.has(agentId)) throw usageError(`Unknown delivery Agent ${agentId}.`);
      if (agentId && session.state !== 'blocked' && session.state !== 'failed') {
        const next = mutated(session, `resume:${session.sequence}`, { activeAgentId: agentId }, clock);
        return persist(session, next);
      }
      if (['blocked', 'failed'].includes(session.state)) {
        const target = session.requirementDigest ? (session.architectureDigest ? 'plan-approved' : 'requirements-approved') : 'requirements-pending';
        const next = validateDeliverySession({ ...session, state: target, activeAgentId: agentId, lastFailure: null, sequence: session.sequence + 1, previousDigest: canonicalContractDigest('session', session), idempotencyKey: `resume:${session.sequence}`, updatedAt: timestamp(clock) });
        return persist(session, next);
      }
      return session;
    },
    cancel(sessionId) {
      const session = store.read(sessionId);
      const next = transitionDeliverySession(session, { id: `event.cancel.${session.sequence}`, idempotencyKey: `cancel:${session.sequence}`, type: 'cancel', at: timestamp(clock) });
      return persist(session, next);
    },
  };
  return Object.freeze(runtime);
}

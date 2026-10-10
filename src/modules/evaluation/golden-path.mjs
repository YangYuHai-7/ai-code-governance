import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest, isSafeRelative } from '../../shared/index.mjs';
import { GOLDEN_PATH_EVALUATION_VERSION, validateGoldenPathEvaluation } from './contracts.mjs';

function requireSafeRequirementPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || !isSafeRelative(value)) throw usageError('Golden path requirement must be exactly one safe repository-relative path.');
  return value;
}

function requireSafeOutputPath(value) {
  if (typeof value !== 'string' || value.length === 0 || value.length > 1024 || !isSafeRelative(value)) throw usageError('Golden path evaluation output must be a safe repository-relative path.');
  return value;
}

function emptyMatrix(status = 'not-run') { return { status, runId: null, requiredGateIds: [], resolvedGateIds: [] }; }

function turnFailed(turn) { return !turn || turn.status !== 'succeeded'; }

export async function runGoldenPathEvaluation(input, dependencies) {
  if (!dependencies || typeof dependencies !== 'object') throw usageError('Golden path evaluation requires injected dependencies.');
  const packId = input?.packId;
  if (!Array.isArray(dependencies.packs?.ids) || !dependencies.packs.ids.includes(packId)) throw usageError(`Unknown Pack ${packId ?? 'missing'}.`);
  const requirementPath = requireSafeRequirementPath(input?.requirement);
  if (input?.output !== undefined && input.output !== null) requireSafeOutputPath(input.output);
  const agentId = input?.agent ?? dependencies.agent?.id ?? null;
  if (agentId !== null && (!Array.isArray(dependencies.agents?.ids) || !dependencies.agents.ids.includes(agentId))) throw usageError(`Unknown Agent ${agentId}.`);
  const clock = dependencies.clock ?? (() => new Date().toISOString());
  const preflight = dependencies.preflight ?? { status: 'blocked', checks: [] };
  const document = dependencies.readRequirement?.(requirementPath) ?? {};
  const agent = { id: agentId ?? 'none', version: dependencies.agent?.version ?? null, real: dependencies.agent?.real === true, live: input?.liveAgent === true };
  const gaps = [];
  const failures = [];
  const base = {
    schemaVersion: GOLDEN_PATH_EVALUATION_VERSION,
    id: `golden-path-evaluation.${canonicalValueDigest({ packId, requirementPath, agent: agent.id }).slice(0, 24)}`,
    packId, agent, requirementPath,
    requirementDigest: canonicalValueDigest(document),
    level: 'E0-generated', verdict: 'incomplete',
    environment: { digest: canonicalValueDigest(preflight), capabilities: preflight.checks ?? [] },
    matrix: emptyMatrix('not-run'),
    trace: { requirement: document.id ?? null, architecture: null, patch: null, test: null, evidence: null, review: null },
    budget: { agentTurns: 0, elapsedMs: 0 },
    failureHistory: [], cleanup: dependencies.cleanup ?? { status: 'clean', reason: null },
    entrypoint: document.entrypoint ?? null, rollback: document.rollback ?? null,
    gaps, evaluatedAt: clock(),
  };
  if (preflight.status !== 'passed') {
    for (const check of preflight.checks ?? []) if (check.status !== 'passed') gaps.push(`${check.name}: ${check.detail}`);
    base.verdict = 'blocked';
    base.matrix = emptyMatrix('blocked');
    return validateGoldenPathEvaluation(base);
  }
  if (dependencies.probes?.status === 'passed') base.level = 'E1-deterministic';
  else gaps.push('deterministic negative probes did not pass.');
  if (!base.entrypoint) gaps.push('the requirement does not declare a runnable local entrypoint.');
  if (!base.rollback) gaps.push('the requirement does not declare rollback or forward-recovery instructions.');
  if (input?.liveAgent !== true) {
    gaps.push('live agent execution requires --live-agent.');
    return validateGoldenPathEvaluation(base);
  }
  const turns = dependencies.turns ?? {};
  let failed = false;
  const requirementTurn = await turns.requirement?.({ phase: 'requirement', authority: 'read-only' });
  base.budget.agentTurns += 1;
  if (turnFailed(requirementTurn)) { failures.push('requirement turn failed'); failed = true; }
  const architectureTurn = await turns.architecture?.({ phase: 'architecture', authority: 'read-only' });
  base.budget.agentTurns += 1;
  if (turnFailed(architectureTurn)) { failures.push('architecture turn failed'); failed = true; }
  const patchTurn = await turns.patch?.({ phase: 'patch', authority: 'workspace-write' });
  base.budget.agentTurns += 1;
  if (turnFailed(patchTurn)) { failures.push('patch turn failed'); failed = true; }
  const unauthorized = Array.isArray(patchTurn?.unauthorizedPaths) ? patchTurn.unauthorizedPaths : [];
  if (unauthorized.length) { failures.push(`authority violation: ${unauthorized.join(', ')}`); failed = true; }
  const reviewTurn = await turns.review?.({ phase: 'independent-review', authority: 'read-only' });
  base.budget.agentTurns += 1;
  if (turnFailed(reviewTurn)) { failures.push('independent review turn failed'); failed = true; }
  if (reviewTurn?.authority && reviewTurn.authority !== 'read-only') { failures.push('independent review must run with read-only authority.'); failed = true; }
  base.trace.architecture = turnFailed(architectureTurn) ? null : 'architecture.proposal';
  base.trace.patch = turnFailed(patchTurn) ? null : 'patch.proposal';
  base.trace.review = 'independent-review';
  const matrix = dependencies.matrix ?? emptyMatrix('not-run');
  base.matrix = {
    status: ['passed', 'failed', 'blocked', 'not-run'].includes(matrix.status) ? matrix.status : 'not-run',
    runId: matrix.runId ?? null,
    requiredGateIds: Array.isArray(matrix.requiredGateIds) ? [...matrix.requiredGateIds] : [],
    resolvedGateIds: Array.isArray(matrix.resolvedGateIds) ? [...matrix.resolvedGateIds] : [],
  };
  if (base.matrix.status === 'passed') {
    base.level = 'E2-integrated';
    base.trace.test = 'quality-matrix.tests';
    base.trace.evidence = base.matrix.runId;
  } else {
    gaps.push(`the quality matrix is ${base.matrix.status}; required gates must pass with current evidence.`);
  }
  for (const path of unauthorized) gaps.push(`Agent changed paths outside its authority: ${path}`);
  if (reviewTurn?.authority && reviewTurn.authority !== 'read-only') gaps.push('the independent review turn must be read-only.');
  if (failures.some((entry) => entry.startsWith('authority'))) gaps.push('workspace authority was exceeded.');
  if (!failed && base.level === 'E2-integrated') {
    if (agent.real !== true) gaps.push('E3 requires a real adapter; installed-command detection alone proves no capability.');
    else {
      base.level = 'E3-agent-executable';
      base.trace.evidence = base.matrix.runId;
    }
  }
  base.failureHistory = [...failures];
  base.verdict = failed ? 'failed' : base.level === 'E3-agent-executable' ? 'passed' : 'incomplete';
  return validateGoldenPathEvaluation(base);
}

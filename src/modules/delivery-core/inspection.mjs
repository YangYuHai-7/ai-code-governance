import { canonicalValueDigest } from '../../shared/index.mjs';
import { validateDeliverySession } from './contracts.mjs';
import { qualityMatrixState } from './quality-matrix-current.mjs';
import { validateRiskProfileSet } from './risk-profiles.mjs';

const STATE_PRESENTATION = Object.freeze({
  draft: ['requirements', 'needs-decision', 'The delivery requirement is still a draft.', 'Complete the material requirement decisions.'],
  'requirements-pending': ['requirements', 'needs-decision', 'Requirements are pending material decisions.', 'Resolve the material requirement questions.'],
  'requirements-approved': ['architecture', 'needs-decision', 'Requirements are approved and architecture is pending.', 'Review and approve the architecture proposal.'],
  'architecture-ready': ['planning', 'needs-decision', 'Architecture is ready and the bounded plan is pending.', 'Review and approve the bounded implementation plan.'],
  'plan-approved': ['execution', 'ready', 'The bounded plan is approved.', 'Start execution within the approved authority.'],
  executing: ['execution', 'in-progress', 'Implementation is in progress.', 'Continue the bounded implementation step.'],
  verifying: ['verification', 'in-progress', 'Verification is running.', 'Wait for required verification evidence.'],
  repairing: ['repair', 'in-progress', 'A failed verification is being repaired.', 'Apply the permitted repair and rerun invalidated evidence.'],
  'review-ready': ['review', 'ready', 'Automated work is ready for review.', 'Complete the required independent and human review.'],
  blocked: ['recovery', 'blocked', 'Delivery is blocked.', 'Resolve the recorded blocker before resuming.'],
  failed: ['recovery', 'failed', 'Delivery failed.', 'Inspect the failure and resume only from valid bound inputs.'],
  completed: ['result', 'completed', 'Delivery is complete.', 'Inspect the retained evidence and rollback information.'],
  cancelled: ['result', 'cancelled', 'Delivery was cancelled.', 'Start a new delivery session to continue this work.'],
});

const VOLATILE = ['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt', 'completedAt'];

function deepClone(value) {
  if (Array.isArray(value)) return value.map(deepClone);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, deepClone(entry)]));
  return value;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function decisionsFor(session) {
  const requirement = session.requirement;
  if (!requirement) return [];
  return [
    ...requirement.openQuestions.map((entry) => ({ id: entry.id, kind: 'question', status: entry.status, text: entry.question })),
    ...requirement.ownerDecisions.map((entry) => ({ id: entry.id, kind: 'owner-decision', status: entry.status, text: entry.decision })),
  ];
}

function evidenceFor(session) {
  const riskProfileSet = session.runtime?.riskProfileSet ? validateRiskProfileSet(session.runtime.riskProfileSet) : null;
  const matrix = qualityMatrixState(session, riskProfileSet);
  if (!matrix) return { summary: { status: 'incomplete', required: 0, passed: 0, failed: 0, missing: 0 }, source: null, matrix: null };
  const { run, stale, uncovered } = matrix;
  const current = stale.length === 0;
  const passed = current ? run.results.filter((entry) => entry.status === 'passed').length : 0;
  const failed = current ? run.results.filter((entry) => entry.status === 'failed').length : 0;
  const required = new Set([...run.requiredGateIds, ...(riskProfileSet?.requiredGateIds ?? [])]).size;
  return { source: run, matrix, summary: {
    status: current && uncovered.length === 0 && matrix.blockedProfiles.length === 0 ? run.status === 'passed' ? 'passed' : run.status === 'failed' ? 'failed' : 'incomplete' : 'incomplete',
    required, passed, failed,
    missing: required - passed - failed,
  } };
}

function risksFor(session, matrix, matrixMissing) {
  const risks = [];
  if (session.lastFailure) risks.push({ code: 'last-failure', severity: 'blocking', detail: session.lastFailure.message ?? session.lastFailure.category ?? 'Delivery failed.' });
  if (matrixMissing) risks.push({ code: 'quality-matrix-missing', severity: 'blocking', detail: 'Required quality matrix receipt is missing.' });
  if (matrix?.stale.length) risks.push({ code: 'quality-matrix-stale', severity: 'blocking', detail: `Quality matrix receipt is stale for ${matrix.stale.join(', ')}.` });
  if (matrix?.uncovered.length) risks.push({ code: 'quality-matrix-uncovered', severity: 'blocking', detail: `Quality matrix receipt does not cover activated gates ${matrix.uncovered.join(', ')}.` });
  if (matrix?.blockedProfiles.length) risks.push({ code: 'risk-profile-blocked', severity: 'blocking', detail: `Owner decision required for risk profiles ${matrix.blockedProfiles.join(', ')}.` });
  if (matrix && matrix.run.status !== 'passed') risks.push({ code: 'quality-matrix-failed', severity: 'blocking', detail: `Quality matrix receipt status is ${matrix.run.status}.` });
  for (const key of ['maxAgentTurns', 'maxCommands', 'maxChangedFiles', 'maxChangedBytes']) {
    const usageKey = key.slice(3, 4).toLowerCase() + key.slice(4);
    const used = session.usage?.[usageKey];
    const limit = session.budgets[key];
    if (Number.isFinite(used) && Number.isFinite(limit) && used >= limit) risks.push({ code: `budget:${key}`, severity: 'blocking', detail: `${usageKey} reached ${used} of ${limit}.` });
  }
  for (const risk of session.architecture?.risks ?? []) risks.push({ code: `architecture:${risk.id}`, severity: 'open', detail: risk.statement });
  return risks;
}

export function projectDeliveryInspection(session) {
  const current = validateDeliverySession(session);
  const evidence = evidenceFor(current);
  const reviewEvidenceRequired = ['review-ready', 'completed'].includes(current.state);
  const matrixMissing = reviewEvidenceRequired && Boolean(current.runtime?.pack) && !evidence.matrix;
  const evidenceBlocked = reviewEvidenceRequired && (matrixMissing || (evidence.matrix && evidence.summary.status !== 'passed'));
  const presentation = evidenceBlocked
    ? [current.state === 'completed' ? 'result' : 'review', 'blocked', 'Canonical state is retained, but required verification evidence is not current.', 'Rerun required verification before relying on this result.']
    : STATE_PRESENTATION[current.state];
  const base = {
    schemaVersion: 1,
    sessionId: current.id,
    sequence: current.sequence,
    state: current.state,
    updatedAt: current.updatedAt ?? null,
    guided: {
      stage: presentation[0],
      status: presentation[1],
      summary: presentation[2],
      nextAction: presentation[3],
      decisions: decisionsFor(current),
      risks: risksFor(current, evidence.matrix, matrixMissing),
      evidence: evidence.summary,
      recovery: {
        available: current.checkpoints.length > 0 && !['completed', 'cancelled'].includes(current.state),
        checkpointCount: current.checkpoints.length,
        lastFailure: current.lastFailure ?? null,
      },
    },
    expert: {
      digests: {
        request: current.requestDigest,
        requirement: current.requirementDigest,
        architecture: current.architectureDigest,
        authority: current.authorityDigest,
        repository: current.repositoryDigest,
        previous: current.previousDigest,
      },
      authority: current.authority ?? null,
      budgets: current.budgets,
      usage: current.usage ?? null,
      evidence: evidence.source,
      checkpoints: current.checkpoints,
      lastFailure: current.lastFailure ?? null,
      activeAgentId: current.activeAgentId ?? null,
    },
  };
  const result = { ...base, semanticDigest: canonicalValueDigest(base, { omit: VOLATILE }) };
  return deepFreeze(deepClone(result));
}

import { validateQualityMatrixRun } from './quality-matrix.mjs';
import { riskProfileSetDigest } from './risk-profiles.mjs';

// Both Runtime and completion must use one freshness rule for a retained matrix receipt.
export function qualityMatrixState(session, riskProfileSet) {
  if (!session.runtime?.qualityMatrixRun) return null;
  const run = validateQualityMatrixRun(session.runtime.qualityMatrixRun);
  const stale = [];
  if (run.digests.requirement !== session.requirementDigest) stale.push('requirement');
  if (run.digests.architecture !== session.architectureDigest) stale.push('architecture');
  if (run.digests.repository !== session.repositoryDigest) stale.push('repository');
  const packDigest = session.runtime?.pack?.digest ?? null;
  if (packDigest && run.digests.pack !== packDigest) stale.push('pack');
  if (packDigest && !riskProfileSet) stale.push('risk missing');
  if (packDigest && riskProfileSet && riskProfileSet.packDigest !== packDigest) stale.push('risk pack');
  if (riskProfileSet && riskProfileSet.requirementDigest !== session.requirementDigest) stale.push('risk requirement');
  if (riskProfileSet && run.digests.risk !== riskProfileSetDigest(riskProfileSet)) stale.push('risk');
  const environmentDigest = session.runtime?.environmentDigest ?? null;
  if (packDigest && !environmentDigest) stale.push('environment missing');
  if (environmentDigest && run.digests.environment !== environmentDigest) stale.push('environment');
  const planId = session.runtime?.qualityMatrixPlanId ?? null;
  if (packDigest && !planId) stale.push('plan missing');
  if (planId && run.planId !== planId) stale.push('plan');
  const activated = riskProfileSet?.requiredGateIds ?? [];
  const uncovered = activated.filter((gateId) => !run.requiredGateIds.includes(gateId));
  const blockedProfiles = riskProfileSet?.profiles.filter((profile) => profile.applicability === 'blocked').map((profile) => profile.id) ?? [];
  return { run, stale, uncovered, blockedProfiles };
}

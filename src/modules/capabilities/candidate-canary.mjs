import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';

// Canary evidence decides between monitoring and rollback. The originating project's own
// observations never count as independent validation of the policy it proposed.
export function evaluateCandidateCanary({ candidate, canary = {}, thresholdPolicy = {} } = {}) {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw usageError('canaryEvaluation.candidate.id is required.');
  }
  const observations = Array.isArray(canary.observations) ? canary.observations : [];
  if (!Array.isArray(canary.observations ?? [])) throw usageError('canaryEvaluation.canary.observations must be an array.');
  observations.forEach((entry, index) => {
    if (!entry || typeof entry !== 'object' || typeof entry.projectId !== 'string' || entry.projectId.length === 0) {
      throw usageError(`canaryEvaluation.canary.observations[${index}].projectId is required.`);
    }
    if (typeof entry.passed !== 'boolean') throw usageError(`canaryEvaluation.canary.observations[${index}].passed must be a boolean.`);
    if (entry.regressions !== undefined && !Array.isArray(entry.regressions)) throw usageError(`canaryEvaluation.canary.observations[${index}].regressions must be an array.`);
  });
  const windowDays = Number.isSafeInteger(canary.windowDays) ? canary.windowDays : 0;
  const minimumWindowDays = Number.isSafeInteger(thresholdPolicy.minimumWindowDays) ? thresholdPolicy.minimumWindowDays : 1;
  const minimumIndependentProjects = Number.isSafeInteger(thresholdPolicy.minimumIndependentProjects) ? thresholdPolicy.minimumIndependentProjects : 1;
  const independent = new Set(observations.map((entry) => entry.projectId).filter((projectId) => projectId !== candidate.projectId));
  const regressions = observations.flatMap((entry) => (Array.isArray(entry.regressions) ? entry.regressions : []));
  const failedObservation = observations.some((entry) => entry.passed !== true);
  const reason = regressions.length > 0 || failedObservation ? 'canary-regression'
    : independent.size < minimumIndependentProjects ? 'no-independent-observation'
      : windowDays < minimumWindowDays ? 'window-too-short'
        : null;
  const evidence = Object.freeze({
    candidateId: candidate.id,
    projectIds: Object.freeze([...independent].sort()),
    observationCount: observations.length,
    regressions: Object.freeze(regressions),
    windowDays,
    monitoredWindowPassed: reason === null,
    reason,
    digest: canonicalValueDigest({ candidateId: candidate.id, observations, windowDays, thresholdPolicy }),
  });
  return Object.freeze({ status: reason === null ? 'passed' : 'failed', action: reason === null ? 'monitor' : 'rollback', evidence });
}

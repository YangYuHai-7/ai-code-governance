import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';

export const OFFLINE_OUTCOMES = Object.freeze(['pass', 'fail']);

function failedEvidence(candidate, cases, reason) {
  return Object.freeze({
    candidateId: candidate.id,
    caseCount: cases.length,
    regressions: Object.freeze([]),
    reason,
    digest: canonicalValueDigest({ candidateId: candidate.id, cases, reason }),
    evaluatedAt: null,
  });
}

// Offline evaluation is the gate between an observed candidate and independent review: a candidate
// that regresses the regression corpus, or that is not evaluated at all, cannot pass.
export function evaluateCandidateOffline({ candidate, cases = [], thresholdPolicy = {}, clock = null } = {}) {
  if (!candidate || typeof candidate !== 'object' || typeof candidate.id !== 'string' || candidate.id.length === 0) {
    throw usageError('offlineEvaluation.candidate.id is required.');
  }
  if (!Array.isArray(cases)) throw usageError('offlineEvaluation.cases must be an array.');
  if (cases.length === 0) return Object.freeze({ status: 'failed', evidence: failedEvidence(candidate, cases, 'no-cases') });
  const seen = new Set();
  for (const [index, entry] of cases.entries()) {
    const path = `offlineEvaluation.cases[${index}]`;
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || entry.id.length === 0) throw usageError(`${path}.id is required.`);
    if (seen.has(entry.id)) throw usageError(`${path}.id: duplicate case ${entry.id}`);
    seen.add(entry.id);
    if (!OFFLINE_OUTCOMES.includes(entry.expected)) throw usageError(`${path}.expected must be pass or fail`);
    if (!OFFLINE_OUTCOMES.includes(entry.actual)) throw usageError(`${path}.actual must be pass or fail`);
  }
  const regressions = Object.freeze(cases.filter((entry) => entry.expected !== entry.actual).map((entry) => entry.id));
  const minimumCases = Number.isSafeInteger(thresholdPolicy.minimumCases) ? thresholdPolicy.minimumCases : 0;
  const maximumRegressions = Number.isSafeInteger(thresholdPolicy.maximumRegressions) ? thresholdPolicy.maximumRegressions : 0;
  const reason = cases.length < minimumCases ? 'insufficient-cases'
    : regressions.length > maximumRegressions ? 'regressions'
      : null;
  const evidence = Object.freeze({
    candidateId: candidate.id,
    caseCount: cases.length,
    regressions,
    reason,
    digest: canonicalValueDigest({ candidateId: candidate.id, cases, thresholdPolicy }),
    evaluatedAt: typeof clock === 'function' ? clock() : null,
  });
  return Object.freeze({ status: reason === null ? 'passed' : 'failed', evidence });
}

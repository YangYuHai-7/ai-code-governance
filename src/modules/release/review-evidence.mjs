import { usageError } from '../../kernel/index.mjs';
import { evaluateReviewFindings } from './review-findings.mjs';
import { evaluateReviewIndependence } from './review-separation.mjs';

// One builder so a caller cannot record review evidence that the completion gate would reject.
export function buildReviewEvidence({ risk = 'standard', sessions, findings = [], approver = null, implementerIdentity = null } = {}) {
  if (!Array.isArray(sessions)) throw usageError('reviewEvidence.sessions must be an array.');
  const separation = evaluateReviewIndependence({ risk, sessions });
  const reviewFindings = Array.isArray(findings) ? findings : [];
  const evaluation = evaluateReviewFindings({ findings: reviewFindings, approver, implementerIdentity });
  const gaps = [
    ...separation.gaps.map((gap) => `review-independence:${gap.code}: ${gap.detail}`),
    ...evaluation.gaps.map((gap) => `review-finding:${gap.code}: ${gap.detail}`),
  ];
  const runtime = Object.freeze({
    reviewRisk: risk,
    reviewSessions: Object.freeze(sessions.map((entry) => Object.freeze({ ...entry }))),
    ...(reviewFindings.length > 0 ? { reviewFindings: Object.freeze(reviewFindings.map((entry) => Object.freeze({ ...entry }))) } : {}),
    ...(approver ? { reviewApprover: Object.freeze({ ...approver }) } : {}),
    ...(implementerIdentity ? { implementerIdentity } : {}),
  });
  return Object.freeze({ status: gaps.length === 0 ? 'ready' : 'blocked', gaps: Object.freeze(gaps), runtime });
}

import { usageError } from '../../kernel/index.mjs';

export const REVIEW_SEVERITIES = Object.freeze(['info', 'minor', 'major', 'critical']);
export const REVIEW_DISPOSITIONS = Object.freeze(['open', 'resolved', 'accepted-risk', 'rejected']);
const FINDING_FIELDS = Object.freeze(['id', 'role', 'severity', 'statement', 'evidence', 'proposedResolution', 'disposition', 'owner']);

// Structured findings are the evidence a review leaves behind: prose alone cannot be dispositioned.
export function validateReviewFinding(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw usageError('reviewFinding must be an object.');
  for (const key of Object.keys(value)) if (!FINDING_FIELDS.includes(key)) throw usageError(`reviewFinding.${key} is not supported`);
  for (const key of FINDING_FIELDS) {
    if (!Object.hasOwn(value, key)) throw usageError(`reviewFinding.${key} is required`);
    if (typeof value[key] !== 'string' || value[key].length === 0) throw usageError(`reviewFinding.${key} must be a non-empty string`);
  }
  if (!REVIEW_SEVERITIES.includes(value.severity)) throw usageError('reviewFinding.severity must be info, minor, major, or critical');
  if (!REVIEW_DISPOSITIONS.includes(value.disposition)) throw usageError('reviewFinding.disposition must be open, resolved, accepted-risk, or rejected');
  return Object.freeze({ ...value });
}

export function evaluateReviewFindings({ findings = [], approver = null, implementerIdentity = null } = {}) {
  if (!Array.isArray(findings)) throw usageError('reviewFindings.findings must be an array.');
  const gaps = [];
  const add = (code, detail) => gaps.push(Object.freeze({ code, detail }));
  for (const entry of findings) {
    const current = validateReviewFinding(entry);
    if (current.severity === 'critical' && current.disposition === 'open') add('unresolved-critical', `${current.id} is open at critical severity`);
    if (current.disposition === 'accepted-risk' && (!approver || approver.identityClass !== 'human')) {
      add('risk-without-approver', `${current.id} accepts risk without a human approver`);
    }
    if (implementerIdentity !== null && current.owner === implementerIdentity) add('self-review-finding', `${current.id} is authored by the implementer`);
  }
  return Object.freeze({ status: gaps.length === 0 ? 'clean' : 'blocked', gaps: Object.freeze(gaps) });
}

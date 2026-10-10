import { usageError } from '../../kernel/index.mjs';
import { buildReviewEvidence } from '../release/index.mjs';
import { canonicalContractDigest, validateDeliverySession } from './contracts.mjs';

// Review evidence is recorded only through the validated bundle, so a session can never carry
// evidence the production completion gate would reject.
export function recordReviewEvidence(session, input = {}) {
  let current;
  try { current = validateDeliverySession(session); }
  catch (error) { throw usageError(`reviewEvidence.session: ${error.message}`); }
  const bundle = buildReviewEvidence(input);
  if (bundle.status !== 'ready') return Object.freeze({ status: 'rejected', session: current, gaps: bundle.gaps });
  const digest = canonicalContractDigest('session', current);
  const next = validateDeliverySession({
    ...current,
    sequence: current.sequence + 1,
    previousDigest: digest,
    idempotencyKey: `review-evidence:${digest.slice(0, 16)}`,
    runtime: { ...current.runtime, ...bundle.runtime },
    updatedAt: typeof input.at === 'string' ? input.at : new Date().toISOString(),
  });
  return Object.freeze({ status: 'recorded', session: next, gaps: Object.freeze([]) });
}

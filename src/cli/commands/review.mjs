import path from 'node:path';
import { openDeliverySessionStore, readJson } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { canonicalContractDigest, recordReviewEvidence } from '../../modules/delivery-core/index.mjs';

// Expert write surface: it records validated review evidence into a delivery session and never
// approves, promotes, or completes anything.
export async function reviewCommand(target, action, options = {}) {
  if (action !== 'evidence') throw usageError('review requires an action: evidence.');
  const root = path.resolve(target ?? '.');
  if (typeof options.session !== 'string' || options.session.length === 0) throw usageError('review evidence requires --session <id>.');
  if (typeof options.evidence !== 'string' || options.evidence.length === 0) throw usageError('review evidence requires --evidence <relative-json>.');
  const store = openDeliverySessionStore(root);
  const current = store.read(options.session);
  const input = readJson(path.resolve(root, options.evidence));
  const result = recordReviewEvidence(current, input);
  if (result.status === 'rejected') throw usageError(`review evidence rejected: ${result.gaps.join('; ')}`);
  const persisted = store.compareAndSwap(options.session, canonicalContractDigest('session', current), result.session);
  process.stdout.write(options.json === true
    ? `${JSON.stringify({ status: 'recorded', session: persisted.id, reviewSessions: persisted.runtime.reviewSessions.length, reviewRisk: persisted.runtime.reviewRisk }, null, 2)}\n`
    : `review evidence recorded for ${persisted.id}\n`);
  return persisted;
}

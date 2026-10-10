import { usageError } from '../../kernel/index.mjs';

const NEXT_ACTION = Object.freeze({
  observed: 'deduplicate',
  deduplicated: 'offline-evaluate',
  'offline-evaluated': 'independent-review',
  'independently-reviewed': 'approve',
  approved: 'canary',
  canary: 'monitor',
  monitored: 'promote',
  promoted: 'closed',
  'rolled-back': 'closed',
});

// Read-only view for the human owner: it reports state and the next legal action and never
// transitions a candidate, so reviewing cannot approve or promote anything by itself.
export function describeCandidateReview({ store, candidateId = null } = {}) {
  if (!store || typeof store.read !== 'function') throw usageError('candidateReview.store must expose read().');
  const list = store.read();
  const candidates = Array.isArray(list) ? list : [];
  const selected = candidateId === null ? candidates : candidates.filter((entry) => entry?.id === candidateId);
  if (candidateId !== null && selected.length === 0) throw usageError(`candidateReview: unknown candidate ${candidateId}.`);
  const described = selected.map((entry) => Object.freeze({
    id: entry.id,
    projectId: entry.projectId,
    state: entry.state,
    awaitingDecision: entry.state === 'independently-reviewed',
    nextAction: NEXT_ACTION[entry.state] ?? 'closed',
    historyEvents: Object.freeze((entry.history ?? []).map((record) => record.event)),
    evidenceDigests: Object.freeze((entry.history ?? []).map((record) => record.evidenceDigest).filter(Boolean)),
  }));
  return Object.freeze({
    status: described.length === 0 ? 'empty' : 'ready',
    candidates: Object.freeze(described),
    pendingApprovals: Object.freeze(described.filter((entry) => entry.awaitingDecision).map((entry) => entry.id)),
  });
}

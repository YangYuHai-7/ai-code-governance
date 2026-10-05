const CATEGORIES = new Set(['business-decision', 'agent-unavailable', 'policy', 'patch-conflict', 'verification', 'infrastructure', 'budget', 'stale-input', 'internal']);
const CODE_CATEGORIES = Object.freeze({
  AICG_OWNER_DECISION: 'business-decision',
  AICG_AGENT_UNAVAILABLE: 'agent-unavailable',
  AICG_POLICY: 'policy',
  AICG_PATCH_CONFLICT: 'patch-conflict',
  AICG_VERIFICATION: 'verification',
  AICG_BUDGET: 'budget',
  AICG_STALE_INPUT: 'stale-input',
  ETIMEDOUT: 'infrastructure', EIO: 'infrastructure', ENOSPC: 'infrastructure',
});

export function classifyDeliveryFailure(error, context = {}) {
  const explicit = CATEGORIES.has(error?.category) ? error.category : null;
  const category = explicit ?? CODE_CATEGORIES[error?.code] ?? (context.phase === 'verification' ? 'verification' : 'internal');
  return Object.freeze({ category, message: error?.message ?? String(error ?? 'Unknown delivery failure'), code: error?.code ?? null, retryable: ['agent-unavailable', 'patch-conflict', 'verification', 'infrastructure'].includes(category) });
}

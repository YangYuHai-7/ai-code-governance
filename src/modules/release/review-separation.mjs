import { usageError } from '../../kernel/index.mjs';

const ROLE_SETS = Object.freeze({
  standard: ['implementer', 'reviewer'],
  high: ['implementer', 'reviewer', 'referee'],
  production: ['implementer', 'reviewer', 'referee', 'approver'],
});

export function requiredReviewRoles({ risk = 'standard' } = {}) {
  const roles = ROLE_SETS[risk];
  if (!roles) throw usageError(`reviewSeparation.risk: unsupported risk ${risk}`);
  return Object.freeze([...roles]);
}

// Independence is executed, not declared: every required role needs its own session and identity,
// and no machine identity may stand in for a qualified human approver.
export function evaluateReviewIndependence({ risk = 'standard', sessions = [] } = {}) {
  const required = requiredReviewRoles({ risk });
  if (!Array.isArray(sessions)) throw usageError('reviewSeparation.sessions must be an array.');
  sessions.forEach((entry, index) => {
    const path = `reviewSeparation.sessions[${index}]`;
    if (!entry || typeof entry !== 'object') throw usageError(`${path} must be an object`);
    for (const key of ['role', 'identity', 'sessionId']) {
      if (typeof entry[key] !== 'string' || entry[key].length === 0) throw usageError(`${path}.${key} is required`);
    }
    if (entry.identityClass !== undefined && !['human', 'ai'].includes(entry.identityClass)) throw usageError(`${path}.identityClass must be human or ai`);
  });

  const gaps = [];
  const add = (code, detail) => gaps.push(Object.freeze({ code, detail }));
  const byRole = new Map();
  for (const entry of sessions) {
    if (byRole.has(entry.role)) add('duplicate-role', `role ${entry.role} is recorded more than once`);
    else byRole.set(entry.role, entry);
  }
  for (const role of required) if (!byRole.has(role)) add(`missing-${role}`, `risk ${risk} requires the ${role} role`);

  const entries = [...byRole.values()];
  for (let left = 0; left < entries.length; left += 1) {
    for (let right = left + 1; right < entries.length; right += 1) {
      if (entries[left].identity === entries[right].identity) add('shared-identity', `identity ${entries[left].identity} covers ${entries[left].role} and ${entries[right].role}`);
      if (entries[left].sessionId === entries[right].sessionId) add('shared-session', `session ${entries[left].sessionId} covers ${entries[left].role} and ${entries[right].role}`);
    }
  }
  const implementer = byRole.get('implementer');
  if (implementer && entries.some((entry) => entry.role !== 'implementer' && entry.identity === implementer.identity)) {
    add('self-approval', 'the implementer appears in another review role');
  }
  const approver = byRole.get('approver');
  if (approver && approver.identityClass === 'ai') add('ai-approval', 'a machine identity cannot be the sole approver');
  return Object.freeze({ status: gaps.length === 0 ? 'satisfied' : 'blocked', requiredRoles: required, gaps: Object.freeze(gaps) });
}

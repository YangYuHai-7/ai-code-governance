import { usageError } from '../../kernel/index.mjs';
import { sha256 } from '../../shared/index.mjs';

export const CANDIDATE_STATES = Object.freeze(['observed', 'deduplicated', 'offline-evaluated', 'independently-reviewed', 'approved', 'canary', 'monitored', 'promoted', 'rolled-back']);

// A candidate may only move forward along this lifecycle; rollback is the single backward edge.
const TRANSITIONS = Object.freeze({
  deduplicate: { from: ['observed'], to: 'deduplicated' },
  'offline-evaluate': { from: ['deduplicated'], to: 'offline-evaluated' },
  'independent-review': { from: ['offline-evaluated'], to: 'independently-reviewed' },
  approve: { from: ['independently-reviewed'], to: 'approved' },
  canary: { from: ['approved'], to: 'canary' },
  monitor: { from: ['canary'], to: 'monitored' },
  promote: { from: ['monitored'], to: 'promoted' },
  rollback: { from: ['approved', 'canary', 'monitored', 'promoted'], to: 'rolled-back' },
});

function assertRule(value) {
  if (!value || typeof value !== 'object' || !CANDIDATE_STATES.includes(value.state) || typeof value.id !== 'string' || typeof value.projectId !== 'string') {
    throw usageError('A valid candidate rule is required.');
  }
  return value;
}

export function createCandidateRule({ id, projectId, observationId, digest }) {
  for (const [name, value] of Object.entries({ id, projectId, observationId })) {
    if (typeof value !== 'string' || value.length === 0) throw usageError(`candidateRule.${name} is required.`);
  }
  if (typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest)) throw usageError('candidateRule.digest must be a canonical digest.');
  return Object.freeze({
    id, projectId, observationId, digest, state: 'observed',
    history: Object.freeze([Object.freeze({ event: 'observe', from: null, to: 'observed', actor: null, at: null })]),
  });
}

export function transitionCandidateRule(rule, event) {
  const current = assertRule(rule);
  if (!event || typeof event !== 'object' || typeof event.type !== 'string') throw usageError('A candidate rule event is required.');
  const transition = TRANSITIONS[event.type];
  if (!transition || !transition.from.includes(current.state)) {
    throw usageError(`Illegal candidate rule transition: ${current.state} -> ${event.type ?? 'unknown'}.`);
  }
  // A project may never review, approve, or promote the policy that governs its own work.
  if (event.type === 'independent-review') {
    if (!event.reviewer || event.reviewer.projectId === current.projectId || event.reviewer.class !== 'independent-reviewer') {
      throw usageError('A candidate rule must be independently reviewed by another project.');
    }
  }
  if (event.type === 'approve') {
    if (!event.approver || event.approver.class !== 'human-owner') throw usageError('A candidate rule needs a human owner approval.');
    if (event.approver.projectId === current.projectId) throw usageError('A project can never promote its own rule.');
  }
  if (event.type === 'canary' || event.type === 'monitor' || event.type === 'promote') {
    if (!event.evidence || typeof event.evidence !== 'object') throw usageError(`${event.type} requires policy evidence.`);
  }
  if (event.type === 'promote') {
    if (event.evidence.canaryPassed === false) throw usageError('A candidate rule whose canary regressed must roll back instead of promoting.');
    if (event.evidence.monitoredWindowPassed !== true) throw usageError('Promotion requires a passed monitored window.');
  }
  if (event.type === 'rollback' && (typeof event.reason !== 'string' || event.reason.length === 0)) {
    throw usageError('A candidate rule rollback requires a reason.');
  }
  return Object.freeze({
    ...current,
    state: transition.to,
    history: Object.freeze([...current.history, Object.freeze({
      event: event.type, from: current.state, to: transition.to,
      actor: event.approver?.identity ?? event.reviewer?.identity ?? null, at: event.at ?? null,
    })]),
  });
}

// One project observation can never silently become global governance: identical observations merge.
export function deduplicateCandidateRules(existing, candidate) {
  if (!Array.isArray(existing)) throw usageError('Existing candidate rules must be an array.');
  if (!candidate || typeof candidate !== 'object') throw usageError('A candidate observation is required.');
  const signature = typeof candidate.digest === 'string' ? candidate.digest : sha256(JSON.stringify(candidate));
  const duplicate = existing.find((entry) => entry.digest === signature);
  if (duplicate) return Object.freeze([...existing]);
  return Object.freeze([...existing, createCandidateRule({
    id: candidate.id ?? `candidate.${signature.slice(0, 12)}`,
    projectId: candidate.projectId ?? 'unknown-project',
    observationId: candidate.observationId ?? `observation.${signature.slice(0, 12)}`,
    digest: signature,
  })]);
}
const VOLATILE_OBSERVATION_KEYS = new Set(['detail', 'at', 'timestamp', 'count', 'runId', 'message', 'observedAt']);

function observationSignature(projectId, observation, digest) {
  if (typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)) return digest;
  if (typeof observation.rule === 'string' && observation.rule.length > 0) return sha256(JSON.stringify({ projectId, rule: observation.rule }));
  if (typeof observation.id === 'string' && observation.id.length > 0) return sha256(JSON.stringify({ projectId, id: observation.id }));
  const stable = Object.fromEntries(Object.entries(observation)
    .filter(([key]) => !VOLATILE_OBSERVATION_KEYS.has(key))
    .sort(([left], [right]) => left.localeCompare(right)));
  return sha256(JSON.stringify({ projectId, stable }));
}

// Telemetry observations enter the candidate lifecycle here: recorded, never approved, and merged
// when they describe the same rule so one project cannot accumulate duplicate global candidates.
export function recordCandidateObservation({ store, projectId, observation, digest = undefined } = {}) {
  if (!store || typeof store.read !== 'function' || typeof store.write !== 'function') {
    throw usageError('candidateObservation.store must expose read() and write().');
  }
  if (typeof projectId !== 'string' || projectId.length === 0) throw usageError('candidateObservation.projectId is required.');
  if (!observation || typeof observation !== 'object' || Array.isArray(observation)) throw usageError('candidateObservation.observation must be an object.');
  const existing = store.read();
  const list = Array.isArray(existing) ? existing : [];
  const signature = observationSignature(projectId, observation, digest);
  const duplicate = list.find((entry) => entry.digest === signature);
  if (duplicate) return Object.freeze({ status: 'duplicate', candidate: duplicate });
  const candidate = createCandidateRule({
    id: `candidate.${signature.slice(0, 12)}`,
    projectId,
    observationId: typeof observation.id === 'string' && observation.id.length > 0 ? observation.id : `observation.${signature.slice(0, 12)}`,
    digest: signature,
  });
  store.write(Object.freeze([...list, candidate]));
  return Object.freeze({ status: 'recorded', candidate });
}

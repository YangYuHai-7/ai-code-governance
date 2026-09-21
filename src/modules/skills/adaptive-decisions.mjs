import { sha256, stableJson } from '../../shared/index.mjs';
import { usageError } from '../../kernel/index.mjs';

const ID = /^[a-z0-9][a-z0-9._-]{0,159}$/;

export function validateAdaptiveDecisions(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.schemaVersion !== 1 || Object.keys(value).some((key) => !['schemaVersion', 'skills', 'roles'].includes(key)) || Buffer.byteLength(stableJson(value)) > 16384) throw usageError('Invalid adaptiveDecisions receipt schema or budget.');
  for (const kind of ['skills', 'roles']) {
    const entries = value[kind];
    if (!Array.isArray(entries) || entries.length > 32) throw usageError('Adaptive decision receipts require bounded collections.');
    const ids = new Set();
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry) || Object.keys(entry).length !== 3 || Object.keys(entry).some((key) => !['id', 'action', 'evidenceHash'].includes(key)) || typeof entry.id !== 'string' || !ID.test(entry.id) || ids.has(entry.id) || !['add', 'defer', 'reject'].includes(entry.action) || typeof entry.evidenceHash !== 'string' || !/^[a-f0-9]{64}$/.test(entry.evidenceHash)) throw usageError('Invalid adaptive decision evidence-bound receipt.');
      ids.add(entry.id);
    }
  }
  return value;
}

/**
 * The evidence surface of a project-convention candidate: the fields an owner decision
 * actually binds. Everything else on such a candidate - trigger, purpose, why, label,
 * scope, example, staleOnChange - is presentational prose, and a reworded sentence must
 * not invalidate an approved decision. The digest map keeps source-content binding, and
 * the verification commands keep their source digests, so changing the evidence itself
 * still invalidates the receipt.
 */
const CONVENTION_EVIDENCE_FIELDS = ['id', 'kind', 'surface', 'evidencePaths', 'sourceDigests', 'counterEvidence', 'observations', 'verificationCommands', 'verificationBoundary'];

function conventionEvidenceSurface(item) {
  const surface = {};
  for (const field of CONVENTION_EVIDENCE_FIELDS) if (item[field] !== undefined) surface[field] = item[field];
  // Observation labels are fixed prose from the layout table; the observation identity,
  // count, and examples are the evidence.
  if (Array.isArray(surface.observations)) {
    surface.observations = surface.observations.map(({ id, count, examples }) => ({ id, count, examples }));
  }
  return surface;
}

export function adaptiveDecisionEvidenceHash(item) {
  // Convention candidates (the only items carrying a digest-per-path map) bind to their
  // declared evidence surface. Every other item - skill discovery candidates, role
  // proposals - keeps the deny-list below, because their metadata is machine-generated
  // evidence rather than prose: a permission, version, or content digest change there
  // genuinely changes what was approved.
  const snapshot = item && typeof item === 'object' && item.sourceDigests !== undefined
    ? conventionEvidenceSurface(item)
    : structuredClone(item);
  // Discovery's transient state is not source evidence; all other metadata participates.
  delete snapshot.decision;
  return sha256(stableJson(snapshot));
}

export function reconcileAdaptiveDecisions(items, choices, previous = []) {
  return items.map((item) => {
    const evidenceHash = adaptiveDecisionEvidenceHash(item);
    const saved = previous.find((entry) => entry.id === item.id && entry.evidenceHash === evidenceHash);
    return { id: item.id, action: choices.find((entry) => entry.id === item.id)?.action ?? saved?.action ?? 'defer', evidenceHash };
  });
}

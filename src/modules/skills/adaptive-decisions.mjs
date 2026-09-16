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

export function adaptiveDecisionEvidenceHash(item) {
  const snapshot = structuredClone(item);
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

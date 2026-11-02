import { openDeliverySessionStore, resolveProjectDirectory } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { projectDeliveryInspection } from '../delivery-core/index.mjs';

const DEFAULT_LIMIT = 100;
const MAX_LIMIT = 100;

function checkedLimit(value) {
  if (!Number.isSafeInteger(value) || value < 1 || value > MAX_LIMIT) throw usageError(`Delivery inspection limit must be an integer from 1 to ${MAX_LIMIT}.`);
  return value;
}

function summary(inspection) {
  return Object.freeze({
    schemaVersion: inspection.schemaVersion,
    sessionId: inspection.sessionId,
    sequence: inspection.sequence,
    state: inspection.state,
    semanticDigest: inspection.semanticDigest,
    updatedAt: inspection.updatedAt,
    guided: inspection.guided,
  });
}

function storeFor(root) {
  return openDeliverySessionStore(resolveProjectDirectory(root));
}

export function listDeliveryInspections(root, options = {}) {
  const limit = checkedLimit(options.limit ?? DEFAULT_LIMIT);
  const all = storeFor(root).list().map(projectDeliveryInspection);
  const sessions = Object.freeze(all.slice(0, limit).map(summary));
  return Object.freeze({ schemaVersion: 1, total: all.length, count: sessions.length, truncated: all.length > sessions.length, sessions });
}

export function readDeliveryInspection(root, sessionId) {
  return projectDeliveryInspection(storeFor(root).read(sessionId));
}

import { usageError } from '../../kernel/index.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const CAPABILITIES = ['structuredRequirement', 'architectureProposal', 'boundedPatch', 'usageEvidence', 'cancellation', 'resume'];

export function createAgentRuntimeAdapter({ id, capabilities = {}, prepareTurn, invoke, cancel = null }) {
  if (typeof id !== 'string' || !ID.test(id)) throw usageError('Invalid Agent runtime id.');
  if (typeof prepareTurn !== 'function') throw usageError('Agent runtime prepareTurn must be a function.');
  if (typeof invoke !== 'function') throw usageError('Agent runtime invoke must be a function.');
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) throw usageError('Agent runtime capabilities must be an object.');
  for (const [key, value] of Object.entries(capabilities)) {
    if (!CAPABILITIES.includes(key) || typeof value !== 'boolean') throw usageError(`Invalid Agent runtime capability ${key}.`);
  }
  const normalized = Object.freeze(Object.fromEntries(CAPABILITIES.map((key) => [key, capabilities[key] === true])));
  if (normalized.cancellation && typeof cancel !== 'function') throw usageError('Agent runtime cancellation capability requires cancel().');
  return Object.freeze({ id, capabilities: normalized, prepareTurn, invoke, cancel: typeof cancel === 'function' ? cancel : null });
}

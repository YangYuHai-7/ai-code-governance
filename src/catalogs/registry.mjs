import path from 'node:path';
import { PACKAGE_ROOT, SUPPORTED_CLIENTS } from '../constants.mjs';
import { readJson } from '../adapters/filesystem/index.mjs';
import { usageError } from '../kernel/index.mjs';

export function loadAgentRegistry() {
  const registry = readJson(path.join(PACKAGE_ROOT, 'assets/registries/agent-registry.json'));
  if (registry.schema_version !== 1 || !Array.isArray(registry.agents)) {
    throw new Error('Agent registry is invalid.');
  }
  const ids = registry.agents.map((agent) => agent.id);
  for (const id of SUPPORTED_CLIENTS) {
    if (!ids.includes(id)) throw new Error(`Agent registry is missing ${id}.`);
  }
  return registry;
}

export function loadCapabilityRegistry() {
  const registry = readJson(path.join(PACKAGE_ROOT, 'assets/registries/capability-pack-registry.json'));
  if (registry.schema_version !== 1 || !Array.isArray(registry.packs)) {
    throw new Error('Capability pack registry is invalid.');
  }
  return registry;
}

export function resolveAgents(ids, registry = loadAgentRegistry()) {
  const requested = [...new Set(ids)];
  if (requested.length === 0) throw usageError('Select at least one agent.');
  return requested.map((id) => {
    const agent = registry.agents.find((candidate) => candidate.id === id);
    if (!agent) throw usageError(`Unsupported agent: ${id}`);
    return agent;
  });
}
export function resolvePacks(ids, registry = loadCapabilityRegistry()) {
  const requested = [...new Set(ids)];
  if (requested.length === 0) throw usageError('Select at least one technology stack.');
  return requested.map((id) => {
    const pack = registry.packs.find((candidate) => candidate.id === id);
    if (!pack) throw usageError(`Unsupported technology stack: ${id}`);
    return pack;
  });
}

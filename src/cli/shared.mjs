import path from 'node:path';
import { CONFIG_PATH } from '../constants.mjs';
import { defaultConfig, validateConfig } from '../generator.mjs';
import { loadManifest } from '../managed-files.mjs';
import { scanSummary } from '../scanner.mjs';
import { readJson, readText } from '../adapters/filesystem/index.mjs';
import { usageError } from '../kernel/index.mjs';
import { sha256 } from '../shared/index.mjs';

const BUILT_IN_CLIENTS = ['codex', 'claude-code', 'cursor'];

export function clientSupportFromClients(clients, source) {
  const selectedClients = [...new Set(clients ?? [])];
  const allBuiltIn = BUILT_IN_CLIENTS.every((client) => selectedClients.includes(client))
    && selectedClients.every((client) => BUILT_IN_CLIENTS.includes(client));
  return {
    mode: allBuiltIn ? 'all-built-in' : 'selected',
    selectedClients,
    source,
  };
}

export function normalizeClientSupport(config, { source = 'legacy-config' } = {}) {
  if (config?.clientSupport) {
    return { ...config, clients: [...config.clientSupport.selectedClients] };
  }
  if (Array.isArray(config?.clients) && config.clients.length > 0) {
    return { ...config, clientSupport: clientSupportFromClients(config.clients, source) };
  }
  return config;
}

export function mergeConfig(base, supplied) {
  return {
    ...base,
    ...supplied,
    features: { ...base.features, ...(supplied.features ?? {}) },
  };
}

export function loadExistingConfig(root) {
  try {
    return readJson(path.join(root, CONFIG_PATH));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read existing ${CONFIG_PATH}: ${error.message}`);
  }
}

export function printScan(scan) {
  console.log(JSON.stringify(scanSummary(scan), null, 2));
}

export function configForStandards(scan) {
  const existing = loadExistingConfig(scan.root);
  return validateConfig(mergeConfig(defaultConfig(scan), existing ?? {}));
}

export function assertManagedArchitectureConfigTrusted(root, config) {
  if (!config?.architecture) return;
  const manifest = loadManifest(root);
  const entry = manifest?.files?.find((candidate) => candidate?.path === CONFIG_PATH && candidate.ownership === 'full');
  const content = readText(path.join(root, CONFIG_PATH), '');
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || sha256(content) !== entry.sha256) {
    throw usageError('The managed architecture configuration drifted from its recorded manifest. Refuse to reuse or rewrite its baseline; restore the known-good config before running aicg write commands.');
  }
}

export function loadConfiguredGovernance(scan) {
  const existing = loadExistingConfig(scan.root);
  if (!existing) throw usageError('Capability harvest requires an initialized governance configuration. Run aicg init first.');
  const config = validateConfig(mergeConfig(defaultConfig(scan), existing));
  assertManagedArchitectureConfigTrusted(scan.root, config);
  return config;
}

import path from 'node:path';
import { CONFIG_PATH, TOOL_NAME } from '../constants.mjs';
import { defaultConfig, validateConfig } from '../generator.mjs';
import { loadManifest } from '../managed-files.mjs';
import { allBuiltInClientIds } from '../catalogs/index.mjs';
import { scanSummary } from '../scanner.mjs';
import { readJson, readText } from '../adapters/filesystem/index.mjs';
import { usageError } from '../kernel/index.mjs';
import { sha256 } from '../shared/index.mjs';
import { assertNoLinkAncestor } from '../preconditions.mjs';

export function clientSupportFromClients(clients, source) {
  const selectedClients = [...new Set(clients ?? [])];
  const builtInClients = allBuiltInClientIds();
  // Registry order is the canonical order, so an all-built-in scope is compared set-for-set
  // rather than by a hard-coded length. A legacy three-client selection reads as `selected`
  // because Copilot now completes the built-in scope; the clients array itself is untouched.
  const allBuiltIn = builtInClients.every((client) => selectedClients.includes(client))
    && selectedClients.every((client) => builtInClients.includes(client));
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
  const inferredTestingLanguage = supplied.testing?.reportLanguage === undefined && supplied.artifactLanguage !== undefined
    ? { reportLanguage: supplied.artifactLanguage === 'zh-CN' ? 'zh-CN' : 'en' }
    : {};
  return {
    ...base,
    ...supplied,
    features: { ...base.features, ...(supplied.features ?? {}) },
    testing: { ...base.testing, ...inferredTestingLanguage, ...(supplied.testing ?? {}) },
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
  if (!config?.architecture && config?.adaptiveDecisions === undefined) return;
  if (config?.adaptiveDecisions !== undefined) {
    assertNoLinkAncestor(root, CONFIG_PATH);
    assertNoLinkAncestor(root, '.ai-governance/manifest.json');
  }
  const manifest = loadManifest(root);
  const entries = manifest?.files?.filter((candidate) => candidate?.path === CONFIG_PATH && candidate.ownership === 'full');
  const entry = entries?.length === 1 ? entries[0] : null;
  if (config.adaptiveDecisions !== undefined && (manifest?.schemaVersion !== 1 || manifest.generatedBy !== TOOL_NAME || entry?.kind !== 'configuration' || entry.source !== 'confirmed-decisions')) throw usageError('Adaptive decision receipts require a trusted managed configuration manifest.');
  const content = readText(path.join(root, CONFIG_PATH), '');
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || sha256(content) !== entry.sha256) {
    throw usageError('The managed architecture configuration drifted, or adaptive decision receipts drifted, from the recorded manifest. Refuse to reuse or rewrite the baseline; restore the known-good config before running aicg write commands.');
  }
}

export function loadConfiguredGovernance(scan) {
  const existing = loadExistingConfig(scan.root);
  if (!existing) throw usageError('Capability harvest requires an initialized governance configuration. Run aicg init first.');
  const config = validateConfig(mergeConfig(defaultConfig(scan), existing));
  assertManagedArchitectureConfigTrusted(scan.root, config);
  return config;
}

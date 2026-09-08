import fs from 'node:fs';
import path from 'node:path';
import { INTENT_REGISTRY_PATH, PACKAGE_ROOT } from './constants.mjs';
import { readJson, usageError } from './utils.mjs';

const SUPPORTED_HANDLERS = new Set(['doctor', 'check', 'assess', 'architecture', 'standards', 'init', 'sync']);
const SUPPORTED_MODES = new Set(['read', 'write']);

export function normalizeIntentText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[，。！？、；：,.!?;:]/g, ' ')
    .replace(/\s+/g, '');
}

export function validateIntentRegistry(registry) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.intents)) {
    throw usageError('Intent registry must contain schemaVersion 1 and an intents array.');
  }
  const ids = new Set();
  const aliases = new Map();
  for (const intent of registry.intents) {
    if (!intent || typeof intent.id !== 'string' || !intent.id) throw usageError('Each intent must have a non-empty id.');
    if (ids.has(intent.id)) throw usageError(`Intent registry contains duplicate id: ${intent.id}`);
    ids.add(intent.id);
    if (!SUPPORTED_HANDLERS.has(intent.handler)) throw usageError(`Intent ${intent.id} has unsupported handler: ${intent.handler}`);
    if (!SUPPORTED_MODES.has(intent.mode)) throw usageError(`Intent ${intent.id} has unsupported mode: ${intent.mode}`);
    if (!Array.isArray(intent.aliases) || intent.aliases.length === 0) throw usageError(`Intent ${intent.id} must have at least one alias.`);
    for (const alias of intent.aliases) {
      const normalized = normalizeIntentText(alias);
      if (!normalized) throw usageError(`Intent ${intent.id} contains an empty alias.`);
      const previous = aliases.get(normalized);
      if (previous) throw usageError(`Intent registry alias collision: ${JSON.stringify(alias)} belongs to both ${previous} and ${intent.id}.`);
      aliases.set(normalized, intent.id);
    }
  }
  return registry;
}

export function loadIntentRegistry(registryPath = path.join(PACKAGE_ROOT, INTENT_REGISTRY_PATH)) {
  if (!fs.statSync(registryPath).isFile()) throw usageError(`Intent registry is not a regular file: ${registryPath}`);
  return validateIntentRegistry(readJson(registryPath));
}

export function resolveIntent(text, registry = loadIntentRegistry()) {
  const normalized = normalizeIntentText(text);
  if (!normalized) throw usageError('A non-empty --text value is required.');
  const matched = registry.intents.filter((intent) => intent.aliases.some((alias) => normalizeIntentText(alias) === normalized));
  if (matched.length === 0) {
    throw usageError(`No safe governance intent matches ${JSON.stringify(text)}. Use an explicit CLI command for repair, upgrade, migration, or any ambiguous request.`);
  }
  if (matched.length > 1) throw usageError(`Ambiguous governance intent: ${JSON.stringify(text)}.`);
  return { ...matched[0], normalizedText: normalized };
}

import fs from 'node:fs';
import path from 'node:path';
import { INTENT_REGISTRY_PATH, PACKAGE_ROOT } from '../../constants.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';

const SUPPORTED_HANDLERS = new Set(['doctor', 'check', 'assess', 'architecture', 'standards', 'team', 'harvest', 'promote', 'init', 'sync', 'complete', 'hook-install', 'hook-status', 'release-check']);
const SUPPORTED_MODES = new Set(['read', 'write']);
const MAX_INTENT_TEXT = 80;
/**
 * A chat request names governance work; it is never a shell command line. Widening
 * recognition from exact phrases to subject+verb matching widens what a sentence can
 * reach, so the boundary that rejects a request carrying its own command, destructive
 * verb, or negation is evaluated before matching, not after it. Approval is not part
 * of this boundary: a resolved write intent still needs its exact planHash.
 */
const UNSAFE_INTENT_PATTERNS = [
  { pattern: /[;&|`$<>\\]/, reason: 'shell metacharacter' },
  { pattern: /\brm\b|\bsudo\b|\bchmod\b|\bchown\b|\bcurl\b|\bwget\b|\bkill\b|\bmv\b|\bdd\b|\bsh\b/i, reason: 'destructive or network command' },
  { pattern: /删除|删掉|清空|清理|格式化|重置|抹掉|移除|卸载|回滚|绕过|跳过检查|改权限|提权/, reason: 'destructive verb' },
  { pattern: /不要|不用|别做|别改|别动|取消|停止|禁止|拒绝/, reason: 'negation' },
];

export function normalizeIntentText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[，。！？、；：,.!?;:]/g, ' ')
    .replace(/\s+/g, '');
}

function assertSafeIntentText(text, normalized) {
  if (normalized.length > MAX_INTENT_TEXT) {
    throw usageError(`Chat governance requests accept a short instruction only (at most ${MAX_INTENT_TEXT} characters). Use the explicit CLI command for anything longer.`);
  }
  for (const { pattern, reason } of UNSAFE_INTENT_PATTERNS) {
    if (pattern.test(normalized)) {
      throw usageError(`Refusing ${JSON.stringify(text)}: the request contains a ${reason}. A chat request may only name governance work; run any command explicitly instead.`);
    }
  }
}

function matchWords(intent) {
  const match = intent.match ?? {};
  return {
    objects: Array.isArray(match.objects) ? match.objects : [],
    actions: Array.isArray(match.actions) ? match.actions : [],
  };
}

/**
 * Subject words decide which intents a sentence is about; action words decide which of
 * those it asks for. The score is the matched character count, so a specific phrase
 * outranks a generic one. Equal scores stay ambiguous on purpose: a request that could
 * mean two different governed operations must be rephrased, never guessed.
 */
function scoreIntent(intent, normalized) {
  const { objects, actions } = matchWords(intent);
  const hit = (words) => words.filter((word) => normalized.includes(normalizeIntentText(word)));
  const hitObjects = hit(objects);
  const hitActions = hit(actions);
  const score = [...hitObjects, ...hitActions].reduce((total, word) => total + normalizeIntentText(word).length, 0);
  return { intent, hitObjects, hitActions, score };
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
    if (intent.match !== undefined) {
      if (!intent.match || typeof intent.match !== 'object' || Array.isArray(intent.match)) {
        throw usageError(`Intent ${intent.id} match must be an object with objects and actions arrays.`);
      }
      for (const key of ['objects', 'actions']) {
        const words = intent.match[key];
        if (!Array.isArray(words) || words.length === 0) throw usageError(`Intent ${intent.id} match.${key} must be a non-empty array.`);
        const seen = new Set();
        for (const word of words) {
          if (typeof word !== 'string' || !word.trim()) throw usageError(`Intent ${intent.id} match.${key} contains an empty word.`);
          const wordKey = normalizeIntentText(word);
          if (seen.has(wordKey)) throw usageError(`Intent ${intent.id} match.${key} repeats ${JSON.stringify(word)}.`);
          seen.add(wordKey);
        }
      }
    }
  }
  return registry;
}

export function loadIntentRegistry(registryPath = path.join(PACKAGE_ROOT, INTENT_REGISTRY_PATH)) {
  if (!fs.statSync(registryPath).isFile()) throw usageError(`Intent registry is not a regular file: ${registryPath}`);
  return validateIntentRegistry(readJson(registryPath));
}

/**
 * One sentence, one governed operation. A sentence that names one subject but also carries the
 * verb of an unrelated handler is a compound request, and executing the resolvable half would
 * silently drop the rest. Only a verb that the resolved candidates neither own nor cover
 * counts: 团队配置 covers 配置 as a noun, and 跑起来 covers 跑.
 */
function foreignAction(registry, bySubject, normalized) {
  const coverage = new Array(normalized.length).fill(false);
  const mark = (word) => {
    const key = normalizeIntentText(word);
    for (let index = normalized.indexOf(key); index !== -1; index = normalized.indexOf(key, index + 1)) {
      for (let offset = 0; offset < key.length; offset += 1) coverage[index + offset] = true;
    }
  };
  for (const entry of bySubject) {
    for (const word of matchWords(entry.intent).objects) mark(word);
    for (const word of matchWords(entry.intent).actions) mark(word);
  }
  const resolvedIds = new Set(bySubject.map((entry) => entry.intent.id));
  for (const intent of registry.intents) {
    if (resolvedIds.has(intent.id)) continue;
    for (const word of matchWords(intent).actions) {
      const key = normalizeIntentText(word);
      for (let index = normalized.indexOf(key); index !== -1; index = normalized.indexOf(key, index + 1)) {
        if (![...key].every((_character, offset) => coverage[index + offset])) return { action: word, intent: intent.id };
      }
    }
  }
  return null;
}

function resolvedIntent(entry, normalized) {
  return {
    ...entry.intent,
    normalizedText: normalized,
    matchedBy: entry.hitActions.length > 0 ? 'action' : 'subject',
    matchedElements: [...entry.hitObjects, ...entry.hitActions],
  };
}

export function resolveIntent(text, registry = loadIntentRegistry()) {
  const normalized = normalizeIntentText(text);
  if (!normalized) throw usageError('A non-empty --text value is required.');
  assertSafeIntentText(text, normalized);

  const exact = registry.intents.filter((intent) => intent.aliases.some((alias) => normalizeIntentText(alias) === normalized));
  if (exact.length > 1) throw usageError(`Ambiguous governance intent: ${JSON.stringify(text)}.`);
  if (exact.length === 1) return { ...exact[0], normalizedText: normalized, matchedBy: 'exact' };

  const bySubject = registry.intents
    .map((intent) => scoreIntent(intent, normalized))
    .filter((entry) => entry.hitObjects.length > 0);
  if (bySubject.length === 0) {
    throw usageError(`No safe governance intent matches ${JSON.stringify(text)}. Name the governance subject and the action, or use an explicit CLI command for repair, upgrade, migration, or any ambiguous request.`);
  }
  const foreign = foreignAction(registry, bySubject, normalized);
  if (foreign) {
    throw usageError(`No safe governance intent matches ${JSON.stringify(text)}: it names one governed subject but also asks for ${foreign.intent} work (${foreign.action}). Ask for one governed operation at a time.`);
  }
  if (bySubject.length === 1) return resolvedIntent(bySubject[0], normalized);

  // Several intents share the subject. The verb picks one; without a verb the more
  // specific subject phrase wins. Whatever stays tied is reported as ambiguous rather
  // than guessed, because these handlers differ in what they write.
  const withVerb = bySubject.filter((entry) => entry.hitActions.length > 0);
  const ranked = (withVerb.length > 0 ? withVerb : bySubject).sort((left, right) => right.score - left.score);
  const top = ranked.filter((entry) => entry.score === ranked[0].score);
  if (top.length > 1) {
    throw usageError(`Ambiguous governance intent: ${JSON.stringify(text)} could mean ${top.map((entry) => entry.intent.id).join(', ')}. State the action explicitly (initialize, check, diagnose, validate, and so on).`);
  }
  return resolvedIntent(top[0], normalized);
}

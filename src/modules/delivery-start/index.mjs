import { openDeliverySessionStore, readBoundedRepositoryFile, resolveProjectDirectory, snapshotPath, walkFilesDetailed } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import {
  createDeliverySession,
  normalizeDeliveryAuthority,
  prepareRequirementCompilation,
  validateDeliverySession,
  validateRequirementIr,
} from '../delivery-core/index.mjs';
import { canonicalValueDigest, sha256 } from '../../shared/index.mjs';

const PROFILES = new Set(['advisory', 'production']);
const AGENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const STUDIO_KEY = /^[A-Za-z0-9._:-]{16,128}$/;
const STUDIO_TEXT_BYTES = 8 * 1024;
const PUBLICATION_WAIT_MS = 1500;
const PUBLICATION_POLL_MS = 10;
const PUBLICATION_SLEEP = new Int32Array(new SharedArrayBuffer(4));
function startError(code, message) { return Object.assign(usageError(message), { deliveryStartCode: code }); }
const DEFAULT_BUDGETS = Object.freeze({
  maxAgentTurns: 12,
  maxCommands: 32,
  maxChangedFiles: 32,
  maxChangedBytes: 4 * 1024 * 1024,
  maxElapsedMs: 30 * 60 * 1000,
  maxInputTokens: 200_000,
  maxOutputTokens: 100_000,
  maxCost: 100,
});

function objectWithKeys(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw usageError('Invalid delivery start request.');
}

function studioText(value) {
  if (typeof value !== 'string') throw usageError('Studio requestText requires UTF-8 text.');
  const text = value.trim();
  if (!text || Buffer.from(text, 'utf8').toString('utf8') !== text || Buffer.byteLength(text, 'utf8') > STUDIO_TEXT_BYTES) throw usageError('Studio requestText is empty, invalid, or exceeds 8 KiB.');
  return text;
}

function profileOf(value) {
  const profile = value === undefined ? 'advisory' : value;
  if (!PROFILES.has(profile)) throw usageError('Unsupported delivery profile.');
  return profile;
}

function repositorySnapshot(root) {
  const walked = walkFilesDetailed(root, {
    maxDepth: 32, maxFiles: 50_000, maxDirectories: 20_000, maxEntries: 100_000,
    ignoredAtRoot: ['.git', 'node_modules', 'dist', 'build', 'target', '.next', '.ai-governance'],
  });
  if (!walked.budget.complete) throw usageError('Repository snapshot is incomplete; reduce or explicitly exclude generated repository content before starting delivery.');
  return { files: walked.files.map((file) => ({ path: file.relative, ...snapshotPath(file.absolute), ...(file.type === 'file' ? { bytes: file.size } : {}) })) };
}

function requirementFromFile(root, relative) {
  let bytes;
  try { ({ bytes } = readBoundedRepositoryFile(root, relative, 2 * 1024 * 1024)); }
  catch { throw usageError('Requirement must be a safe repository-relative bounded regular JSON file.'); }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw usageError('Requirement JSON is unreadable.'); }
  return validateRequirementIr(parsed);
}

function defaults() {
  return {
    authority: normalizeDeliveryAuthority({
      allowedPaths: [], allowedCommands: [], allowNetwork: false, allowExternalEffects: false,
      maxChangedFiles: DEFAULT_BUDGETS.maxChangedFiles, maxChangedBytes: DEFAULT_BUDGETS.maxChangedBytes,
    }),
    budgets: DEFAULT_BUDGETS,
  };
}

function preparedStudio(root, input) {
  objectWithKeys(input, ['requestText', 'profile']);
  const requestText = studioText(input.requestText);
  const profile = profileOf(input.profile);
  const { authority, budgets } = defaults();
  const snapshot = repositorySnapshot(root);
  const repositoryDigest = canonicalValueDigest(snapshot, { omit: ['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt'] });
  const compilationInputDigest = prepareRequirementCompilation({ requestText }).inputDigest;
  const previewDigest = canonicalValueDigest({ schemaVersion: 1, requestText, profile, repositoryDigest, authority, budgets, compilationInputDigest });
  return { requestText, profile, authority, budgets, snapshot, repositoryDigest, compilationInputDigest, previewDigest };
}

export function prepareDeliverySessionStart(root, input) {
  const prepared = preparedStudio(resolveProjectDirectory(root), input);
  return Object.freeze({
    schemaVersion: 1,
    requestText: prepared.requestText,
    profile: prepared.profile,
    previewDigest: prepared.previewDigest,
    repositoryDigest: prepared.repositoryDigest,
    compilationInputDigest: prepared.compilationInputDigest,
    authority: prepared.authority,
    budgets: prepared.budgets,
    agentExecution: 'unavailable',
    workspaceEffects: 'denied',
  });
}

function sessionFromInput({ id, requestText, requirement, profile, agent, requestSource, snapshot, authority, budgets, studioBinding = null }) {
  const base = createDeliverySession({ id, requestText, requirement, authority, budgets, repositorySnapshot: snapshot });
  return validateDeliverySession({
    ...base,
    activeAgentId: null,
    runtime: {
      profile,
      requestedAgentId: agent ?? null,
      requestSource,
      compilation: requirement ? null : prepareRequirementCompilation({ requestText }),
      startedAt: base.createdAt,
      retries: 0,
      maxRetries: 2,
      effects: {},
      ...(studioBinding ? { studioStart: { schemaVersion: 1, ...studioBinding } } : {}),
    },
  });
}

function existingStudio(store, id, fingerprint, { waitForPublication = false } = {}) {
  let session;
  const deadline = Date.now() + (waitForPublication ? PUBLICATION_WAIT_MS : 0);
  let sawIncomplete = false;
  for (;;) {
    try { session = store.read(id); break; }
    catch (error) {
      if (/does not exist/i.test(error.message)) {
        if (sawIncomplete) throw startError('publication-unresolved', `Delivery session ${id} publication is unresolved; retry the original submission key.`);
        return null;
      }
      if (!waitForPublication || !/is incomplete/i.test(error.message)) throw error;
      sawIncomplete = true;
      if (Date.now() >= deadline) throw startError('publication-unresolved', `Delivery session ${id} is incomplete; retry the original submission key or seek manual recovery.`);
      Atomics.wait(PUBLICATION_SLEEP, 0, 0, PUBLICATION_POLL_MS);
    }
  }
  const validated = validateDeliverySession(session);
  const binding = validated.runtime?.studioStart;
  if (binding?.schemaVersion !== 1 || binding.fingerprint !== fingerprint) throw startError('idempotency-conflict', 'Studio idempotency conflict.');
  const boundFingerprint = canonicalValueDigest({ schemaVersion: 1, requestText: validated.requestText, profile: validated.runtime.profile, previewDigest: binding.previewDigest });
  if (boundFingerprint !== binding.fingerprint || sha256(validated.requestText) !== validated.requestDigest) throw usageError('Studio published input binding is invalid.');
  return { session: validated, replayed: true };
}

export function startDeliverySession(root, input, options = {}) {
  if (input?.source === 'cli') objectWithKeys(input, ['source', 'sessionId', 'requestText', 'requirementPath', 'profile', 'agent']);
  else if (input?.source === 'studio') objectWithKeys(input, ['source', 'requestText', 'profile', 'previewDigest', 'idempotencyKey']);
  else throw usageError('Invalid delivery start source.');
  const projectRoot = resolveProjectDirectory(root);
  const store = (options.storeFactory ?? openDeliverySessionStore)(projectRoot);
  const profile = profileOf(input.profile);
  if (input.source === 'cli') {
    if (typeof input.sessionId !== 'string' || Boolean(input.requirementPath) === Boolean(input.requestText)) throw usageError('CLI delivery start requires a session id and exactly one of requirementPath or requestText.');
    if (input.agent && !AGENT_ID.test(input.agent)) throw usageError('Delivery Agent id is invalid.');
    const requirement = input.requirementPath ? requirementFromFile(projectRoot, input.requirementPath) : null;
    const requestText = input.requestText ?? requirement?.summary ?? requirement?.title;
    const { authority, budgets } = defaults();
    const session = sessionFromInput({ id: input.sessionId, requestText, requirement, profile, agent: input.agent, requestSource: input.requirementPath ? { kind: 'requirement-ir', path: input.requirementPath } : { kind: 'text' }, snapshot: repositorySnapshot(projectRoot), authority, budgets });
    store.create(session);
    return { session, replayed: false };
  }
  const requestText = studioText(input.requestText);
  if (!STUDIO_KEY.test(input.idempotencyKey ?? '')) throw usageError('Invalid Studio idempotency key.');
  if (typeof input.previewDigest !== 'string' || !/^[a-f0-9]{64}$/.test(input.previewDigest)) throw usageError('Invalid Studio preview digest.');
  const id = `studio.${sha256(`studio-start-v1\0${input.idempotencyKey}`)}`;
  const fingerprint = canonicalValueDigest({ schemaVersion: 1, requestText, profile, previewDigest: input.previewDigest });
  const previous = existingStudio(store, id, fingerprint, { waitForPublication: true });
  if (previous) return previous;
  const prepared = preparedStudio(projectRoot, { requestText, profile });
  if (prepared.previewDigest !== input.previewDigest) throw startError('stale-preview', 'Studio preview is stale.');
  if (canonicalValueDigest(repositorySnapshot(projectRoot), { omit: ['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt'] }) !== prepared.repositoryDigest) throw startError('stale-preview', 'Studio preview is stale.');
  const session = sessionFromInput({ id, requestText, requirement: null, profile, requestSource: { kind: 'text' }, snapshot: prepared.snapshot, authority: prepared.authority, budgets: prepared.budgets, studioBinding: { previewDigest: input.previewDigest, fingerprint } });
  try { store.create(session); }
  catch (error) {
    if (/already exists|is incomplete/i.test(error.message)) {
      const winner = existingStudio(store, id, fingerprint, { waitForPublication: true });
      if (winner) return winner;
      throw startError('publication-unresolved', `Delivery session ${id} publication is unresolved; retry the original submission key.`);
    }
    throw error;
  }
  return { session, replayed: false };
}

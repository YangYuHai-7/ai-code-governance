import path from 'node:path';
import { openDeliverySessionStore, readBoundedRepositoryFile, resolveProjectDirectory, snapshotPath, walkFilesDetailed } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import {
  createDeliveryRuntime,
  createDeliverySession,
  normalizeDeliveryAuthority,
  prepareRequirementCompilation,
  validateDeliverySession,
  validateRequirementIr,
} from '../../modules/delivery-core/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';

const SESSION_BASE = '.ai-governance/state/delivery-sessions';
const ACTIONS = new Set(['start', 'status', 'step', 'resume', 'cancel']);
const PROFILES = new Set(['advisory', 'production']);
const AGENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
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

function snapshotRepository(root) {
  const walked = walkFilesDetailed(root, {
    maxDepth: 32,
    maxFiles: 50_000,
    maxDirectories: 20_000,
    maxEntries: 100_000,
    ignoredAtRoot: ['.git', 'node_modules', 'dist', 'build', 'target', '.next', '.ai-governance'],
  });
  if (!walked.budget.complete) throw usageError('Repository snapshot is incomplete; reduce or explicitly exclude generated repository content before starting delivery.');
  const files = walked.files.map((file) => ({ path: file.relative, ...snapshotPath(file.absolute), ...(file.type === 'file' ? { bytes: file.size } : {}) }));
  return { files };
}

function readRequirement(root, relative) {
  if (typeof relative !== 'string') throw usageError('delivery session start requires a safe repository-relative JSON requirement path.');
  let bytes;
  try { ({ bytes } = readBoundedRepositoryFile(root, relative, 2 * 1024 * 1024)); }
  catch (error) { throw usageError(`Requirement must be a safe repository-relative bounded regular JSON file: ${error.message}`); }
  let parsed;
  try { parsed = JSON.parse(bytes.toString('utf8')); }
  catch { throw usageError(`Requirement JSON is unreadable: ${relative}`); }
  return validateRequirementIr(parsed);
}

function runtimeFor(store) {
  const unavailable = async () => { throw Object.assign(new Error('No verified delivery Agent runtime adapter is installed.'), { category: 'agent-unavailable' }); };
  return createDeliveryRuntime({ store, agents: [], workspace: { apply: unavailable }, verifier: { run: unavailable } });
}

function sessionPath(id) { return `${SESSION_BASE}/${id}/session.json`; }

function present(action, session, extra = {}) {
  return {
    action,
    sessionPath: sessionPath(session.id),
    session,
    ...extra,
  };
}

function print(result, json) {
  if (json) console.log(JSON.stringify(result, null, 2));
  else console.log(`delivery_session=${result.session.id} action=${result.action} state=${result.session.state} path=${result.sessionPath}`);
  return result;
}

function requireSessionId(options, action) {
  if (!options.session) throw usageError(`delivery session ${action} requires --session <id>.`);
  return options.session;
}

export async function deliverySessionCommand(target, action, options = {}) {
  if (!ACTIONS.has(action)) throw usageError('delivery session requires an action: start, status, step, resume, or cancel.');
  const root = resolveProjectDirectory(path.resolve(target));
  const store = openDeliverySessionStore(root);
  const id = requireSessionId(options, action);

  if (action === 'start') {
    const profile = options.profile ?? 'advisory';
    if (!PROFILES.has(profile)) throw usageError('delivery session --profile must be advisory or production.');
    if (Boolean(options.requirement) === Boolean(options.text)) throw usageError('delivery session start requires exactly one of --requirement <repository-relative-json> or --text <request>.');
    if (options.agent && !AGENT_ID.test(options.agent)) throw usageError('delivery session --agent requires a safe Agent id.');
    const requirement = options.requirement ? readRequirement(root, options.requirement) : null;
    const requestText = options.text ?? requirement?.summary ?? requirement?.title;
    const repositorySnapshot = snapshotRepository(root);
    const authority = normalizeDeliveryAuthority({
      allowedPaths: [], allowedCommands: [], allowNetwork: false, allowExternalEffects: false,
      maxChangedFiles: DEFAULT_BUDGETS.maxChangedFiles, maxChangedBytes: DEFAULT_BUDGETS.maxChangedBytes,
    });
    const base = createDeliverySession({ id, requestText, requirement, authority, budgets: DEFAULT_BUDGETS, repositorySnapshot });
    const compilation = requirement ? null : prepareRequirementCompilation({ requestText });
    const session = validateDeliverySession({
      ...base,
      activeAgentId: null,
      runtime: {
        profile,
        requestedAgentId: options.agent ?? null,
        requestSource: options.requirement ? { kind: 'requirement-ir', path: options.requirement } : { kind: 'text' },
        compilation,
        startedAt: base.createdAt,
        retries: 0,
        maxRetries: 2,
        effects: {},
      },
    });
    store.create(session);
    const notice = options.agent
      ? `Agent ${options.agent} is recorded as requested but remains unverified; no executable runtime adapter was activated.`
      : 'No verified executable delivery Agent runtime adapter was activated.';
    return print(present(action, session, { notice }), options.json);
  }

  if (action === 'status') return print(present(action, validateDeliverySession(store.read(id))), options.json);

  if (options.agent) throw usageError('Agent switching requires a verified executable adapter; none is installed for delivery session CLI execution.');

  const runtime = runtimeFor(store);
  if (action === 'step') return print(present(action, await runtime.step(id)), options.json);
  if (action === 'cancel') return print(present(action, runtime.cancel(id), { adapterCancellation: 'unavailable' }), options.json);

  const current = store.read(id);
  const snapshot = snapshotRepository(root);
  const resumed = runtime.resume(id, {
    requirementDigest: current.requirementDigest,
    architectureDigest: current.architectureDigest,
    authorityDigest: current.authorityDigest,
    repositoryDigest: canonicalValueDigest(snapshot, { omit: ['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt'] }),
  });
  return print(present(action, resumed), options.json);
}

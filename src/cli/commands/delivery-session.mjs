import path from 'node:path';
import { openDeliverySessionStore, resolveProjectDirectory, snapshotPath, walkFilesDetailed } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { createDeliveryRuntime, validateDeliverySession } from '../../modules/delivery-core/index.mjs';
import { startDeliverySession } from '../../modules/delivery-start/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';

const SESSION_BASE = '.ai-governance/state/delivery-sessions';
const ACTIONS = new Set(['start', 'status', 'step', 'resume', 'cancel']);
const PROFILES = new Set(['advisory', 'production']);
const AGENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

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
    const { session } = startDeliverySession(root, {
      source: 'cli', sessionId: id, profile, agent: options.agent,
      ...(options.requirement ? { requirementPath: options.requirement } : { requestText: options.text }),
    });
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

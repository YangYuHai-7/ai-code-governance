import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';
import { createAgentRuntimeAdapter } from './runtime.mjs';

const DANGEROUS_FLAGS = Object.freeze(['--dangerously-bypass-approvals-and-sandbox', '--dangerously-bypass-hook-trust', '--dangerously-skip-permissions', '--full-auto', '--yolo']);
const PHASE_SANDBOX = Object.freeze({ requirement: 'read-only', architecture: 'read-only', 'independent-review': 'read-only', patch: 'workspace-write' });
const MAX_JSONL_LINES = 512;
const MAX_JSONL_LINE_CHARS = 8192;
const CODEX_CAPABILITIES = Object.freeze(['structuredRequirement', 'architectureProposal', 'boundedPatch', 'usageEvidence', 'cancellation', 'resume', 'independentReview']);

function assertSafeCommand(command) {
  if (typeof command !== 'string' || command.trim().length === 0) throw usageError('Codex command is required.');
  for (const flag of DANGEROUS_FLAGS) if (command.includes(flag)) throw usageError(`dangerous flag ${flag} is not accepted`);
  if (/\s/.test(command.trim())) throw usageError('Codex command must be one executable without flags or arguments.');
  return command.trim();
}

function assertRunner(processRunner) {
  if (!processRunner || typeof processRunner.run !== 'function') throw usageError('Codex adapter requires an injected processRunner.run().');
}

function assertStore(artifactStore) {
  if (!artifactStore || typeof artifactStore.write !== 'function' || typeof artifactStore.read !== 'function') throw usageError('Codex adapter requires an injected artifact store.');
}

// The final message is the only authoritative output; JSONL is usage evidence, never prose.
export function validateAgentTurnResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw usageError('Agent turn response must be an object.');
  for (const key of Object.keys(value)) if (!['proposal', 'findings'].includes(key)) throw usageError(`Agent turn response.${key} is not supported`);
  if (!value.proposal || typeof value.proposal !== 'object' || Array.isArray(value.proposal)) throw usageError('Agent turn response.proposal must be an object.');
  if (!Array.isArray(value.findings) || value.findings.some((entry) => typeof entry !== 'string')) throw usageError('Agent turn response.findings must be a string array.');
  return Object.freeze({ proposal: Object.freeze({ ...value.proposal }), findings: Object.freeze([...value.findings]) });
}

export async function probeCodexCli({ command = 'codex', processRunner }) {
  const executable = assertSafeCommand(command);
  assertRunner(processRunner);
  const result = await processRunner.run({ argv: [executable, '--version'], stdin: '', maxOutputBytes: 65536, timeoutMs: 15000 });
  const match = /(\d+\.\d+\.\d+)/.exec(String(result?.stdout ?? ''));
  const available = result?.exitCode === 0 && Boolean(match);
  return Object.freeze({ available, version: available ? match[1] : null, command: executable, exitCode: Number.isInteger(result?.exitCode) ? result.exitCode : null });
}

function parseUsage(stdout) {
  const lines = String(stdout ?? '').split(/\r?\n/).filter((line) => line.trim().length > 0);
  const bounded = lines.slice(0, MAX_JSONL_LINES);
  let malformed = 0;
  let usage = null;
  for (const line of bounded) {
    if (line.length > MAX_JSONL_LINE_CHARS) { malformed += 1; continue; }
    let event;
    try { event = JSON.parse(line); } catch { malformed += 1; continue; }
    if (event?.type !== 'token_count' || !event.usage || typeof event.usage !== 'object') continue;
    const input = Number.isFinite(event.usage.input_tokens) ? event.usage.input_tokens : null;
    const output = Number.isFinite(event.usage.output_tokens) ? event.usage.output_tokens : null;
    const cost = Number.isFinite(event.usage.total_cost_usd) ? event.usage.total_cost_usd : null;
    if (input !== null || output !== null) usage = { inputTokens: input, outputTokens: output, cost };
  }
  return { usage: usage ?? { inputTokens: null, outputTokens: null, cost: null }, lines: bounded.length, malformed };
}

function unauthorizedPaths(changedPaths, authority) {
  const allowed = Array.isArray(authority?.allowedPaths) ? authority.allowedPaths : [];
  return (Array.isArray(changedPaths) ? changedPaths : [])
    .map((entry) => String(entry).replaceAll('\\', '/'))
    .filter((entry) => !allowed.some((prefix) => entry === prefix || entry.startsWith(`${prefix}/`)));
}

export function createCodexCliAdapter({ command = 'codex', detectedVersion = null, processRunner, artifactStore, root = '.', id = 'codex-cli' }) {
  const executable = assertSafeCommand(command);
  assertRunner(processRunner);
  assertStore(artifactStore);
  const handshaken = typeof detectedVersion === 'string' && detectedVersion.trim().length > 0;

  async function prepareTurn(request) {
    const phase = request?.phase;
    const sandbox = PHASE_SANDBOX[phase];
    if (!sandbox) throw usageError(`Agent turn phase ${phase ?? 'missing'} is not supported.`);
    if (typeof request?.responseSchema !== 'string' || request.responseSchema.length === 0) throw usageError('Agent turn responseSchema is required.');
    const extraArgs = request?.extraArgs ?? [];
    if (!Array.isArray(extraArgs)) throw usageError('Agent turn extraArgs must be an array.');
    for (const argument of extraArgs) for (const flag of DANGEROUS_FLAGS) if (String(argument).includes(flag)) throw usageError(`dangerous flag ${flag} is not accepted`);
    const key = canonicalValueDigest({ phase, semanticDigest: request?.semanticDigest ?? null, idempotencyKey: request?.idempotencyKey ?? null }).slice(0, 24);
    const base = `agent-turns/${key}`;
    const artifactPaths = Object.freeze({ schema: `${base}/response-schema.json`, lastMessage: `${base}/last-message.json` });
    artifactStore.write(artifactPaths.schema, request.responseSchema);
    const argv = Object.freeze([
      executable, 'exec', '--json', '--ignore-user-config', '--strict-config',
      '--output-schema', artifactPaths.schema, '--output-last-message', artifactPaths.lastMessage,
      '-C', request?.root ?? root, '--sandbox', sandbox, ...extraArgs.map(String),
    ]);
    return Object.freeze({
      prompt: String(request?.prompt ?? ''),
      stdin: String(request?.prompt ?? ''),
      requestDigest: request?.semanticDigest,
      argv, artifactPaths, phase, sandbox,
      authority: request?.authority ?? {},
    });
  }

  async function invoke(turn) {
    const result = await processRunner.run({
      argv: turn.argv, stdin: turn.stdin, cwd: turn.argv[turn.argv.indexOf('-C') + 1],
      maxOutputBytes: turn.maxOutputBytes, timeoutMs: turn.timeoutMs, turnId: turn.turnId,
      artifactPaths: turn.artifactPaths, artifactStore,
    });
    const raw = String(result?.stdout ?? '');
    const parsed = parseUsage(raw);
    const stderr = String(result?.stderr ?? '');
    const digests = Object.freeze({ stdout: canonicalValueDigest(raw), stderr: canonicalValueDigest(stderr), jsonlMalformed: parsed.malformed });
    const unauthorized = unauthorizedPaths(result?.changedPaths, turn.authority);
    // Unverified usage stays absent so the generic contract reports it as unverified.
    const usage = Object.fromEntries(Object.entries(parsed.usage).filter(([, value]) => Number.isFinite(value)));
    const base = {
      exitCode: result?.exitCode, stderr, durationMs: result?.durationMs, usage: Object.freeze(usage), digests,
      jsonl: Object.freeze({ lines: parsed.lines, malformed: parsed.malformed }),
    };
    if (unauthorized.length) return Object.freeze({ ...base, authorityViolation: true, unauthorizedPaths: Object.freeze(unauthorized), findings: Object.freeze([`Agent changed paths outside its authority: ${unauthorized.join(', ')}`]) });
    let response;
    try { response = validateAgentTurnResponse(JSON.parse(artifactStore.read(turn.artifactPaths.lastMessage))); }
    catch (error) { return Object.freeze({ ...base, invalidOutput: error.message }); }
    return Object.freeze({ ...base, stdout: JSON.stringify({ proposal: response.proposal, findings: response.findings }) });
  }

  async function cancel(turnId) {
    if (typeof processRunner.cancel !== 'function') throw usageError('The Codex process runner does not support cancellation.');
    const result = await processRunner.cancel(turnId);
    return Object.freeze({ cancelled: result?.cancelled === true, turnId });
  }

  return createAgentRuntimeAdapter({
    id,
    capabilities: Object.fromEntries(CODEX_CAPABILITIES.map((capability) => [capability, handshaken])),
    prepareTurn,
    invoke,
    cancel,
  });
}

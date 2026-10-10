import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative } from '../../shared/index.mjs';

const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const DIGEST = /^[a-f0-9]{64}$/;
export const GATE_STATUSES = Object.freeze(['passed', 'failed', 'blocked']);
export const GATE_PURPOSES = Object.freeze(['format', 'lint', 'typecheck', 'architecture', 'unit', 'integration', 'contract', 'security', 'migration', 'observability', 'performance', 'build', 'start', 'traceability', 'e2e']);

export function validateGate(gate) {
  if (!gate || typeof gate !== 'object' || Array.isArray(gate)) throw usageError('verificationGate: expected a planned gate object');
  if (typeof gate.id !== 'string' || !ID.test(gate.id)) throw usageError('verificationGate.id: invalid gate ID');
  if (typeof gate.purpose !== 'string' || !GATE_PURPOSES.includes(gate.purpose)) throw usageError('verificationGate.purpose: unsupported gate purpose');
  for (const key of ['timeoutMs', 'maxOutputBytes', 'artifactBudgetBytes']) {
    if (!Number.isSafeInteger(gate[key]) || gate[key] < 0) throw usageError(`verificationGate.${key}: expected a non-negative integer`);
  }
  if (gate.timeoutMs < 1 || gate.maxOutputBytes < 1) throw usageError('verificationGate.timeoutMs: positive budgets are required');
  return gate;
}

export function redactSecrets(context, text) {
  let output = `${text ?? ''}`;
  for (const secret of context?.secrets ?? []) {
    if (typeof secret !== 'string' || secret.length === 0) continue;
    output = output.split(secret).join('[redacted]');
  }
  return output;
}

export function gateResult(gate, { status, summary, checks = [], artifacts = [], cleanup = { status: 'clean', reason: null }, failure = null }) {
  return Object.freeze({
    gateId: gate.id,
    status,
    evidence: Object.freeze({ gateId: gate.id, status, summary, checks: Object.freeze(checks.map((check) => Object.freeze({ ...check }))) }),
    artifacts: Object.freeze(artifacts.map((artifact) => Object.freeze({ ...artifact }))),
    cleanup: Object.freeze({ status: cleanup.status, reason: cleanup.reason ?? null }),
    failure: failure === null ? null : Object.freeze({ classification: failure.classification, message: failure.message }),
  });
}

export function capabilityUnavailable(gate, capability, message) {
  const capabilityCheck = { name: 'capability', status: 'blocked', detail: `${capability} capability is unavailable` };
  return gateResult(gate, { status: 'blocked', summary: message, checks: [capabilityCheck], failure: { classification: 'capability', message } });
}

function artifactState() { return { artifacts: [], bytes: 0 }; }

function artifactFailure(message) { return { classification: 'artifact', message }; }

function recordArtifact(context, gate, state, name, content) {
  if (!isSafeRelative(name)) return { failure: artifactFailure('artifact name must stay inside the verification tree') };
  const text = redactSecrets(context, content);
  const bytes = Buffer.byteLength(text);
  if (state.bytes + bytes > gate.artifactBudgetBytes) return { failure: artifactFailure(`artifact budget exceeded for gate ${gate.id}`) };
  if (typeof context.artifacts?.record !== 'function') return { failure: artifactFailure('artifact recording capability is unavailable') };
  let recorded;
  try { recorded = context.artifacts.record({ gateId: gate.id, path: `verification/${gate.id}/${name}`, content: text }); }
  catch { return { failure: artifactFailure('artifact recording failed') }; }
  if (!recorded || !isSafeRelative(recorded.path) || !DIGEST.test(recorded.digest ?? '') || !Number.isSafeInteger(recorded.bytes) || recorded.bytes < 0) {
    return { failure: artifactFailure('artifact recorder returned an invalid record') };
  }
  state.artifacts.push({ path: recorded.path, digest: recorded.digest, bytes: recorded.bytes });
  state.bytes += bytes;
  return { failure: null };
}

function cleanupFrom(result) {
  if (result?.cleanup?.status === 'failed') return { status: 'failed', reason: result.cleanup.reason ?? 'cleanup failed' };
  return { status: 'clean', reason: null };
}

function cleanupBlocked(gate, summary, checks, state, cleanup) {
  return gateResult(gate, { status: 'blocked', summary, checks, artifacts: state.artifacts, cleanup, failure: { classification: 'infrastructure', message: summary } });
}

export async function executeCommandGate(context, gate) {
  validateGate(gate);
  if (context?.capabilities?.commands !== true || typeof context?.commands?.run !== 'function') {
    return capabilityUnavailable(gate, 'command execution', `command execution is unavailable for gate ${gate.id}`);
  }
  const plan = context.commands.plan?.[gate.id];
  if (!plan || !Array.isArray(plan.argv) || plan.argv.length === 0) {
    return capabilityUnavailable(gate, 'command execution', `no trusted runner plan is declared for gate ${gate.id}`);
  }
  const state = artifactState();
  const checks = [{ name: 'runner-plan', status: 'passed', detail: plan.argv.join(' ') }];
  let result;
  try {
    result = await context.commands.run({ gateId: gate.id, argv: plan.argv, cwd: plan.cwd, timeoutMs: gate.timeoutMs, maxOutputBytes: gate.maxOutputBytes });
  } catch (error) {
    const missing = error?.code === 'ENOENT';
    const classification = missing ? 'capability' : 'infrastructure';
    return gateResult(gate, { status: 'blocked', summary: missing ? 'the gate executable is not installed' : `the gate runner failed: ${error.message}`, checks, failure: { classification, message: error.message } });
  }
  for (const [name, content] of [['stdout.log', result.stdout ?? ''], ['stderr.log', result.stderr ?? '']]) {
    const recorded = recordArtifact(context, gate, state, name, content);
    if (recorded.failure) return gateResult(gate, { status: 'failed', summary: recorded.failure.message, checks, artifacts: state.artifacts, failure: recorded.failure });
  }
  const cleanup = cleanupFrom(result);
  const exitCode = Number.isInteger(result.exitCode) ? result.exitCode : null;
  checks.push({ name: 'exit-code', status: exitCode === 0 ? 'passed' : 'failed', detail: exitCode === null ? 'no exit status' : `exit ${exitCode}` });
  if (cleanup.status === 'failed') return cleanupBlocked(gate, cleanup.reason, checks, state, cleanup);
  if (result.missingExecutable || exitCode === null && !result.timedOut && !result.outputOverflow) {
    return gateResult(gate, { status: 'blocked', summary: 'the gate executable is not installed', checks, artifacts: state.artifacts, cleanup, failure: { classification: 'capability', message: 'the gate executable is not installed' } });
  }
  if (result.timedOut || result.outputOverflow) {
    const message = result.timedOut ? 'the gate exceeded its time budget' : 'the gate exceeded its output budget';
    return gateResult(gate, { status: 'failed', summary: message, checks, artifacts: state.artifacts, cleanup, failure: { classification: 'infrastructure', message } });
  }
  if (exitCode !== 0) {
    return gateResult(gate, { status: 'failed', summary: `the gate exited with ${exitCode}`, checks, artifacts: state.artifacts, cleanup, failure: { classification: 'functional', message: `gate ${gate.id} exited with ${exitCode}` } });
  }
  return gateResult(gate, { status: 'passed', summary: `${gate.purpose} gate passed`, checks, artifacts: state.artifacts, cleanup });
}

export async function executeDatabaseGate(context, gate) {
  validateGate(gate);
  if (context?.capabilities?.database !== true || typeof context?.database?.run !== 'function') {
    return capabilityUnavailable(gate, 'database', `database capability is unavailable for gate ${gate.id}`);
  }
  const probes = context.database.plan?.[gate.id];
  if (!Array.isArray(probes) || probes.length === 0) {
    return capabilityUnavailable(gate, 'database', `no trusted probe plan is declared for gate ${gate.id}`);
  }
  const state = artifactState();
  const checks = [];
  let cleanup = { status: 'clean', reason: null };
  for (const probe of probes) {
    if (typeof probe !== 'string' || probe.length === 0) return gateResult(gate, { status: 'blocked', summary: 'the database probe plan is invalid', checks, failure: { classification: 'capability', message: 'invalid probe name' } });
    let result;
    try {
      result = await context.database.run({ gateId: gate.id, probe, timeoutMs: gate.timeoutMs });
    } catch (error) {
      const missing = error?.code === 'ENOENT';
      checks.push({ name: probe, status: 'blocked', detail: error.message });
      return gateResult(gate, { status: 'blocked', summary: `${probe} could not run`, checks, failure: { classification: missing ? 'capability' : 'infrastructure', message: error.message } });
    }
    const recorded = recordArtifact(context, gate, state, `${probe}.log`, result?.detail ?? '');
    if (recorded.failure) return gateResult(gate, { status: 'failed', summary: recorded.failure.message, checks, artifacts: state.artifacts, failure: recorded.failure });
    if (result?.cleanup?.status === 'failed') cleanup = { status: 'failed', reason: result.cleanup.reason ?? 'cleanup failed' };
    const status = ['passed', 'failed', 'blocked'].includes(result?.status) ? result.status : 'blocked';
    checks.push({ name: probe, status, detail: result?.detail ?? '' });
    if (status === 'blocked') return gateResult(gate, { status: 'blocked', summary: `${probe} is blocked`, checks, artifacts: state.artifacts, cleanup, failure: { classification: 'capability', message: result?.detail ?? probe } });
    if (status === 'failed') return gateResult(gate, { status: 'failed', summary: `${probe} failed`, checks, artifacts: state.artifacts, cleanup, failure: { classification: 'data', message: result?.detail ?? probe } });
  }
  if (cleanup.status === 'failed') return cleanupBlocked(gate, cleanup.reason, checks, state, cleanup);
  return gateResult(gate, { status: 'passed', summary: 'migration and data probes passed', checks, artifacts: state.artifacts, cleanup });
}

export async function executeBrowserGate(context, gate) {
  validateGate(gate);
  if (context?.capabilities?.browser !== true || typeof context?.browser?.run !== 'function') {
    return capabilityUnavailable(gate, 'browser', `browser capability is unavailable for gate ${gate.id}`);
  }
  const scenarios = context.browser.plan?.[gate.id] ?? ['primary-flow', 'accessibility'];
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    return capabilityUnavailable(gate, 'browser', `no trusted browser plan is declared for gate ${gate.id}`);
  }
  const state = artifactState();
  const checks = [];
  for (const scenario of scenarios) {
    if (typeof scenario !== 'string' || scenario.length === 0) return gateResult(gate, { status: 'blocked', summary: 'the browser scenario plan is invalid', checks, failure: { classification: 'capability', message: 'invalid scenario name' } });
    let result;
    try {
      result = await context.browser.run({ gateId: gate.id, scenario, timeoutMs: gate.timeoutMs });
    } catch (error) {
      const missing = error?.code === 'ENOENT';
      checks.push({ name: scenario, status: 'blocked', detail: error.message });
      return gateResult(gate, { status: 'blocked', summary: `${scenario} could not run`, checks, failure: { classification: missing ? 'capability' : 'infrastructure', message: error.message } });
    }
    const recorded = recordArtifact(context, gate, state, `${scenario}.json`, result?.detail ?? '');
    if (recorded.failure) return gateResult(gate, { status: 'failed', summary: recorded.failure.message, checks, artifacts: state.artifacts, failure: recorded.failure });
    const status = ['passed', 'failed', 'blocked'].includes(result?.status) ? result.status : 'blocked';
    checks.push({ name: scenario, status, detail: result?.detail ?? '' });
    if (result?.cleanup?.status === 'failed') {
      const cleanup = { status: 'failed', reason: result.cleanup.reason ?? 'cleanup failed' };
      return cleanupBlocked(gate, cleanup.reason, checks, state, cleanup);
    }
    if (status === 'blocked') return gateResult(gate, { status: 'blocked', summary: `${scenario} is blocked`, checks, artifacts: state.artifacts, failure: { classification: 'capability', message: result?.detail ?? scenario } });
    if (status === 'failed') {
      const classification = scenario.includes('access') ? 'accessibility' : 'functional';
      return gateResult(gate, { status: 'failed', summary: `${scenario} failed`, checks, artifacts: state.artifacts, failure: { classification, message: result?.detail ?? scenario } });
    }
  }
  return gateResult(gate, { status: 'passed', summary: 'browser scenarios passed', checks, artifacts: state.artifacts });
}

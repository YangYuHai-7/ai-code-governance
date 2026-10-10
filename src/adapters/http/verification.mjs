import { capabilityUnavailable, gateResult, redactSecrets, validateGate } from '../process/golden-path-verification.mjs';
import { isSafeRelative } from '../../shared/index.mjs';

const DIGEST = /^[a-f0-9]{64}$/;

function recordResponse(context, gate, state, name, body) {
  const text = redactSecrets(context, body);
  const bytes = Buffer.byteLength(text);
  if (state.bytes + bytes > gate.artifactBudgetBytes) return { failure: { classification: 'artifact', message: `artifact budget exceeded for gate ${gate.id}` } };
  if (typeof context.artifacts?.record !== 'function') return { failure: { classification: 'artifact', message: 'artifact recording capability is unavailable' } };
  const path = `verification/${gate.id}/${name}`;
  if (!isSafeRelative(path)) return { failure: { classification: 'artifact', message: 'artifact path must stay inside the verification tree' } };
  let recorded;
  try { recorded = context.artifacts.record({ gateId: gate.id, path, content: text }); }
  catch { return { failure: { classification: 'artifact', message: 'artifact recording failed' } }; }
  if (!recorded || !isSafeRelative(recorded.path) || !DIGEST.test(recorded.digest ?? '') || !Number.isSafeInteger(recorded.bytes) || recorded.bytes < 0) {
    return { failure: { classification: 'artifact', message: 'artifact recorder returned an invalid record' } };
  }
  state.artifacts.push({ path: recorded.path, digest: recorded.digest, bytes: recorded.bytes });
  state.bytes += bytes;
  return { failure: null };
}

// Executes one planned HTTP gate: readiness first, then the declared contract checks.
export async function executeHttpGate(context, gate) {
  validateGate(gate);
  if (context?.capabilities?.http !== true || typeof context?.http?.request !== 'function') {
    return capabilityUnavailable(gate, 'http', `http capability is unavailable for gate ${gate.id}`);
  }
  const plan = context.endpoints?.[gate.id];
  if (!plan || (typeof plan !== 'object')) {
    return capabilityUnavailable(gate, 'http', `no trusted endpoint plan is declared for gate ${gate.id}`);
  }
  const state = { artifacts: [], bytes: 0 };
  const checks = [];
  const request = async (spec) => context.http.request({ gateId: gate.id, method: spec.method ?? 'GET', ...spec, timeoutMs: gate.timeoutMs });
  for (const readiness of plan.readiness ?? []) {
    let response;
    try { response = await request({ ...readiness, name: readiness.name ?? 'readiness', path: readiness.path }); }
    catch (error) {
      checks.push({ name: readiness.name ?? 'readiness', status: 'blocked', detail: error.message });
      return gateResult(gate, { status: 'blocked', summary: 'the service is not reachable', checks, artifacts: state.artifacts, failure: { classification: 'capability', message: error.message } });
    }
    const recorded = recordResponse(context, gate, state, `${readiness.name ?? 'readiness'}.json`, response?.body ?? '');
    if (recorded.failure) return gateResult(gate, { status: 'failed', summary: recorded.failure.message, checks, artifacts: state.artifacts, failure: recorded.failure });
    if (response?.status !== readiness.expectStatus) {
      const message = `readiness returned ${response?.status} instead of ${readiness.expectStatus}`;
      checks.push({ name: readiness.name ?? 'readiness', status: 'failed', detail: message });
      return gateResult(gate, { status: 'failed', summary: message, checks, artifacts: state.artifacts, failure: { classification: 'runtime', message } });
    }
    checks.push({ name: readiness.name ?? 'readiness', status: 'passed', detail: `status ${response.status}` });
  }
  for (const contract of plan.contracts ?? []) {
    let response;
    try { response = await request({ ...contract, method: contract.method ?? 'GET', name: contract.name }); }
    catch (error) {
      checks.push({ name: contract.name, status: 'blocked', detail: error.message });
      return gateResult(gate, { status: 'blocked', summary: `${contract.name} could not be requested`, checks, artifacts: state.artifacts, failure: { classification: 'capability', message: error.message } });
    }
    const recorded = recordResponse(context, gate, state, `${contract.name}.json`, response?.body ?? '');
    if (recorded.failure) return gateResult(gate, { status: 'failed', summary: recorded.failure.message, checks, artifacts: state.artifacts, failure: recorded.failure });
    if (response?.status !== contract.expectStatus) {
      const message = `${contract.name} returned ${response?.status} instead of ${contract.expectStatus}`;
      checks.push({ name: contract.name, status: 'failed', detail: message });
      return gateResult(gate, { status: 'failed', summary: message, checks, artifacts: state.artifacts, failure: { classification: 'contract', message } });
    }
    for (const expected of contract.expectBodyIncludes ?? []) {
      if (!`${response.body ?? ''}`.includes(expected)) {
        const message = `${contract.name} did not return ${expected}`;
        checks.push({ name: contract.name, status: 'failed', detail: message });
        return gateResult(gate, { status: 'failed', summary: message, checks, artifacts: state.artifacts, failure: { classification: 'contract', message } });
      }
    }
    checks.push({ name: contract.name, status: 'passed', detail: `status ${response.status}` });
  }
  return gateResult(gate, { status: 'passed', summary: 'http readiness and contracts passed', checks, artifacts: state.artifacts });
}

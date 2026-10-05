import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';

export const AGENT_RUNTIME_CAPABILITIES = Object.freeze([
  'structuredRequirement', 'architectureProposal', 'boundedPatch',
  'usageEvidence', 'cancellation', 'resume',
]);

export function normalizeAgentCapabilities(value = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw usageError('Agent capabilities must be an object.');
  for (const [key, supported] of Object.entries(value)) {
    if (!AGENT_RUNTIME_CAPABILITIES.includes(key)) throw usageError(`Unknown Agent capability: ${key}.`);
    if (typeof supported !== 'boolean') throw usageError(`Agent capability ${key} must be boolean.`);
  }
  return Object.freeze(Object.fromEntries(AGENT_RUNTIME_CAPABILITIES.map((key) => [key, value[key] === true])));
}

export function negotiateAgentAdapter({ required = {}, available = [] }) {
  const needs = normalizeAgentCapabilities(required);
  if (!Array.isArray(available)) throw usageError('Available Agent adapters must be an array.');
  const requiredNames = AGENT_RUNTIME_CAPABILITIES.filter((name) => needs[name]);
  const candidates = available.map((entry) => {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string') throw usageError('Available Agent adapter requires an id.');
    const capabilities = normalizeAgentCapabilities(entry.capabilities);
    return { ...entry, capabilities, gaps: requiredNames.filter((name) => !capabilities[name]) };
  });
  const selected = candidates.find((entry) => entry.gaps.length === 0) ?? null;
  const gaps = selected ? [] : [...new Set(candidates.flatMap((entry) => entry.gaps))].sort();
  return Object.freeze({ status: selected ? 'compatible' : 'unavailable', selected: selected ? Object.freeze({ ...selected, gaps: undefined }) : null, gaps: Object.freeze(gaps) });
}

function positive(value, fallback, name) {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < 1) throw usageError(`${name} must be a positive integer.`);
  return actual;
}

function usageValue(value, name) {
  if (value === undefined || value === null) return 'unverified';
  if (!Number.isFinite(value) || value < 0) throw usageError(`Agent usage ${name} must be a non-negative number.`);
  return value;
}

function result(status, base, overrides = {}) {
  return Object.freeze({ turnId: base.turnId, requestDigest: base.requestDigest, status, proposal: null, findings: Object.freeze([]), usage: Object.freeze({ inputTokens: 'unverified', outputTokens: 'unverified', cost: 'unverified' }), processEvidence: Object.freeze({ agentId: base.adapter.id, exitCode: null, durationMs: null, cancelled: false }), ...overrides });
}

export async function runAgentTurn(adapter, request, limits = {}) {
  if (!adapter || typeof adapter.prepareTurn !== 'function' || typeof adapter.invoke !== 'function') throw usageError('A valid Agent runtime adapter is required.');
  const timeoutMs = positive(limits.timeoutMs, 120_000, 'timeoutMs');
  const maxInputBytes = positive(limits.maxInputBytes, 256 * 1024, 'maxInputBytes');
  const maxOutputBytes = positive(limits.maxOutputBytes, 2 * 1024 * 1024, 'maxOutputBytes');
  const prepared = await adapter.prepareTurn(request);
  if (!prepared || typeof prepared !== 'object' || typeof prepared.prompt !== 'string' || !/^[a-f0-9]{64}$/.test(prepared.requestDigest ?? '')) throw usageError('Agent prepareTurn must return a prompt and semantic requestDigest.');
  if (Buffer.byteLength(prepared.prompt) > maxInputBytes) throw usageError(`Agent turn input exceeds ${maxInputBytes} bytes.`);
  const turnId = `turn.${canonicalValueDigest({ agentId: adapter.id, requestDigest: prepared.requestDigest, key: request?.idempotencyKey ?? null }).slice(0, 24)}`;
  const base = { adapter, turnId, requestDigest: prepared.requestDigest };
  let timer;
  const timeout = new Promise((resolve) => { timer = setTimeout(() => resolve({ timedOut: true }), timeoutMs); });
  let processResult;
  const started = Date.now();
  try { processResult = await Promise.race([Promise.resolve(adapter.invoke(Object.freeze({ ...prepared, turnId, timeoutMs, maxOutputBytes }))), timeout]); }
  catch (error) {
    clearTimeout(timer);
    return result('failed', base, { findings: Object.freeze([error?.message ?? 'Agent invocation failed.']), processEvidence: Object.freeze({ agentId: adapter.id, exitCode: null, durationMs: Date.now() - started, cancelled: false }) });
  }
  clearTimeout(timer);
  if (processResult?.timedOut) {
    let cancelled = false;
    if (adapter.capabilities?.cancellation && typeof adapter.cancel === 'function') {
      try { cancelled = (await adapter.cancel(turnId))?.cancelled === true; } catch { cancelled = false; }
    }
    return result('timed-out', base, { findings: Object.freeze([`Agent turn exceeded ${timeoutMs}ms.`]), processEvidence: Object.freeze({ agentId: adapter.id, exitCode: null, durationMs: Date.now() - started, cancelled }) });
  }
  if (!processResult || typeof processResult !== 'object' || !Number.isInteger(processResult.exitCode)) return result('invalid-output', base, { findings: Object.freeze(['Agent process result is malformed.']) });
  const processEvidence = Object.freeze({ agentId: adapter.id, exitCode: processResult.exitCode, durationMs: Number.isFinite(processResult.durationMs) ? processResult.durationMs : Date.now() - started, cancelled: false });
  if (processResult.exitCode !== 0) return result('failed', base, { findings: Object.freeze([String(processResult.stderr ?? `Agent exited with code ${processResult.exitCode}`).slice(0, 4096)]), processEvidence });
  const stdout = typeof processResult.stdout === 'string' || Buffer.isBuffer(processResult.stdout) ? String(processResult.stdout) : '';
  if (Buffer.byteLength(stdout) > maxOutputBytes) return result('budget-exceeded', base, { findings: Object.freeze([`Agent output exceeds ${maxOutputBytes} bytes.`]), processEvidence });
  let parsed;
  try { parsed = JSON.parse(stdout); } catch { return result('invalid-output', base, { findings: Object.freeze(['Agent output is not valid JSON.']), processEvidence }); }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed) || !parsed.proposal || typeof parsed.proposal !== 'object' || Array.isArray(parsed.proposal) || !Array.isArray(parsed.findings) || parsed.findings.some((entry) => typeof entry !== 'string')) return result('invalid-output', base, { findings: Object.freeze(['Agent output does not satisfy the runtime response contract.']), processEvidence });
  let usage;
  try {
    usage = Object.freeze({ inputTokens: usageValue(processResult.usage?.inputTokens, 'inputTokens'), outputTokens: usageValue(processResult.usage?.outputTokens, 'outputTokens'), cost: usageValue(processResult.usage?.cost, 'cost') });
  } catch (error) { return result('invalid-output', base, { findings: Object.freeze([error.message]), processEvidence }); }
  const exceeded = [
    ['inputTokens', limits.maxInputTokens], ['outputTokens', limits.maxOutputTokens], ['cost', limits.maxCost],
  ].find(([name, limit]) => Number.isFinite(limit) && usage[name] !== 'unverified' && usage[name] > limit);
  if (exceeded) return result('budget-exceeded', base, { findings: Object.freeze([`Agent usage ${exceeded[0]} exceeds budget ${exceeded[1]}.`]), usage, processEvidence });
  return result('succeeded', base, { proposal: Object.freeze({ ...parsed.proposal }), findings: Object.freeze([...parsed.findings]), usage, processEvidence });
}

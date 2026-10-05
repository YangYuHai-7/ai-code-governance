import { usageError } from '../../kernel/index.mjs';

const AGENT_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const CAPABILITIES = new Set(['structuredRequirement', 'architectureProposal', 'boundedPatch', 'usageEvidence', 'cancellation', 'resume']);

function positiveInteger(value, fallback, name) {
  const actual = value ?? fallback;
  if (!Number.isSafeInteger(actual) || actual < 1) throw usageError(`${name} must be a positive integer.`);
  return actual;
}

export function createStructuredAgentAdapter({ id, capabilities = {}, invoke }) {
  if (typeof id !== 'string' || !AGENT_ID.test(id)) throw usageError('Invalid structured agent id.');
  if (typeof invoke !== 'function') throw usageError('Structured agent invoke must be a function.');
  if (!capabilities || typeof capabilities !== 'object' || Array.isArray(capabilities)) throw usageError('Structured agent capabilities must be an object.');
  for (const [name, supported] of Object.entries(capabilities)) {
    if (!CAPABILITIES.has(name) || typeof supported !== 'boolean') throw usageError(`Invalid structured agent capability: ${name}.`);
  }
  const declared = Object.freeze(Object.fromEntries([...CAPABILITIES].map((name) => [name, capabilities[name] === true])));

  return Object.freeze({
    id,
    capabilities: declared,
    async generateStructured(request) {
      if (!request || typeof request !== 'object' || Array.isArray(request)) throw usageError('Structured generation request must be an object.');
      if (typeof request.prompt !== 'string' || request.prompt.length === 0) throw usageError('Structured generation prompt is required.');
      const maxInputBytes = positiveInteger(request.maxInputBytes, 256 * 1024, 'maxInputBytes');
      const maxOutputBytes = positiveInteger(request.maxOutputBytes, 2 * 1024 * 1024, 'maxOutputBytes');
      const timeoutMs = positiveInteger(request.timeoutMs, 120_000, 'timeoutMs');
      const inputBytes = Buffer.byteLength(request.prompt);
      if (inputBytes > maxInputBytes) throw usageError(`Structured agent input exceeds limit ${maxInputBytes} bytes.`);
      const startedAt = new Date().toISOString();
      const result = await invoke(Object.freeze({ ...request, timeoutMs, maxOutputBytes }));
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw usageError('Structured agent returned no process result.');
      const stdout = typeof result.stdout === 'string' || Buffer.isBuffer(result.stdout) ? result.stdout : '';
      const stderr = typeof result.stderr === 'string' || Buffer.isBuffer(result.stderr) ? result.stderr : '';
      const outputBytes = Buffer.byteLength(stdout);
      if (outputBytes > maxOutputBytes) throw usageError(`Structured agent output exceeds limit ${maxOutputBytes} bytes.`);
      if (!Number.isInteger(result.exitCode)) throw usageError('Structured agent result requires an integer exit code.');
      if (result.exitCode !== 0) throw usageError(`Structured agent exited with code ${result.exitCode}: ${String(stderr).slice(0, 1024)}`);
      let candidate;
      try { candidate = JSON.parse(String(stdout)); }
      catch { throw usageError('Structured agent output must be valid JSON.'); }
      return Object.freeze({
        candidate,
        bytes: outputBytes,
        processEvidence: Object.freeze({
          agentId: id,
          status: 'succeeded',
          exitCode: result.exitCode,
          durationMs: Number.isFinite(result.durationMs) && result.durationMs >= 0 ? result.durationMs : null,
          startedAt,
          usage: result.usage && typeof result.usage === 'object' ? Object.freeze({ ...result.usage }) : null,
          inputBytes,
          outputBytes,
          semanticApproval: false,
        }),
      });
    },
  });
}

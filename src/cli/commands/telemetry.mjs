import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { checkProject } from '../../checker.mjs';
import { scanProject } from '../../scanner.mjs';
import { TELEMETRY_PATH, evaluateEquilibrium, loadTelemetryStore, recordTelemetry } from '../../modules/governance/index.mjs';

/**
 * `telemetry` is the explicit writer and reader for the dynamic-equilibrium loop. Recording is
 * a deliberate, side-effecting action on the evidence plane; reading only reports a
 * hysteresis-gated recommendation. Neither path edits a rule, a route, or a budget, so the
 * owner keeps the approval authority that every other governance change already requires.
 */
export function telemetryCommand(target, action, options = {}) {
  const root = path.resolve(target);
  if (action === 'record') {
    let telemetry = null;
    try { telemetry = checkProject(scanProject(root)).telemetry ?? null; } catch { telemetry = null; }
    const result = recordTelemetry(root, telemetry, { routeLevel: options['task-level'] ?? null });
    const output = {
      recorded: result.recorded,
      runId: result.record.runId,
      records: result.store.records.length,
      telemetryPath: TELEMETRY_PATH,
      boundary: 'Records one gate observation in the evidence plane. It changes no rule, route, or budget, and approves nothing.',
    };
    if (options.json) { console.log(JSON.stringify(output, null, 2)); return output; }
    console.log('telemetry_recorded=' + output.recorded + ' records=' + output.records + ' run=' + output.runId.slice(0, 12));
    console.log('store=' + output.telemetryPath);
    return output;
  }
  if (action !== 'status') throw usageError('telemetry requires an action: record or status.');
  const result = evaluateEquilibrium(loadTelemetryStore(root));
  if (options.json) { console.log(JSON.stringify(result, null, 2)); return result; }
  console.log('equilibrium=' + result.recommendation.actuator + ' status=' + result.recommendation.status + ' records=' + result.records);
  console.log('window findings=' + result.windows.consecutiveFindings + ' clean=' + result.windows.consecutiveClean + ' pressure=' + (result.budgetPressure ?? 'unmeasured'));
  console.log('recommendation=' + result.recommendation.reason);
  return result;
}

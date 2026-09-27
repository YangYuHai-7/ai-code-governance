import path from 'node:path';
import { assertNoLinkAncestor, exists, readJson, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { sha256, stableJson } from '../../shared/index.mjs';

/**
 * Gate telemetry is the sensor half of the dynamic-equilibrium loop. It lives in the evidence
 * plane (`.ai-governance/evidence/`) on purpose: no agent loads it, no context-map slice
 * routes to it, and `aicg check` never writes it. Only an explicit `aicg telemetry record`
 * appends a bounded observation, so a read-only check can never mutate state.
 */
export const TELEMETRY_PATH = '.ai-governance/evidence/gate-telemetry.json';
export const TELEMETRY_SCHEMA_VERSION = 1;
export const MAX_TELEMETRY_RECORDS = 50;

/**
 * Hysteresis thresholds. The loop reacts to an uninterrupted window, never to one run, and the
 * promote and tighten windows are disjoint lengths so the framework cannot flap between them.
 */
export const EQUILIBRIUM = Object.freeze({
  promoteAfter: 3,
  demoteAfter: 5,
  budgetWarnRatio: 0.8,
});

function totalFindings(findings) {
  return (findings?.structure ?? 0) + (findings?.reachability ?? 0) + (findings?.evidence ?? 0);
}

function observation(telemetry) {
  const findings = telemetry?.findings ?? { structure: 0, reachability: 0, evidence: 0 };
  const context = telemetry?.context ?? null;
  return {
    findings,
    warnings: telemetry?.warnings ?? 0,
    orphans: telemetry?.orphans ?? 0,
    context: context && context.declared
      ? { startup: context.startup ?? null, profiles: context.profiles ?? {}, declared: context.declared }
      : null,
  };
}

export function loadTelemetryStore(root) {
  const absolute = path.join(root, TELEMETRY_PATH);
  if (!exists(absolute)) return { schemaVersion: TELEMETRY_SCHEMA_VERSION, records: [] };
  try {
    const store = readJson(absolute);
    if (!store || store.schemaVersion !== TELEMETRY_SCHEMA_VERSION || !Array.isArray(store.records)) {
      return { schemaVersion: TELEMETRY_SCHEMA_VERSION, records: [] };
    }
    return store;
  } catch {
    return { schemaVersion: TELEMETRY_SCHEMA_VERSION, records: [] };
  }
}

/**
 * Append one observation. A repeated observation is not new evidence: re-running the same
 * check must not satisfy a hysteresis window by itself, so an identical `runId` is ignored.
 */
export function recordTelemetry(root, telemetry, { at = new Date().toISOString(), routeLevel = null } = {}) {
  const store = loadTelemetryStore(root);
  const observed = observation(telemetry);
  const record = {
    at,
    routeLevel,
    runId: sha256(stableJson(observed)),
    totalFindings: totalFindings(observed.findings),
    ...observed,
  };
  const previous = store.records.at(-1);
  const duplicate = Boolean(previous && previous.runId === record.runId);
  const records = (duplicate ? store.records : [...store.records, record]).slice(-MAX_TELEMETRY_RECORDS);
  if (!duplicate) {
    assertNoLinkAncestor(root, TELEMETRY_PATH);
    writeAtomicFile(path.join(root, TELEMETRY_PATH), JSON.stringify({
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      records,
      boundary: 'Evidence-plane gate telemetry: loaded by no agent context and consumed only by aicg telemetry status.',
    }, null, 2) + '\n', 0o600);
  }
  return { recorded: !duplicate, record, store: { schemaVersion: TELEMETRY_SCHEMA_VERSION, records } };
}

function recordPressure(record) {
  const context = record?.context;
  const declared = context?.declared;
  if (!context || !declared) return null;
  const ratios = [];
  if (Number.isFinite(context.startup) && Number.isFinite(declared.startup) && declared.startup > 0) ratios.push(context.startup / declared.startup);
  for (const value of Object.values(context.profiles ?? {})) {
    if (Number.isFinite(value) && Number.isFinite(declared.profile) && declared.profile > 0) ratios.push(value / declared.profile);
  }
  return ratios.length ? Math.max(...ratios) : null;
}

function trailingCount(values, predicate) {
  let count = 0;
  for (let index = values.length - 1; index >= 0; index -= 1) {
    if (!predicate(values[index])) break;
    count += 1;
  }
  return count;
}

/**
 * Deterministic hysteresis policy. A promote window and a tighten window cannot both be
 * satisfied by the same run sequence, and short or alternating windows hold, so the loop
 * cannot oscillate on noise. The output is a recommendation: nothing here writes governance.
 */
export function evaluateEquilibrium(store) {
  const records = Array.isArray(store?.records) ? store.records : [];
  const pressures = records.map(recordPressure);
  const consecutiveFindings = trailingCount(records, (record) => (record.totalFindings ?? 0) > 0);
  const consecutiveClean = trailingCount(records, (record) => (record.totalFindings ?? 0) === 0);
  const consecutivePressure = trailingCount(pressures, (value) => value !== null && value >= EQUILIBRIUM.budgetWarnRatio);
  const latestPressure = pressures.at(-1) ?? null;
  let recommendation;
  if (records.length < EQUILIBRIUM.promoteAfter) {
    recommendation = {
      actuator: 'hold',
      status: 'insufficient-evidence',
      reason: 'at least ' + EQUILIBRIUM.promoteAfter + ' recorded runs are required before the loop can act; recorded ' + records.length,
      evidence: { records: records.length },
    };
  } else if (consecutivePressure >= EQUILIBRIUM.promoteAfter) {
    recommendation = {
      actuator: 'widen-budget',
      status: 'recommended',
      reason: consecutivePressure + ' consecutive runs at or above ' + EQUILIBRIUM.budgetWarnRatio + ' of the declared context budget; narrow the routed profile or raise the budget through the existing exact-plan approval',
      evidence: { consecutivePressure, latestPressure },
    };
  } else if (consecutiveFindings >= EQUILIBRIUM.promoteAfter) {
    recommendation = {
      actuator: 'promote-coverage',
      status: 'recommended',
      reason: consecutiveFindings + ' consecutive runs reported findings; add or strengthen a gate for the recurring class through the existing exact-plan approval',
      evidence: { consecutiveFindings },
    };
  } else if (consecutiveClean >= EQUILIBRIUM.demoteAfter && latestPressure !== null && latestPressure < EQUILIBRIUM.budgetWarnRatio) {
    recommendation = {
      actuator: 'tighten-budget',
      status: 'recommended',
      reason: consecutiveClean + ' consecutive clean runs at pressure ' + latestPressure.toFixed(2) + '; ratchet the declared budget toward the observed usage',
      evidence: { consecutiveClean, latestPressure },
    };
  } else {
    recommendation = {
      actuator: 'hold',
      status: 'hold',
      reason: 'no uninterrupted window reaches a threshold; hysteresis keeps a single run from moving the framework',
      evidence: { consecutiveFindings, consecutiveClean, consecutivePressure },
    };
  }
  return {
    schemaVersion: 1,
    records: records.length,
    windows: { consecutiveFindings, consecutiveClean, consecutivePressure },
    thresholds: { ...EQUILIBRIUM },
    budgetPressure: latestPressure,
    recommendation,
    boundary: 'Recommendations only. The loop never promotes, demotes, or rewrites a rule by itself; apply every change through the existing exact-plan approval flow. Telemetry lives in the evidence plane and is loaded by no agent context.',
  };
}

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseArgs } from '../src/cli/args.mjs';
import { telemetryCommand } from '../src/cli/commands/telemetry.mjs';
import {
  EQUILIBRIUM,
  MAX_TELEMETRY_RECORDS,
  TELEMETRY_PATH,
  evaluateEquilibrium,
  loadTelemetryStore,
  recordTelemetry,
} from '../src/modules/governance/telemetry.mjs';

function fixture(context, name) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-telemetry-' + name + '-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function observation({ findings = 0, startup = 900, declaredStartup = 3500, profile = 1200, declaredProfile = 7000 } = {}) {
  return {
    findings: { structure: findings, reachability: 0, evidence: 0 },
    warnings: 0,
    orphans: 0,
    context: { startup, profiles: { base: profile }, declared: { startup: declaredStartup, profile: declaredProfile, maxRequiredFiles: 8 } },
  };
}

test('telemetry requires an explicit record or status action', () => {
  assert.deepEqual(parseArgs(['telemetry', 'record', '.', '--json']), { command: 'telemetry', action: 'record', target: '.', options: { json: true } });
  assert.equal(parseArgs(['telemetry', 'status', 'project']).action, 'status');
  assert.throws(() => parseArgs(['telemetry']), /telemetry requires an action/);
  assert.throws(() => parseArgs(['telemetry', 'apply', '.']), /telemetry requires an action/);
});

test('recording deduplicates an identical observation so a rerun cannot satisfy a window', (context) => {
  const root = fixture(context, 'dedupe');
  const first = recordTelemetry(root, observation({ findings: 1 }), { at: '2026-09-27T00:00:00.000Z' });
  assert.equal(first.recorded, true);
  assert.equal(first.store.records.length, 1);
  const second = recordTelemetry(root, observation({ findings: 1 }), { at: '2026-09-27T00:01:00.000Z' });
  assert.equal(second.recorded, false);
  assert.equal(second.store.records.length, 1);
  const changed = recordTelemetry(root, observation({ findings: 2 }));
  assert.equal(changed.recorded, true);
  assert.equal(changed.store.records.length, 2);
  assert.ok(fs.existsSync(path.join(root, TELEMETRY_PATH)));
  const persisted = JSON.parse(fs.readFileSync(path.join(root, TELEMETRY_PATH), 'utf8'));
  assert.equal(persisted.schemaVersion, 1);
  assert.match(persisted.boundary, /Evidence-plane/);
});

test('hysteresis holds below the threshold and on alternating windows', (context) => {
  const root = fixture(context, 'hysteresis');
  assert.equal(evaluateEquilibrium(loadTelemetryStore(root)).recommendation.status, 'insufficient-evidence');
  recordTelemetry(root, observation({ findings: 1 }));
  recordTelemetry(root, observation({ findings: 2 }));
  assert.equal(evaluateEquilibrium(loadTelemetryStore(root)).recommendation.status, 'insufficient-evidence');
  recordTelemetry(root, observation({ findings: 1 }));
  const promoted = evaluateEquilibrium(loadTelemetryStore(root));
  assert.equal(promoted.recommendation.actuator, 'promote-coverage');
  assert.equal(promoted.windows.consecutiveFindings, EQUILIBRIUM.promoteAfter);
  // A single clean run breaks the finding window: no promote and no immediate demote either.
  recordTelemetry(root, observation({ findings: 0 }));
  const held = evaluateEquilibrium(loadTelemetryStore(root));
  assert.equal(held.recommendation.actuator, 'hold');
  assert.equal(held.recommendation.status, 'hold');
});

test('five clean runs at low pressure recommend tightening the budget, never widening', (context) => {
  const root = fixture(context, 'tighten');
  for (let index = 0; index < EQUILIBRIUM.demoteAfter; index += 1) recordTelemetry(root, observation({ startup: 500 + index, profile: 800 }));
  const result = evaluateEquilibrium(loadTelemetryStore(root));
  assert.equal(result.recommendation.actuator, 'tighten-budget');
  assert.ok(result.budgetPressure < EQUILIBRIUM.budgetWarnRatio);
});

test('recurring budget pressure recommends widening before findings accumulate', (context) => {
  const root = fixture(context, 'widen');
  for (let index = 0; index < EQUILIBRIUM.promoteAfter; index += 1) recordTelemetry(root, observation({ findings: 0, startup: 3200 + index, profile: 6000 }));
  const result = evaluateEquilibrium(loadTelemetryStore(root));
  assert.equal(result.recommendation.actuator, 'widen-budget');
  assert.ok(result.budgetPressure >= EQUILIBRIUM.budgetWarnRatio);
});

test('the store stays bounded and never grows without limit', (context) => {
  const root = fixture(context, 'bounded');
  for (let index = 0; index < MAX_TELEMETRY_RECORDS + 12; index += 1) recordTelemetry(root, observation({ findings: index % 2 }));
  assert.equal(loadTelemetryStore(root).records.length, MAX_TELEMETRY_RECORDS);
});

test('the command records, deduplicates a rerun, and reports a recommendation', (context) => {
  const root = fixture(context, 'command');
  assert.equal(telemetryCommand(root, 'status', { json: true }).recommendation.status, 'insufficient-evidence');
  const first = telemetryCommand(root, 'record', { json: true, 'task-level': 'L2' });
  assert.equal(first.recorded, true);
  assert.equal(first.records, 1);
  assert.ok(fs.existsSync(path.join(root, TELEMETRY_PATH)));
  const second = telemetryCommand(root, 'record', { json: true });
  assert.equal(second.recorded, false);
  assert.equal(second.records, 1);
  assert.throws(() => telemetryCommand(root, 'apply', {}), /telemetry requires an action/);
});

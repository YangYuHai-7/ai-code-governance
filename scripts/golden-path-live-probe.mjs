import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { applyReferenceProbe } from './golden-path-reference-evaluation.mjs';

// Probe detection has to be executed, not asserted by policy: this applies a probe mutation to a
// throwaway copy of the reference workload and runs the affected gates in that mutated tree, with
// the dependency tree linked from the prepared working copy. A probe counts as detected only when
// the gate passes on the untouched copy and fails on the mutated one.
const FIXTURE = process.env.AICG_LIVE_FIXTURE ?? 'test-support/evaluations/golden-path/reference-work-tracker';
const WORK = process.env.AICG_LIVE_WORK ?? '/tmp/aicg-ci';
const TOOLS = {
  'architecture-boundaries': ['node', 'scripts/architecture-check.mjs'],
  'static-types': ['tsc', '--noEmit'],
  'static-format': ['prettier', '--check', '.'],
  'static-lint': ['eslint', '.'],
  'unit-tests': ['vitest', 'run', 'tests/unit'],
  'security-probes': ['vitest', 'run', 'tests/security'],
  'requirement-traceability': ['node', 'scripts/traceability-check.mjs'],
  'migration-safety': ['node', 'scripts/migration-check.mjs'],
};

function runTool(projectDir, argv) {
  const link = path.join(projectDir, 'node_modules');
  if (!fs.existsSync(link)) fs.symlinkSync(path.join(WORK, 'node_modules'), link, 'dir');
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: projectDir,
    encoding: 'utf8',
    env: { ...process.env, PATH: [path.join(WORK, 'node_modules/.bin'), process.env.PATH].join(':'), AICG_TRACEABILITY_ROOT: path.resolve(FIXTURE), AICG_ROOT: process.env.AICG_ROOT ?? process.cwd() },
  });
  return { exit: result.status, detail: ((result.stderr || '') + (result.stdout || '')).trim().split('\n').slice(0, 2).join(' | ').slice(0, 200) };
}

function prepare(prepareDir, mutate) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-probe-'));
  if (mutate) applyReferenceProbe({ fixtureRoot: FIXTURE, workRoot: root, faultId: mutate });
  else fs.cpSync(FIXTURE, root, { recursive: true });
  return path.join(root, 'project');
}

const faults = process.argv.slice(2);
const ids = faults.length > 0 ? faults : ['cross-layer-import'];
const report = [];
for (const faultId of ids) {
  const baseline = runTool(prepare(null, null), TOOLS['architecture-boundaries']);
  const probeRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-probe-m-'));
  const applied = applyReferenceProbe({ fixtureRoot: FIXTURE, workRoot: probeRoot, faultId });
  const results = {};
  for (const gate of applied.affectedGates) {
    const argv = TOOLS[gate];
    if (!argv) { results[gate] = { exit: null, detail: 'no live tool mapped' }; continue; }
    results[gate] = runTool(path.join(probeRoot, 'project'), argv);
  }
  const detectedBy = Object.entries(results).filter(([, value]) => value.exit !== null && value.exit !== 0).map(([gate]) => gate);
  report.push({ faultId, affectedGates: applied.affectedGates, changedPaths: applied.changedPaths.length, baselineArchitecture: baseline.exit, results, detectedBy, detected: detectedBy.length > 0 });
  fs.rmSync(probeRoot, { recursive: true, force: true });
}
const target = process.env.AICG_LIVE_PROBE_REPORT;
if (target) fs.writeFileSync(target, JSON.stringify(report, null, 2));
process.stdout.write(JSON.stringify(report, null, 1) + '\n');
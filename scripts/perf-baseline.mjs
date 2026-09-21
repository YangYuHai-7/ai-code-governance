import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { buildArtifacts, defaultConfig } from '../src/generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../src/managed-files.mjs';
import { scanProject } from '../src/scanner.mjs';
import { minimumTaskLevelFromPaths } from '../src/modules/governance/task-routing.mjs';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cli = path.join(packageRoot, 'bin/aicg.js');
const warmups = 3;
const samples = 20;

export function summarize(samplesMs) {
  const sorted = [...samplesMs].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return {
    medianMs: sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2,
    p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1],
    samplesMs,
  };
}

function sample(operation) {
  const times = [];
  for (let index = 0; index < warmups + samples; index += 1) {
    const started = performance.now();
    operation();
    if (index >= warmups) times.push(performance.now() - started);
  }
  return summarize(times);
}

function runNode(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', timeout: 30_000, maxBuffer: 8 * 1024 * 1024,
    // Node's test worker marker would make nested --test silently run no tests.
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'NODE_TEST_CONTEXT')),
  });
  if (result.status !== 0) throw new Error(`node ${args.join(' ')} failed (${result.status}): ${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
  return result.stdout;
}

function contextEstimate(artifacts) {
  const byPath = new Map(artifacts.map((artifact) => [artifact.path, artifact.content]));
  const map = byPath.get('docs/ai/context-map.yaml');
  // Count the ordinary profile's inherited closure, not unrelated conditional profiles.
  const ordinaryMap = map.slice(0, map.indexOf('  behavior_change:'));
  const required = [...ordinaryMap.matchAll(/^\s+- (docs\/[^\s]+)$/gm)].map((match) => match[1]);
  const paths = [...new Set(['AGENTS.md', 'docs/ai/context-map.yaml', ...required])];
  const contents = paths.map((relative) => relative === 'docs/ai/context-map.yaml' ? ordinaryMap : byPath.get(relative));
  if (contents.some((content) => typeof content !== 'string')) throw new Error('Ordinary context has an unresolved path');
  const text = contents.join('\n');
  if (/release-check|harvest|promote|reviews\/|reports\//i.test(text)) throw new Error('Ordinary context includes deferred workflow content');
  return { files: paths.length, paths, bytes: Buffer.byteLength(text), estimatedTokens: Math.ceil(text.length / 4), estimateMethod: 'ordinary profile closure, characters / 4' };
}

function fixtureReport(parent, name, totalFiles, limitMs = null) {
  const root = path.join(parent, name);
  fs.mkdirSync(path.join(root, 'src'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src/main.mjs'), 'export const ready = true;\n');
  const initialScan = scanProject(root);
  const config = { ...defaultConfig(initialScan), clients: ['codex'], governanceDepth: 'minimal', invocationMode: 'project-local' };
  const artifacts = buildArtifacts(config, initialScan);
  applyArtifactPlan(root, planArtifacts(root, artifacts));
  const initialCount = scanProject(root).files.length;
  for (let index = initialCount; index < totalFiles; index += 1) {
    const directory = path.join(root, 'src', `group-${Math.floor(index / 500)}`);
    fs.mkdirSync(directory, { recursive: true });
    fs.writeFileSync(path.join(directory, `module-${index}.mjs`), `export const value = ${index};\n`);
  }
  const scan = scanProject(root);
  if (!scan.scanBudget.complete || scan.files.length !== totalFiles) throw new Error(`${name}: fixture scan must include exactly ${totalFiles} files`);
  const before = scan.files.reduce((sum, file) => sum + (file.size ?? 0), 0);
  const check = sample(() => {
    const result = JSON.parse(runNode([cli, 'check', root, '--json'], root));
    if (!result.ok) throw new Error(`${name}: check did not pass`);
  });
  const after = scanProject(root);
  if (after.files.length !== totalFiles || after.files.reduce((sum, file) => sum + (file.size ?? 0), 0) !== before) throw new Error(`${name}: check mutated the fixture`);
  return { name, files: totalFiles, bytes: before, context: contextEstimate(artifacts), check: { ...check, ok: true, processesPerSample: 1 }, hardGate: limitMs !== null, limitMs };
}

export function budgetViolations(report, baseline = null) {
  const violations = [];
  const metrics = [
    ...report.fixtures.filter((fixture) => fixture.hardGate).map((fixture) => ({ name: fixture.name, current: fixture.check.p95Ms, limit: fixture.limitMs, previous: baseline?.fixtures?.find((entry) => entry.name === fixture.name)?.check.p95Ms, jitterMs: 100 })),
    ...(report.fast ? [{ name: 'fast', current: report.fast.p95Ms, limit: 7000, previous: baseline?.fast?.p95Ms, jitterMs: 750 }] : []),
    { name: 'routing', current: report.routing.p95Ms, limit: 20, previous: baseline?.routing?.p95Ms, jitterMs: 2 },
  ];
  for (const metric of metrics) {
    if (metric.current > metric.limit) violations.push(`${metric.name} p95 ${metric.current.toFixed(2)}ms exceeds absolute ${metric.limit}ms`);
    if (Number.isFinite(metric.previous)) {
      const relativeLimit = Math.max(metric.previous * 1.5, metric.previous + metric.jitterMs);
      if (metric.current > relativeLimit) violations.push(`${metric.name} p95 exceeds relative baseline ${relativeLimit.toFixed(2)}ms`);
    }
  }
  for (const fixture of report.fixtures) {
    if (fixture.context.files > 3 || fixture.context.estimatedTokens > 900) violations.push(`${fixture.name} ordinary context exceeds 3 files / 900 estimated tokens`);
  }
  return violations;
}

export function runBaseline({ baseline = null, checksOnly = false } = {}) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-perf-'));
  try {
    const fixtures = [fixtureReport(parent, 'small', 32, 250), fixtureReport(parent, '10k', 10000, 1000), fixtureReport(parent, '50k', 50000)];
    const routing = sample(() => minimumTaskLevelFromPaths(['src/modules/billing/service.mjs', 'test/billing.test.mjs']));
    const { scripts } = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    const fastArgs = scripts['test:fast'].split(/\s+/);
    if (fastArgs.shift() !== 'node' || fastArgs[0] !== '--test' || fastArgs.some((arg) => /performance-budget/.test(arg))) throw new Error('test:fast must be a nonrecursive node --test command');
    const fast = checksOnly ? null : sample(() => runNode(fastArgs, packageRoot));
    const report = {
      schemaVersion: 1, measuredAt: new Date().toISOString(), platform: process.platform, arch: process.arch, node: process.version,
      warmups, samples, fixtures, routing, fast,
      relativeBaseline: baseline ? 'compared: max(1.5x prior p95, prior p95 + jitter allowance); absolute caps still apply' : 'not supplied; use --baseline <previous-report.json> on the same runner class',
    };
    return { ...report, violations: budgetViolations(report, baseline) };
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const baselineIndex = args.indexOf('--baseline');
  const baseline = baselineIndex === -1 ? null : JSON.parse(fs.readFileSync(args[baselineIndex + 1], 'utf8'));
  const report = runBaseline({ baseline, checksOnly: args.includes('--checks-only') });
  console.log(JSON.stringify(report, null, 2));
  if (report.violations.length) process.exitCode = 1;
}

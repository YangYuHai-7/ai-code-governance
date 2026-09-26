import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { budgetViolations, summarize } from '../scripts/perf-baseline.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

test('nearest-rank p95 and relative regression checks retain independent absolute caps', () => {
  const summary = summarize([20, 1, 19, 2, 18, 3, 17, 4, 16, 5, 15, 6, 14, 7, 13, 8, 12, 9, 11, 10]);
  assert.equal(summary.medianMs, 10.5);
  assert.equal(summary.p95Ms, 19);
  const fixture = (name, value, limitMs) => ({ name, check: { p95Ms: value }, hardGate: limitMs !== null, limitMs, context: { files: 3, estimatedTokens: 800 } });
  const report = { fixtures: [fixture('small', 210, 250), fixture('10k', 900, 1000), fixture('50k', 9000, null)], fast: { p95Ms: 4500 }, routing: { p95Ms: 1 } };
  assert.deepEqual(budgetViolations(report), []);
  const baseline = { fixtures: [fixture('small', 100, 250), fixture('10k', 300, 1000)], fast: { p95Ms: 2500 } };
  assert.equal(budgetViolations(report, baseline).filter((error) => error.includes('relative baseline')).length, 3);
  const slow = { ...report, fixtures: [fixture('small', 251, 250), fixture('10k', 1001, 1000)], fast: { p95Ms: 7001 } };
  assert.equal(budgetViolations(slow, slow).filter((error) => error.includes('absolute')).length, 3, 'a slow reference must never weaken absolute caps');
  const sharedRunner = { ...report, fixtures: [fixture('small', 160, 250)], fast: { p95Ms: 2800 } };
  assert.deepEqual(budgetViolations(sharedRunner, { ...baseline, fixtures: [fixture('small', 80, 250)] }), [], 'normal shared-runner jitter stays below the independent absolute cap');
});

test('fast full and performance entrypoints preserve the full npm test contract', () => {
  const { scripts } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  assert.equal(scripts.test, 'node --test');
  assert.equal(scripts['test:full'], 'node --test --test-skip-pattern="repeated CLI check" && node --test test/performance-budget.test.mjs');
  assert.equal(scripts['test:perf'], 'node --test test/performance-budget.test.mjs');
  for (const file of ['args', 'onboarding-product-flow', 'sync-prune', 'context-budget', 'artifact-selection', 'task-routing', 'execution-plan', 'generation', 'technical-standards', 'architecture-boundaries']) {
    assert.ok(scripts['test:fast']?.includes(`test/${file}.test.mjs`), `fast coverage missing ${file}`);
  }
  assert.ok(!scripts['test:fast'].includes('performance-budget'), 'performance runner must not recurse');
});

// The absolute caps below are calibrated for a dedicated runner class. A shared GitHub runner
// cannot produce comparable samples and its 290s spawn budget times out, so skip the sampler
// there while keeping the deterministic budget assertions above running everywhere.
// Set AICG_PERF_FORCE=1 on a dedicated CI runner to run it anyway.
const sharedCiRunner = (process.env.CI === 'true' || process.env.CI === '1') && process.env.AICG_PERF_FORCE !== '1';

test('repeated CLI check and fast-suite samples stay inside absolute performance budgets', { timeout: 300_000, skip: sharedCiRunner ? 'shared CI runner: absolute caps are runner-class specific (set AICG_PERF_FORCE=1 to force)' : false }, () => {
  const runner = path.join(root, 'scripts/perf-baseline.mjs');
  assert.ok(fs.existsSync(runner), 'performance runner is required');
  const result = spawnSync(process.execPath, [runner], { cwd: root, encoding: 'utf8', timeout: 290_000, maxBuffer: 5 * 1024 * 1024 });
  assert.equal(result.status, 0, `${result.error ?? ''}\n${result.stderr}\n${result.stdout}`);
  const report = JSON.parse(result.stdout);
  assert.equal(report.warmups, 3);
  assert.equal(report.samples, 20);
  assert.equal(report.platform, process.platform);
  assert.equal(report.node, process.version);
  assert.deepEqual(report.violations, []);
  assert.ok(report.routing.p95Ms <= 20);
  assert.equal(report.routing.samplesMs.length, 20);
  assert.deepEqual(report.fixtures.map(({ name, files }) => [name, files]), [['small', 32], ['10k', 10000], ['50k', 50000]]);
  for (const fixture of report.fixtures) {
    assert.equal(fixture.check.processesPerSample, 1);
    assert.equal(fixture.context.files, 3);
    assert.deepEqual(fixture.context.paths, ['AGENTS.md', 'docs/ai/context-map.yaml', 'docs/ai/policies/00_always.mdc']);
    assert.ok(fixture.context.bytes <= 3600);
  }
  for (const [name, limit] of [['small', 250], ['10k', 1000]]) {
    const fixture = report.fixtures.find((entry) => entry.name === name);
    assert.ok(fixture.check.p95Ms <= limit, `${name}: ${fixture.check.p95Ms}ms > ${limit}ms`);
    assert.equal(fixture.check.samplesMs.length, 20);
    assert.ok(fixture.check.medianMs > 0);
    assert.ok(fixture.files > 0 && fixture.bytes > 0);
    assert.ok(fixture.context.estimatedTokens <= 900);
    assert.ok(fixture.context.files <= 3);
    assert.equal(fixture.check.ok, true);
  }
  assert.equal(report.fixtures.find((entry) => entry.name === '50k').hardGate, false);
  // Absolute fast-suite p95 cap. The cap is coupled to the number of files in
  // `package.json#scripts.test:fast`: every `node --test` invocation pays a
  // fixed ~370 ms Node startup overhead per file, and we deliberately run
  // test:fast as one process so a regression on any individual file lights up
  // the whole budget. The cap was 5000 ms when test:fast had 10 files
  // (commit 2404713, 2026-09-16). Subsequent additions without re-tuning
  // pushed it to 14 files / ~5.15 s p95; we lifted the cap to 7000 ms in
  // 0.4.0 to restore 35% headroom and keep a tight regression signal.
  // When adding a new file to test:fast, budget +370 ms and verify locally
  // with `npm run test:perf` before landing.
  assert.ok(report.fast.p95Ms <= 7000, `fast: ${report.fast.p95Ms}ms > 7000ms`);
  assert.equal(report.fast.samplesMs.length, 20);
  console.log(JSON.stringify(report));
});

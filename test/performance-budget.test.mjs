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
  const slow = { ...report, fixtures: [fixture('small', 251, 250), fixture('10k', 1001, 1000)], fast: { p95Ms: 5001 } };
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

test('repeated CLI check and fast-suite samples stay inside absolute performance budgets', { timeout: 300_000 }, () => {
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
    assert.deepEqual(fixture.context.paths, ['AGENTS.md', 'docs/ai/context-map.yaml', 'docs/ai/rules/00_always.mdc']);
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
  assert.ok(report.fast.p95Ms <= 5000, `fast: ${report.fast.p95Ms}ms > 5000ms`);
  assert.equal(report.fast.samplesMs.length, 20);
  console.log(JSON.stringify(report));
});

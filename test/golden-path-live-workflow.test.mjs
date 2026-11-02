import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const workflow = fs.readFileSync(path.join(testRoot, '..', '.github/workflows/golden-path-evaluation.yml'), 'utf8');
const reference = fs.readFileSync(path.join(testRoot, '..', 'scripts/golden-path-reference-evaluation.mjs'), 'utf8');
const live = fs.readFileSync(path.join(testRoot, '..', 'scripts/golden-path-live-evaluation.mjs'), 'utf8');

test('the manual evaluation workflow refuses a host that cannot execute the gates', () => {
  assert.match(workflow, /Verify this runner can inspect reality/);
  assert.match(workflow, /needs a provisioned host/);
  assert.match(workflow, /exit 1/);
});

test('the manual evaluation workflow runs the live drivers and validates a matrix run', () => {
  assert.match(workflow, /scripts\/golden-path-live-evaluation\.mjs/);
  assert.doesNotMatch(workflow, /node scripts\/golden-path-reference-evaluation\.mjs --fixture/);
  assert.match(workflow, /validateQualityMatrixRun/);
  assert.doesNotMatch(workflow, /validateGoldenPathEvaluation/);
});

test('the reference harness keeps its work root portable and the live harness resolves executables per platform', () => {
  assert.match(reference, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\)/);
  assert.doesNotMatch(reference, /process\.env\.TMPDIR/);
  assert.match(live, /process\.platform === 'win32'/);
  assert.match(live, /playwright\.cmd/);
});

test('the live harness can exercise an operator-provisioned authenticated session', () => {
  assert.match(live, /AICG_LIVE_SESSION_TOKEN/);
  assert.match(live, /authorization/);
  assert.match(live, /fixtureRoot = process\.env\.AICG_LIVE_FIXTURE/);
  assert.match(live, /fixtureRoot,/);
});

test('live gate commands preserve the authenticated browser build on repeat runs', async () => {
  const { liveCommandEnvironment } = await import('../scripts/golden-path-live-evaluation.mjs');
  const environment = liveCommandEnvironment({ VITE_SESSION_TOKEN: 'stale', VITE_API_BASE_URL: 'http://stale' }, {
    cwd: '/work', root: '/governance', sessionToken: 'active-session', api: 'http://127.0.0.1:3103',
  });
  assert.equal(environment.VITE_SESSION_TOKEN, 'active-session');
  assert.equal(environment.VITE_API_BASE_URL, 'http://127.0.0.1:3103');
  assert.equal(environment.AICG_TRACEABILITY_ROOT, '/work');
  assert.equal(environment.AICG_ROOT, '/governance');
});

test('a blocked live matrix leaves a receipt and exits nonzero', () => {
  const script = path.join(testRoot, '..', 'scripts/golden-path-live-evaluation.mjs');
  const evidenceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-live-exit-test-'));
  let workRoot;
  try {
    const summaryPath = path.join(evidenceRoot, 'summary.json');
    const runPath = path.join(evidenceRoot, 'run.json');
    const fixtureRoot = path.join(testRoot, '..', 'test-support/evaluations/golden-path/reference-work-tracker');
    const executionRoot = path.join(evidenceRoot, 'project');
    fs.cpSync(path.join(fixtureRoot, 'project'), executionRoot, { recursive: true });
    const result = spawnSync(process.execPath, [script], {
      cwd: path.join(testRoot, '..'),
      env: {
        ...process.env,
        AICG_LIVE_DISK_BYTES: '0',
        AICG_LIVE_FIXTURE: fixtureRoot,
        AICG_LIVE_WORK: executionRoot,
        AICG_LIVE_RECEIPT: summaryPath,
        AICG_LIVE_RUN_RECEIPT: runPath,
      },
      encoding: 'utf8',
      timeout: 30000,
    });
    const output = JSON.parse(result.stdout);
    workRoot = output.workRoot;
    assert.equal(output.status, 'blocked');
    assert.equal(output.gates.length, 14);
    const summary = JSON.parse(fs.readFileSync(summaryPath, 'utf8'));
    assert.equal(summary.status, 'blocked');
    assert.match(summary.sourceDigest, /^[a-f0-9]{64}$/);
    assert.equal(JSON.parse(fs.readFileSync(runPath, 'utf8')).status, 'blocked');
    assert.equal(result.status, 1);
  } finally {
    fs.rmSync(evidenceRoot, { recursive: true, force: true });
    if (workRoot && path.dirname(workRoot) === os.tmpdir() && path.basename(workRoot).startsWith('aicg-live-')) {
      fs.rmSync(workRoot, { recursive: true, force: true });
    }
  }
});

test('live evaluation refuses a work tree that differs from the receipt fixture', async () => {
  const { assertLiveWorkloadBinding } = await import('../scripts/golden-path-live-evaluation.mjs');
  const fixtureRoot = path.join(testRoot, '..', 'test-support/evaluations/golden-path/reference-work-tracker');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-live-binding-test-'));
  const workRoot = path.join(scratch, 'project');
  try {
    fs.cpSync(path.join(fixtureRoot, 'project'), workRoot, { recursive: true });
    const baseline = assertLiveWorkloadBinding(fixtureRoot, workRoot);
    assert.match(baseline, /^[a-f0-9]{64}$/);
    fs.appendFileSync(path.join(workRoot, 'apps/web/src/main.tsx'), '\n// local drift probe\n');
    assert.throws(() => assertLiveWorkloadBinding(fixtureRoot, workRoot, baseline), /does not match the declared fixture/i);
    const result = spawnSync(process.execPath, [path.join(testRoot, '..', 'scripts/golden-path-live-evaluation.mjs')], {
      cwd: path.join(testRoot, '..'),
      env: { ...process.env, AICG_LIVE_WORK: workRoot, AICG_LIVE_FIXTURE: fixtureRoot, AICG_LIVE_DISK_BYTES: '0', AICG_LIVE_RECEIPT: '', AICG_LIVE_RUN_RECEIPT: '' },
      encoding: 'utf8',
      timeout: 30000,
    });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /does not match the declared fixture/i);
    assert.equal(result.stdout, '');
  } finally {
    fs.rmSync(scratch, { recursive: true, force: true });
  }
});

test('the negative-probe harness maps API faults to the real integration gate', () => {
  const probes = fs.readFileSync(path.join(testRoot, '..', 'scripts/golden-path-live-probe.mjs'), 'utf8');
  assert.match(probes, /'api-integration':\s*\['run',\s*'test:integration'\]/);
});

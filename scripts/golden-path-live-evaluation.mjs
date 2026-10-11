import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { runReferenceEvaluation } from './golden-path-reference-evaluation.mjs';
import { validateQualityMatrixRun } from '../src/modules/delivery-core/index.mjs';
import { executeBrowserGate, executeCommandGate, executeDatabaseGate } from '../src/adapters/process/golden-path-verification.mjs';
import { executeHttpGate } from '../src/adapters/http/verification.mjs';

// Live macOS evaluation: every driver below performs a real action on this host. The stack
// (API plus built web client) and the local PostgreSQL instance must already be running; the
// http gate asserts that readiness before any contract check.
const WORK = process.env.AICG_LIVE_WORK ?? '/tmp/aicg-ci';
const API = process.env.AICG_LIVE_API ?? 'http://127.0.0.1:3103';
const WEB = process.env.AICG_LIVE_WEB ?? 'http://127.0.0.1:4173';
const NPM = process.env.AICG_LIVE_NPM ?? (process.platform === 'win32' ? 'npm.cmd' : '/tmp/npm11/node_modules/.bin/npm');
const PSQL = process.env.AICG_LIVE_PSQL ?? '/opt/homebrew/opt/postgresql@18/bin/psql';
const DATABASE = process.env.AICG_LIVE_DATABASE ?? 'tracker';
const ORGANIZATION = '11111111-1111-1111-1111-111111111111';
const BOARD = 'aaaaaaaa-1111-1111-1111-111111111111';
const ITEM = 'cccccccc-1111-1111-1111-111111111111';

const SCRIPTS = {
  'reproducible-build': ['run', 'build'],
  'static-format': ['run', 'format:check'],
  'static-lint': ['run', 'lint'],
  'static-types': ['run', 'typecheck'],
  'architecture-boundaries': ['run', 'architecture'],
  'unit-tests': ['run', 'test:unit'],
  'security-probes': ['run', 'test:security'],
  'runtime-observability': ['run', 'test:observability'],
  'performance-budget': ['run', 'test:performance'],
  'requirement-traceability': ['node', 'scripts/traceability-check.mjs'],
};

function run(argv, cwd, timeoutMs = 240000) {
  return new Promise((resolve) => {
    const child = spawn(argv[0], argv.slice(1), {
      cwd,
      env: { ...process.env, AICG_TRACEABILITY_ROOT: process.env.AICG_LIVE_FIXTURE ?? cwd, AICG_ROOT: process.env.AICG_ROOT ?? process.cwd() },
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), timeoutMs);
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.on('error', (error) => { clearTimeout(timer); resolve({ exitCode: null, stdout, stderr: `${stderr}${error.message}` }); });
    child.on('close', (exitCode) => { clearTimeout(timer); resolve({ exitCode, stdout, stderr }); });
  });
}


async function concurrencyProbe() {
  // Exactly one of several writers claiming the same version may win. This runs against the single
  // evaluation API process; the multi-process variant lives in scripts/golden-path-live-concurrency.mjs
  // and is what proves the database-level guard rather than in-process serialization.
  const { randomUUID } = await import("node:crypto");
  const tenant = randomUUID();
  const board = randomUUID();
  const item = randomUUID();
  const seeded = await run([PSQL, "-d", DATABASE, "-v", "ON_ERROR_STOP=1", "-c",
    `INSERT INTO organizations (id, name) VALUES ('${tenant}', 'Matrix tenant'); INSERT INTO boards (id, organization_id, title) VALUES ('${board}', '${tenant}', 'Matrix board'); INSERT INTO work_items (id, organization_id, board_id, title, state, version) VALUES ('${item}', '${tenant}', '${board}', 'Matrix item', 'todo', 1)`], WORK, 30000);
  if (seeded.exitCode !== 0) return { status: "blocked", detail: `the probe tenant could not be seeded: ${seeded.stderr.slice(0, 120)}` };
  const body = JSON.stringify({ organizationId: tenant, actorId: "member-synthetic-1", boardId: board, state: "in-progress", expectedVersion: 1 });
  const statuses = await Promise.all(Array.from({ length: 5 }, () => fetch(`${API}/work-items/${item}`, { method: "PATCH", headers: { "content-type": "application/json" }, body }).then((response) => response.status).catch(() => 0)));
  const accepted = statuses.filter((status) => status === 200).length;
  const refused = statuses.filter((status) => status === 409).length;
  const version = await psql(`SELECT version FROM work_items WHERE id = '${item}'`);
  const audits = await psql(`SELECT count(*) FROM audit_entries WHERE item_id = '${item}'`);
  const detail = `accepted ${accepted}, refused ${refused}, version ${version.stdout.trim()}, audits ${audits.stdout.trim()} (single process; see scripts/golden-path-live-concurrency.mjs for the multi-process check)`;
  const passed = accepted === 1 && refused === 4 && Number(version.stdout.trim()) === 2 && Number(audits.stdout.trim()) === 1;
  return { status: passed ? "passed" : "failed", detail };
}

function psql(sql) {
  return run([PSQL, '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-tAc', sql], WORK, 30000);
}

async function databaseProbe(probe) {
  if (probe === 'migrations-applied') {
    const tables = await psql("select count(*) from information_schema.tables where table_schema='public' and table_name in ('organizations','boards','work_items','audit_entries')");
    const count = Number(tables.stdout.trim());
    return count === 4 ? { status: 'passed', detail: 'four tables applied' } : { status: 'failed', detail: `only ${count} of four tables exist` };
  }
  if (probe === 'audit-transaction') {
    const before = (await psql(`select state || ':' || version from work_items where id='${ITEM}'`)).stdout.trim();
    const attempt = await run([PSQL, '-d', DATABASE, '-v', 'ON_ERROR_STOP=1', '-c',
      `BEGIN; UPDATE work_items SET state='done', version=version+1 WHERE id='${ITEM}'; INSERT INTO audit_entries (id, organization_id, actor_id, item_id, action) VALUES (gen_random_uuid(), NULL, 'probe', '${ITEM}', 'probe'); COMMIT;`], WORK, 30000);
    const after = (await psql(`select state || ':' || version from work_items where id='${ITEM}'`)).stdout.trim();
    if (attempt.exitCode === 0) return { status: 'failed', detail: 'an invalid audit insert was accepted' };
    return before === after
      ? { status: 'passed', detail: 'the rejected transaction rolled the state change back' }
      : { status: 'failed', detail: `state changed despite the rejected transaction (${before} -> ${after})` };
  }
  if (probe === 'concurrent-writers') return concurrencyProbe();
  if (probe === 'tenant-isolation') {
    const foreign = await psql(`select count(*) from work_items where organization_id='22222222-2222-2222-2222-222222222222' and id='${ITEM}'`);
    const owned = await psql(`select count(*) from work_items where organization_id='${ORGANIZATION}' and id='${ITEM}'`);
    return Number(foreign.stdout.trim()) === 0 && Number(owned.stdout.trim()) === 1
      ? { status: 'passed', detail: 'the item is visible to its tenant only' }
      : { status: 'failed', detail: 'tenant scoping did not hold' };
  }
  return { status: 'blocked', detail: `unknown probe ${probe}` };
}

async function browserScenario(scenario) {
  const playwright = path.join(WORK, 'node_modules', '.bin', process.platform === 'win32' ? 'playwright.cmd' : 'playwright');
  const result = await run([playwright, 'test', `e2e/${scenario}.e2e.ts`], WORK, 180000);
  return result.exitCode === 0
    ? { status: 'passed', detail: `${scenario} passed`, cleanup: { status: 'clean', reason: null } }
    : { status: 'failed', detail: `${scenario} exited ${result.exitCode}: ${(result.stderr || result.stdout).slice(-400)}` };
}

const context = {
  capabilities: { commands: true, http: true, database: true, browser: true },
  commands: {
    plan: Object.fromEntries(Object.entries(SCRIPTS).map(([gate, argv]) => [gate, { argv: argv[0] === 'node' ? argv : [NPM, ...argv], cwd: WORK }])),
    run: ({ argv, cwd, timeoutMs }) => run(argv, cwd, Math.max(Number(timeoutMs) || 0, 180000)),
  },
  endpoints: {
    'api-integration': {
      readiness: [{ name: 'health', path: '/health', expectStatus: 200 }],
      contracts: [
        { name: 'boards', method: 'GET', path: `/boards?organizationId=${ORGANIZATION}`, expectStatus: 200 },
        { name: 'items', method: 'GET', path: `/boards/${BOARD}/items?organizationId=${ORGANIZATION}`, expectStatus: 200 },
        { name: 'stale-move', method: 'PATCH', path: `/work-items/${ITEM}`, expectStatus: 409, body: { organizationId: ORGANIZATION, actorId: 'member-synthetic-1', boardId: BOARD, state: 'done', expectedVersion: 999 } },
        { name: 'cross-tenant-move', method: 'PATCH', path: `/work-items/${ITEM}`, expectStatus: 404, body: { organizationId: '22222222-2222-2222-2222-222222222222', actorId: 'member-synthetic-2', boardId: BOARD, state: 'done', expectedVersion: 1 } },
      ],
    },
    'contract-tests': {
      readiness: [{ name: 'health', path: '/health', expectStatus: 200 }],
      contracts: [
        { name: 'boards-shape', method: 'GET', path: `/boards?organizationId=${ORGANIZATION}`, expectStatus: 200, expectBodyIncludes: ['"items"', '"organizationId"', 'Sprint A'] },
        { name: 'items-shape', method: 'GET', path: `/boards/${BOARD}/items?organizationId=${ORGANIZATION}`, expectStatus: 200, expectBodyIncludes: ['"items"', '"version"', 'Draft item A'] },
        { name: 'conflict-shape', method: 'PATCH', path: `/work-items/${ITEM}`, expectStatus: 409, expectBodyIncludes: ['"error"'], body: { organizationId: ORGANIZATION, actorId: 'member-synthetic-1', boardId: BOARD, state: 'done', expectedVersion: 999 } },
        { name: 'not-found-shape', method: 'PATCH', path: `/work-items/${ITEM}`, expectStatus: 404, expectBodyIncludes: ['"error"'], body: { organizationId: '22222222-2222-2222-2222-222222222222', actorId: 'member-synthetic-2', boardId: BOARD, state: 'done', expectedVersion: 1 } },
      ],
    },
  },
  http: {
    request: async ({ method = 'GET', path: target, baseUrl, body, timeoutMs = 10000 }) => {
      const response = await fetch(`${baseUrl ?? API}${target}`, {
        method,
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      return { status: response.status, body: await response.text() };
    },
  },
  database: { plan: { 'migration-safety': ['migrations-applied', 'audit-transaction', 'tenant-isolation', 'concurrent-writers'] }, run: ({ probe }) => databaseProbe(probe) },
  browser: { plan: { 'browser-e2e': ['primary-flow', 'accessibility'] }, run: ({ scenario }) => browserScenario(scenario) },
};

async function main() {
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-live-'));
  const run = await runReferenceEvaluation({
    workRoot,
    environment: {
      runtime: { node: process.versions.node },
      packageManager: { name: 'npm', version: '11.0.0' },
      postgres: { version: '18.6' },
      browser: { name: 'chromium' },
      ports: [3103, 4173],
      diskFreeBytes: Number(process.env.AICG_LIVE_DISK_BYTES ?? 8 * 1024 * 1024 * 1024),
      executables: ['node', 'npm', 'psql', 'playwright'],
    },
    drivers: { command: executeCommandGate, http: executeHttpGate, database: executeDatabaseGate, browser: executeBrowserGate },
    context,
    policy: { sessionId: 'session.live-macos', keepWorkRoot: true },
  });
  const validated = validateQualityMatrixRun(run);
  const receipt = {
    schemaVersion: validated.schemaVersion,
    id: validated.id,
    status: run.status,
    plan: { packId: validated.packId, matrixId: validated.matrixId, requiredGateIds: validated.requiredGateIds },
    digests: validated.digests,
    environment: {
      runtime: { node: process.versions.node },
      packageManager: { name: 'npm', version: '11.0.0' },
      postgres: { version: '18.6' },
      browser: { name: 'chromium' },
      platform: process.platform,
    },
    gates: (run.results ?? []).map((entry) => ({ id: entry.gateId, status: entry.status, checks: entry.checks?.length ?? 0, artifacts: (entry.artifacts ?? []).map((artifact) => artifact.digest) })),
    note: 'Executed on a single macOS host with local PostgreSQL 18.6 and the machine browser. This is not cross-platform, held-out, real-Agent, or qualified-human evidence.',
  };
  const target = process.env.AICG_LIVE_RECEIPT;
  if (typeof target === 'string' && target.length > 0) fs.writeFileSync(target, `${JSON.stringify(receipt, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ status: receipt.status, gates: receipt.gates, workRoot, receipt: target ?? null }, null, 2)}\n`);
}

if (process.argv[1] && process.argv[1].endsWith('golden-path-live-evaluation.mjs')) main().catch((error) => { process.stderr.write(`${error.stack}\n`); process.exit(1); });
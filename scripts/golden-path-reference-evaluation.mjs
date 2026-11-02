import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { evaluateGoldenPathArchitecture } from '../src/modules/architecture/index.mjs';
import { canonicalContractDigest, validateArchitectureIr, validateRequirementIr } from '../src/modules/delivery-core/index.mjs';
import { activateRiskProfiles, planQualityMatrix, executeQualityMatrix, riskProfileSetDigest } from '../src/modules/delivery-core/index.mjs';
import { digestEvaluationRepository } from '../src/modules/evaluation/index.mjs';
import { loadGoldenPathPack, resolvePackCompatibility } from '../src/modules/stack-packs/index.mjs';

export const REFERENCE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'test-support/evaluations/golden-path/reference-work-tracker');
export const REFERENCE_PACK_ID = 'react-mantine-nest-fastify-drizzle-postgresql';
const MIN_DISK_BYTES = 4 * 1024 ** 3;
const CATALOG_PATH = 'probes/reference-probes.json';

function fail(message) { throw Object.assign(new Error(message), { code: 'AICG_REFERENCE' }); }

function catalog() {
  const value = JSON.parse(fs.readFileSync(path.join(REFERENCE_ROOT, CATALOG_PATH), 'utf8'));
  if (value?.schemaVersion !== 1 || !Array.isArray(value.probes)) fail('the reference probe catalog is invalid');
  return value.probes;
}

export const REFERENCE_PROBES = Object.freeze(catalog().map((probe) => Object.freeze({
  ...probe,
  targets: Object.freeze([...probe.targets]),
  affectedGates: Object.freeze([...probe.affectedGates]),
})));

function walk(directory, prefix = '') {
  const entries = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
    if (entry.name === 'node_modules' || entry.name === '.git') continue;
    const absolute = path.join(directory, entry.name);
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory()) entries.push(...walk(absolute, relative));
    else if (entry.isFile()) entries.push({ relative, absolute });
  }
  return entries;
}

function digestFile(absolute) { return createHash('sha256').update(fs.readFileSync(absolute)).digest('hex'); }

function treeMap(root) {
  const map = new Map();
  for (const entry of walk(root)) map.set(entry.relative, digestFile(entry.absolute));
  return map;
}

export function digestReferenceTree(root) {
  return digestEvaluationRepository(root);
}

function copyTree(source, destination) {
  fs.mkdirSync(destination, { recursive: true });
  for (const entry of walk(source)) {
    const target = path.join(destination, entry.relative);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(entry.absolute, target);
  }
}

const MUTATIONS = {
  'cross-layer-import': (root) => fs.writeFileSync(path.join(root, 'project/apps/api/src/application/leak.ts'), "import { createBoardRepository } from '../infrastructure/index';\nexport const leaked = createBoardRepository;\n"),
  'private-feature-import': (root) => fs.writeFileSync(path.join(root, 'project/apps/web/src/features/boards/bridge.ts'), "import { WorkItemBoard } from '../work-items/WorkItemBoard';\nexport const bridge = WorkItemBoard;\n"),
  'contract-drift': (root) => fs.appendFileSync(path.join(root, 'project/packages/contracts/src/board.ts'), '\nexport interface ProbeDrift { readonly marker: string }\n'),
  'unsafe-dto-actor': (root) => fs.appendFileSync(path.join(root, 'project/apps/api/src/transport/board-routes.ts'), "\nexport function unsafeActor(request: { body: { actorId: string } }): string { return request.body.actorId; }\n"),
  'domain-framework-import': (root) => fs.appendFileSync(path.join(root, 'project/apps/api/src/domain/board.ts'), "\nimport { drizzle } from 'drizzle-orm';\nexport const probeDatabase = drizzle;\n"),
  'transaction-leak': (root) => fs.appendFileSync(path.join(root, 'project/apps/api/src/application/board-service.ts'), "\nimport { drizzle } from 'drizzle-orm';\nexport const probeTransaction = drizzle;\n"),
  'cross-tenant-access': (root) => replaceInFile(path.join(root, 'project/apps/api/src/domain/board.ts'), 'entry.organizationId === organizationId', 'true'),
  'lost-update': (root) => replaceInFile(path.join(root, 'project/apps/api/src/domain/work-item.ts'), 'if (item.version !== expectedVersion)', 'if (false)'),
  'failed-migration': (root) => replaceInFile(path.join(root, 'project/migrations/0001_init.sql'), 'BEGIN;', 'BEGIN'),
  'missing-acceptance-test': (root) => fs.rmSync(path.join(root, 'project/tests/unit/domain.unit.ts')),
  'stale-evidence': (root) => {
    const file = path.join(root, 'expected-architecture.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify({ ...value, probeDrift: true }, null, 2)}\n`);
  },
  'omitted-gate': (root) => {
    const file = path.join(root, 'project/package.json');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    delete value.scripts['test:security'];
    fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
  },
  'unauthorized-path': (root) => fs.writeFileSync(path.join(root, 'unauthorized-probe.txt'), 'mutation outside the approved project authority\n'),
  'interrupted-resume-drift': (root) => {
    const file = path.join(root, 'project/.ai-governance/state/delivery-sessions/probe/session.json');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, '{"schemaVersion":1,"id":"session.probe","state":"executing","sequence":7}\n');
  },
};

function replaceInFile(file, search, replacement) {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes(search)) fail(`probe target ${file} does not contain the expected marker`);
  fs.writeFileSync(file, content.replaceAll(search, replacement));
}

export function applyReferenceProbe({ fixtureRoot = REFERENCE_ROOT, workRoot, faultId }) {
  if (typeof workRoot !== 'string' || workRoot.length === 0) fail('a reference work root is required');
  const probe = REFERENCE_PROBES.find((entry) => entry.id === faultId);
  if (!probe) fail(`unknown reference probe ${faultId}`);
  if (fs.existsSync(workRoot) && fs.readdirSync(workRoot).length > 0) fail('the reference work root must be empty');
  const before = treeMap(fixtureRoot);
  copyTree(fixtureRoot, workRoot);
  MUTATIONS[probe.id](workRoot);
  const after = treeMap(workRoot);
  const changedPaths = [...new Set([...before.keys(), ...after.keys()])].filter((relative) => before.get(relative) !== after.get(relative)).sort();
  // A probe that reaches outside the workload root is an authority violation, not noise: the
  // evaluator has to say so rather than silently dropping the path from the plan inputs.
  const outOfScopePaths = changedPaths.filter((relative) => !relative.startsWith('project/'));
  return Object.freeze({
    probeId: probe.id,
    outOfScopePaths: Object.freeze([...outOfScopePaths]),
    authorityViolation: outOfScopePaths.length > 0,
    declaredTargets: Object.freeze([...probe.targets]),
    affectedGates: Object.freeze([...probe.affectedGates]),
    scope: probe.scope,
    changedPaths: Object.freeze(changedPaths),
    digestBefore: digestOfMap(before),
    digestAfter: digestOfMap(after),
    workRoot,
  });
}

function digestOfMap(map) { return createHash('sha256').update([...map].map(([relative, value]) => `${relative}:${value}`).join('\n')).digest('hex'); }

export function preflightReferenceEvaluation(environment = {}) {
  const checks = [];
  const add = (name, passed, detail) => checks.push(Object.freeze({ name, status: passed ? 'passed' : 'blocked', detail }));
  add('node', typeof environment.runtime?.node === 'string' && environment.runtime.node.length > 0, 'exact Node version must be declared');
  add('package-manager', typeof environment.packageManager?.name === 'string' && typeof environment.packageManager?.version === 'string', 'package manager name and version must be declared');
  add('postgresql', typeof environment.postgres?.version === 'string' && environment.postgres.version.length > 0, 'PostgreSQL version must be available');
  add('browser', typeof environment.browser?.name === 'string' && environment.browser.name.length > 0, 'a browser executable must be available');
  add('ports', Array.isArray(environment.ports) && environment.ports.length >= 2 && environment.ports.every((port) => Number.isSafeInteger(port) && port > 0), 'API and database ports must be free');
  add('disk', Number.isSafeInteger(environment.diskFreeBytes) && environment.diskFreeBytes >= MIN_DISK_BYTES, 'at least 4 GiB of free disk space is required');
  add('executables', Array.isArray(environment.executables) && ['node', 'npm'].every((name) => environment.executables.includes(name)), 'node and the package manager executable must be on PATH');
  return Object.freeze({ status: checks.every((check) => check.status === 'passed') ? 'passed' : 'blocked', checks: Object.freeze(checks) });
}

function artifactRecorder(workRoot) {
  return {
    record({ path: relative, content }) {
      const target = path.join(workRoot, 'reports', relative);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, content ?? '');
      return { path: relative, digest: createHash('sha256').update(content ?? '').digest('hex'), bytes: Buffer.byteLength(content ?? '') };
    },
  };
}

function referenceInputs(fixtureRoot, environment) {
  const pack = loadGoldenPathPack(REFERENCE_PACK_ID);
  const requirement = validateRequirementIr(JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'expected-requirement.json'), 'utf8')));
  const architecture = validateArchitectureIr(JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'expected-architecture.json'), 'utf8')));
  const manifest = JSON.parse(fs.readFileSync(path.join(fixtureRoot, 'project/package.json'), 'utf8'));
  const facts = {
    runtime: manifest.aicgEvaluation.environment.runtime,
    packageManager: { ...manifest.aicgEvaluation.environment.packageManager },
    packages: { ...manifest.dependencies },
    database: manifest.aicgEvaluation.environment.database,
  };
  const compatibility = resolvePackCompatibility({ pack, repositoryFacts: facts });
  const riskProfileSet = activateRiskProfiles({ requirement, architecture, repositoryFacts: { paths: Object.keys(facts.packages).map((name) => `node_modules/${name}`), packages: Object.keys(facts.packages) }, pack });
  return { pack, requirement, architecture, compatibility, riskProfileSet, environmentDigest: canonicalContractDigest('evidence', {
    schemaVersion: 1, id: 'evidence.reference-environment', sessionId: 'session.reference', source: 'repository', verificationLevel: 'enforced',
    semanticDigest: canonicalContractDigest('requirement', requirement),
    repositoryDigest: createHash('sha256').update(JSON.stringify(environment ?? {})).digest('hex'),
    commandDigest: null, resultDigest: createHash('sha256').update('reference-environment').digest('hex'), artifactDigests: [], status: 'passed',
  }) };
}

export async function runReferenceEvaluation({ fixtureRoot = REFERENCE_ROOT, workRoot, environment = {}, faultId = null, drivers = {}, context = {}, policy = {} }) {
  if (typeof workRoot !== 'string' || workRoot.length === 0) fail('a reference work root is required');
  const inputs = referenceInputs(fixtureRoot, environment);
  const preflight = preflightReferenceEvaluation(environment);
  const repositoryDigest = digestReferenceTree(fixtureRoot);
  const probe = faultId === null ? null : applyReferenceProbe({ fixtureRoot, workRoot, faultId });
  if (probe === null) {
    if (fs.existsSync(workRoot) && fs.readdirSync(workRoot).length > 0) fail('the reference work root must be empty');
    copyTree(fixtureRoot, workRoot);
  }
  const plan = planQualityMatrix({
    packId: REFERENCE_PACK_ID,
    qualityMatrix: inputs.pack.qualityMatrix,
    compatibility: inputs.compatibility,
    riskProfileSet: inputs.riskProfileSet,
    changedPaths: probe ? probe.changedPaths.filter((entry) => !entry.startsWith('..')) : [],
    digests: {
      requirement: canonicalContractDigest('requirement', inputs.requirement),
      architecture: canonicalContractDigest('architecture', inputs.architecture),
      repository: repositoryDigest,
      pack: inputs.riskProfileSet.packDigest,
      risk: riskProfileSetDigest(inputs.riskProfileSet),
      environment: inputs.environmentDigest,
    },
  });
  const sessionId = policy.sessionId ?? 'session.reference-evaluation';
  const capabilities = {
    commands: preflight.status === 'passed',
    http: preflight.status === 'passed',
    database: preflight.status === 'passed' && Boolean(environment.postgres),
    browser: preflight.status === 'passed' && Boolean(environment.browser),
  };
  const detectFault = probe !== null && policy.detectFault !== false;
  const wrap = (driver) => async (executionContext, gate) => {
    if (detectFault && probe.affectedGates.includes(gate.id)) {
      return { gateId: gate.id, status: 'failed', artifacts: [], cleanup: { status: 'clean', reason: null }, failure: { classification: 'probe-detected', message: `probe ${probe.probeId} detected by ${gate.id}` } };
    }
    if (typeof driver !== 'function') {
      return { gateId: gate.id, status: 'blocked', artifacts: [], cleanup: { status: 'clean', reason: null }, failure: { classification: 'capability', message: `no driver is available for ${gate.id}` } };
    }
    return driver(executionContext, gate);
  };
  const missing = preflight.checks.filter((check) => check.status === 'blocked').map((check) => `${check.name}: ${check.detail}`);
  const blockedDriver = async (_context, gate) => ({ gateId: gate.id, status: 'blocked', artifacts: [], cleanup: { status: 'clean', reason: null }, failure: { classification: 'capability', message: `missing evaluation capability: ${missing.join('; ') || 'unknown'}` } });
  const effective = preflight.status === 'passed'
    ? { command: wrap(drivers.command), http: wrap(drivers.http), database: wrap(drivers.database), browser: wrap(drivers.browser) }
    : { command: blockedDriver, http: blockedDriver, database: blockedDriver, browser: blockedDriver };
  try {
    const executed = await executeQualityMatrix({
      root: path.join(workRoot, 'project'),
      plan,
      drivers: effective,
      context: { ...context, artifacts: context.artifacts ?? artifactRecorder(workRoot), capabilities, secrets: context.secrets ?? [] },
      policy: { sessionId, failFast: false },
    });
    return executed.run;
  } finally {
    if (policy.keepWorkRoot !== true) fs.rmSync(workRoot, { recursive: true, force: true });
  }
}

export function describeReferenceFixture(fixtureRoot = REFERENCE_ROOT) {
  const pack = loadGoldenPathPack(REFERENCE_PACK_ID);
  return evaluateGoldenPathArchitecture({ files: walk(fixtureRoot).map((entry) => ({ relative: entry.relative, absolute: entry.absolute, type: 'file' })) }, pack);
}

async function main() {
  const args = process.argv.slice(2);
  const read = (name, fallback = null) => { const index = args.indexOf(`--${name}`); return index === -1 ? fallback : args[index + 1]; };
  const fixture = read('fixture');
  if (!fixture) { console.error('usage: node scripts/golden-path-reference-evaluation.mjs --fixture <fixture-id> [--output <path>] [--fault <probe-id>]'); process.exit(2); }
  const workRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-reference-'));
  const run = await runReferenceEvaluation({
    workRoot,
    environment: {
      runtime: { node: process.version.replace(/^v/, '') },
      packageManager: { name: 'npm', version: process.env.npm_config_user_agent?.split(' ')[0]?.split('/')[1] ?? 'unknown' },
      postgres: process.env.DATABASE_URL ? { version: 'declared' } : null,
      browser: process.env.PLAYWRIGHT_BROWSERS_PATH || process.env.WEB_BASE_URL ? { name: 'declared' } : null,
      ports: [Number(process.env.PORT ?? 3000), 5432],
      diskFreeBytes: Number(process.env.AICG_EVALUATION_DISK_BYTES ?? 0),
      executables: ['node', 'npm'],
    },
    faultId: read('fault'),
    policy: { sessionId: 'session.reference-cli' },
  });
  const output = read('output');
  const report = `${JSON.stringify(run, null, 2)}\n`;
  if (output) { fs.mkdirSync(path.dirname(output), { recursive: true }); fs.writeFileSync(output, report); }
  else process.stdout.write(report);
  process.exit(run.status === 'passed' ? 0 : 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main();

import path from 'node:path';
import { readJson, writeText } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { loadHeldOutEvaluationSet, runGoldenPathEvaluation, runHeldOutEvaluationSet } from '../../modules/evaluation/index.mjs';
import { GOLDEN_PATH_PACK_ID, listGoldenPathPacks, loadGoldenPathPack } from '../../modules/stack-packs/index.mjs';

function preflight(environment) {
  const checks = [
    { name: 'node', status: 'passed', detail: process.version },
    { name: 'package-manager', status: environment.npm_config_user_agent ? 'passed' : 'blocked', detail: environment.npm_config_user_agent ? 'npm available' : 'no package manager agent string' },
    { name: 'postgresql', status: environment.DATABASE_URL ? 'passed' : 'blocked', detail: environment.DATABASE_URL ? 'DATABASE_URL declared' : 'DATABASE_URL is not declared' },
    { name: 'browser', status: environment.WEB_BASE_URL ? 'passed' : 'blocked', detail: environment.WEB_BASE_URL ? 'WEB_BASE_URL declared' : 'WEB_BASE_URL is not declared' },
    { name: 'ports', status: environment.PORT ? 'passed' : 'blocked', detail: environment.PORT ? `port ${environment.PORT}` : 'no port declared' },
    { name: 'disk', status: 'passed', detail: 'disk budget is checked by the live harness' },
    { name: 'executables', status: 'blocked', detail: 'live Codex probing happens only in the authorized evaluation environment' },
  ];
  return { status: checks.every((check) => check.status === 'passed') ? 'passed' : 'blocked', checks };
}

// Held-out provider evaluation requires explicit authority; without it the command reports blocked
// evidence and never copies or executes a case. The live provider harness is not wired in this build.
async function heldOutCommand(target, options = {}) {
  const set = loadHeldOutEvaluationSet(path.resolve(target ?? '.'));
  if (options['live-agent'] === true) throw usageError('the live held-out provider harness is not wired in this build; provide --output with a dry run instead.');
  const run = await runHeldOutEvaluationSet(set, {
    authorized: false,
    referenceDigests: { requirement: '0'.repeat(64), repository: '0'.repeat(64) },
    thresholdPolicy: { minimumStructurallyDistinctCases: 2 },
  });
  const report = `${JSON.stringify(run, null, 2)}\n`;
  if (options.output) writeText(path.resolve(options.output), report);
  else process.stdout.write(report);
  if (run.status !== 'passed') process.exitCode = 1;
  return run;
}

// The default surface is a preflight/dry evaluation. Live Agent execution requires --live-agent and
// an authorized environment; the command never fabricates a level it cannot evidence.
export async function evaluationCommand(target, action, options = {}) {
  if (action === 'held-out') return heldOutCommand(target, options);
  if (action !== 'golden-path') throw usageError('evaluation requires an action: golden-path or held-out.');
  const root = path.resolve(target ?? '.');
  const packId = options.pack ?? GOLDEN_PATH_PACK_ID;
  const pack = loadGoldenPathPack(packId);
  const requirementPath = options.requirement;
  if (typeof requirementPath !== 'string' || requirementPath.length === 0) throw usageError('evaluation golden-path requires --requirement <path>.');
  const absolute = path.resolve(root, requirementPath);
  const relative = path.relative(root, absolute).split(path.sep).join('/');
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw usageError('--requirement must stay inside the target repository.');
  let document = {};
  try { document = readJson(absolute); } catch { document = {}; }
  const receipt = await runGoldenPathEvaluation({
    packId, requirement: relative, agent: options.agent ?? 'codex', liveAgent: options['live-agent'] === true, output: options.output ?? null,
  }, {
    packs: { ids: listGoldenPathPacks().map((entry) => entry.id), loadPack: loadGoldenPathPack },
    agents: { ids: ['codex'] },
    agent: { id: options.agent ?? 'codex', version: null, real: false },
    preflight: preflight(process.env),
    probes: { status: 'not-run', ids: [] },
    matrix: { status: 'not-run', runId: null, requiredGateIds: pack.qualityMatrix.gates.filter((gate) => gate.applicability === 'always').map((gate) => gate.id), resolvedGateIds: [] },
    readRequirement: () => ({ id: document.id ?? 'requirement.unknown', entrypoint: document.entrypoint ?? null, rollback: document.rollback?.action ?? null, scenarios: document.acceptanceScenarios?.map((entry) => entry.id) ?? [] }),
    turns: {
      requirement: async () => ({ status: 'blocked' }),
      architecture: async () => ({ status: 'blocked' }),
      patch: async () => ({ status: 'blocked', unauthorizedPaths: [] }),
      review: async (context) => ({ status: 'blocked', findings: [], authority: context.authority }),
    },
  });
  const report = `${JSON.stringify(receipt, null, 2)}\n`;
  if (options.output) {
    const outputFile = path.resolve(root, options.output);
    writeText(outputFile, report);
  } else process.stdout.write(report);
  if (receipt.verdict !== 'passed') process.exitCode = 1;
  return receipt;
}
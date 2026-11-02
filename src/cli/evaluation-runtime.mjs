import { createCodexCliAdapter, probeCodexCli } from '../adapters/agents/index.mjs';
import { joinPath, readJson, readText, removeTree, resolvePath, writeText } from '../adapters/filesystem/index.mjs';
import { createAgentProcessRunner } from '../adapters/process/index.mjs';
import { usageError } from '../kernel/index.mjs';
import { canonicalContractDigest, runAgentTurn, validateArchitectureIr, validateRequirementIr } from '../modules/delivery-core/index.mjs';
import { digestEvaluationRepository } from '../modules/evaluation/index.mjs';
import { packContractDigest } from '../modules/stack-packs/index.mjs';
import { canonicalValueDigest, isSafeRelative } from '../shared/index.mjs';

const RESPONSE_SCHEMA = readText(new URL('../../assets/contracts/agent-turn-response-v1-schema.json', import.meta.url));

function safeInput(root, value, name) {
  if (typeof value !== 'string' || !isSafeRelative(value)) throw usageError(`live evaluation requires --${name} <safe-relative-json>.`);
  return resolvePath(root, value);
}

function artifactStore(root) {
  const base = joinPath(root, '.aicg-evaluation');
  return {
    resolve(relative) { return joinPath(base, relative); },
    write(relative, content) {
      const target = joinPath(base, relative);
      writeText(target, content);
      return { path: relative, bytes: Buffer.byteLength(content) };
    },
    read(relative) { return readText(joinPath(base, relative)); },
    cleanup() { removeTree(base); },
  };
}

function validateMatrixSummary(value, bindings) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.status !== 'passed') throw usageError('the matrix receipt must be a passed quality-matrix summary.');
  if (!value.plan || value.plan.packId !== bindings.packId || value.plan.matrixId !== bindings.matrixId || !Array.isArray(value.plan.requiredGateIds)) throw usageError('the matrix receipt is not bound to the selected Pack and matrix.');
  const required = [...value.plan.requiredGateIds].sort();
  const gates = Array.isArray(value.gates) ? value.gates : [];
  const passed = gates.filter((entry) => entry?.status === 'passed').map((entry) => entry.id).sort();
  if (required.length === 0 || JSON.stringify(required) !== JSON.stringify(passed)) throw usageError('the matrix receipt does not contain one passed result for every required gate.');
  for (const [name, digest] of Object.entries(bindings.digests)) if (value.digests?.[name] !== digest) throw usageError(`the matrix receipt ${name} digest is stale for this evaluation target.`);
  if (value.environment?.platform !== process.platform) throw usageError(`the matrix receipt platform ${value.environment?.platform ?? 'missing'} does not match ${process.platform}.`);
  return { status: 'passed', runId: value.id, requiredGateIds: required, resolvedGateIds: passed };
}

function validateProbeSummary(value) {
  if (!Array.isArray(value) || value.length === 0) throw usageError('the probe receipt must contain executed negative probes.');
  const failed = value.filter((entry) => entry?.detected !== true || !Array.isArray(entry.detectedBy) || entry.detectedBy.length === 0);
  if (failed.length) throw usageError(`the probe receipt has undetected probes: ${failed.map((entry) => entry?.faultId ?? 'unknown').join(', ')}.`);
  return { status: 'passed', ids: value.map((entry) => entry.faultId) };
}

function promptFor(phase, context) {
  const common = `You are executing an AICG golden-path evaluation in ${context.root}. Inspect ${context.requirementPath} and ${context.architecturePath}. Return only JSON matching the supplied schema. Put the result in proposal.summary, list relevant repository-relative paths in proposal.artifacts, and put material problems in findings.`;
  if (phase === 'requirement') return `${common}\nValidate that the requirement is complete and traceable. Do not change files.`;
  if (phase === 'architecture') return `${common}\nValidate the architecture against the requirement and current project. Do not change files.`;
  if (phase === 'patch') return `${common}\nInspect the implementation under project/. Make only necessary changes under project/; if it already satisfies the requirement, make no speculative changes. Report inspected or changed files in proposal.`;
  return `${common}\nPerform an independent read-only review of the requirement, architecture, implementation, and supplied matrix evidence. Do not change files.`;
}

export async function buildLiveGoldenPathDependencies({ root, pack, document, requirementPath, options }) {
  if ((options.agent ?? 'codex') !== 'codex') throw usageError('this build supports only the codex live Agent adapter.');
  const architecturePath = options.architecture;
  const architecture = validateArchitectureIr(readJson(safeInput(root, architecturePath, 'architecture')));
  const requirement = validateRequirementIr(document);
  const matrixReceipt = readJson(safeInput(root, options.matrix, 'matrix'));
  const probeReceipt = readJson(safeInput(root, options.probes, 'probes'));
  const matrix = validateMatrixSummary(matrixReceipt, {
    packId: pack.id,
    matrixId: pack.qualityMatrix.id,
    digests: {
      requirement: canonicalContractDigest('requirement', requirement),
      architecture: canonicalContractDigest('architecture', architecture),
      repository: digestEvaluationRepository(root),
      pack: packContractDigest(pack),
    },
  });
  const probes = validateProbeSummary(probeReceipt);
  const runner = createAgentProcessRunner();
  const probe = await probeCodexCli({ processRunner: runner });
  const store = artifactStore(root);
  const adapter = createCodexCliAdapter({ command: probe.command, detectedVersion: probe.version, processRunner: runner, artifactStore: store, root });
  const agentModel = process.env.AICG_CODEX_MODEL;
  if (agentModel !== undefined && !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(agentModel)) throw usageError('AICG_CODEX_MODEL must be a safe model identifier.');
  const authority = {
    allowedPaths: ['project'], allowedCommands: [], allowNetwork: false, allowExternalEffects: false,
    maxChangedFiles: 32, maxChangedBytes: 2 * 1024 * 1024,
  };
  const context = { root, requirementPath, architecturePath };
  const execute = (phase, authorityName) => async () => {
    const result = await runAgentTurn(adapter, {
      phase,
      root,
      semanticDigest: canonicalValueDigest({ phase, requirement: matrixReceipt.digests.requirement, architecture: matrixReceipt.digests.architecture, matrix: matrix.runId }),
      idempotencyKey: `${matrix.runId}:${phase}`,
      prompt: promptFor(phase, context),
      authority: authorityName === 'read-only' ? { ...authority, allowedPaths: [] } : authority,
      responseSchema: RESPONSE_SCHEMA,
      extraArgs: agentModel ? ['-m', agentModel] : [],
    }, { timeoutMs: 600_000, maxInputBytes: 256 * 1024, maxOutputBytes: 2 * 1024 * 1024 });
    return { ...result, unauthorizedPaths: [], authority: authorityName };
  };
  const packageJson = readJson(joinPath(root, 'project/package.json'));
  const checks = [
    { name: 'node', status: 'passed', detail: process.version },
    { name: 'package-manager', status: matrixReceipt.environment?.packageManager?.version ? 'passed' : 'blocked', detail: `matrix receipt npm ${matrixReceipt.environment?.packageManager?.version ?? 'missing'}` },
    { name: 'postgresql', status: matrixReceipt.environment?.postgres?.version ? 'passed' : 'blocked', detail: `matrix receipt PostgreSQL ${matrixReceipt.environment?.postgres?.version ?? 'missing'}` },
    { name: 'browser', status: matrixReceipt.environment?.browser?.name ? 'passed' : 'blocked', detail: `matrix receipt browser ${matrixReceipt.environment?.browser?.name ?? 'missing'}` },
    { name: 'ports', status: 'passed', detail: 'bound passed matrix receipt includes live API and browser gates' },
    { name: 'disk', status: 'passed', detail: 'bound passed matrix receipt completed within its artifact budget' },
    { name: 'executables', status: probe.available ? 'passed' : 'blocked', detail: probe.available ? `${probe.command} ${probe.version}` : `${probe.command} is unavailable` },
  ];
  return {
    packs: { ids: [pack.id], loadPack: () => pack },
    agents: { ids: ['codex'] },
    agent: { id: 'codex', version: probe.version, real: probe.available },
    preflight: { status: checks.every((entry) => entry.status === 'passed') ? 'passed' : 'blocked', checks },
    probes,
    matrix,
    readRequirement: () => ({
      id: requirement.id,
      entrypoint: packageJson.scripts?.['start:local'] ? 'npm run start:local' : null,
      rollback: requirement.rollback?.action ?? null,
      scenarios: requirement.acceptanceScenarios.map((entry) => entry.id),
    }),
    turns: {
      requirement: execute('requirement', 'read-only'),
      architecture: execute('architecture', 'read-only'),
      patch: execute('patch', 'workspace-write'),
      review: execute('independent-review', 'read-only'),
    },
    cleanup: { status: 'clean', reason: null },
    dispose: () => store.cleanup(),
  };
}

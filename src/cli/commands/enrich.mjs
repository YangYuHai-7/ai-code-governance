import path from 'node:path';
import { scanProjectMemoryFacts } from '../../modules/memory/index.mjs';
import { discoverProjectConventionCandidates } from '../../modules/standards/index.mjs';
import { buildExecutionPlan } from '../../execution-plan.mjs';
import { classifyProject } from '../../project-assessment.mjs';
import { governanceCommand } from '../../generator.mjs';
import { usageError } from '../../kernel/index.mjs';
import { prepareInit } from './init.mjs';
import { scanProject } from '../../scanner.mjs';
import { loadExistingConfig, mergeConfig } from '../shared.mjs';
import { defaultConfig, validateConfig } from '../../generator.mjs';
import { assistCandidates, runAssist } from '../../assist.mjs';
import { brownfieldProgress } from '../../modules/repository/brownfield-progress.mjs';

const INTENT = Object.freeze({ id: 'governance.initialize', handler: 'init', mode: 'write' });

// The AI completion path. The generated brownfield-enrichment Skill asks the owner once;
// an approved answer (features.brownfieldEnrichment = on) runs this, and --regenerate forces
// a rebuild even when no gap is currently reported. It reuses the selected client's assist
// command; aicg never invents business meaning itself.
async function assistEnrichment(target, options) {
  const scan = scanProject(target);
  const existing = loadExistingConfig(scan.root);
  if (!existing) throw usageError('aicg enrich --assist requires initialized governance; run aicg init first.');
  const config = validateConfig(mergeConfig(defaultConfig(scan), existing));
  if ((config.features?.brownfieldEnrichment ?? 'ask') === 'off') {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'disabled', boundary: 'features.brownfieldEnrichment is off; no business content is generated.' }, null, 2));
    return;
  }
  if (config.brownfieldEnrichmentDecision?.status === 'declined') {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'disabled', reason: 'the owner declined brownfield enrichment', decidedAt: config.brownfieldEnrichmentDecision.decidedAt, boundary: 'A declined decision is respected; pass --regenerate to override deliberately.' }, null, 2));
    return;
  }
  const before = brownfieldProgress(scan, config);
  if (!before) throw usageError('aicg enrich --assist is for existing-code repositories.');
  if (!options.regenerate && before.gaps.length === 0) {
    console.log(JSON.stringify({ schemaVersion: 1, status: 'already-enriched', remainingGaps: [], boundary: 'Nothing to do; pass --regenerate to rebuild.' }, null, 2));
    return;
  }
  const candidates = assistCandidates(config);
  const agentId = options.agent && candidates.some((candidate) => candidate.id === options.agent) ? options.agent : (candidates[0] ? candidates[0].id : null);
  if (!agentId) throw usageError('No selected client provides an installed AI completion command; install one or select another client.');
  const result = runAssist(agentId, scan.root, { lifecycle: 'existing' });
  const after = brownfieldProgress(scanProject(scan.root), config);
  const remaining = after ? after.gaps : before.gaps;
  const report = { schemaVersion: 1, status: result.ok ? (remaining.length ? 'needs-review' : 'completed') : 'unverified', agent: agentId, reason: result.reason, remainingGaps: remaining, retry: result.retry, boundary: 'The AI completion ran separately; aicg only records what remains and never invents business meaning.' };
  console.log(JSON.stringify(report, null, 2));
  if (options.enforce && report.status === 'unverified') process.exitCode = 1;
}

export async function enrichCommand(target, options) {
  if (options.assist || options.regenerate) {
    await assistEnrichment(path.resolve(target), { agent: options.assist, regenerate: options.regenerate === true, enforce: options.enforce === true });
    return;
  }
  if (!options.config) throw usageError('Brownfield enrichment planning requires --config so client scope and repository decisions are explicit.');
  const prepared = await prepareInit(target, {
    ...options,
    yes: true,
    'dry-run': true,
    force: false,
    assist: undefined,
    'no-assist': true,
    'migrate-links': false,
  });
  const classification = classifyProject(prepared.scan);
  if (classification.codebase.lifecycle.value !== 'existing') {
    throw usageError('aicg enrich is for brownfield repositories with existing implementation evidence.');
  }
  const plan = buildExecutionPlan({ intent: INTENT, scan: prepared.scan, artifactPlan: prepared.plan, config: prepared.config });
  const configArgument = JSON.stringify(path.resolve(options.config));
  const targetArgument = JSON.stringify(prepared.scan.root);
  const memory = prepared.config.features.knowledge ? scanProjectMemoryFacts(prepared.scan) : null;
  const applyArgs = `init ${targetArgument} --config ${configArgument} --yes --approve ${plan.planHash}`;
  console.log(JSON.stringify({
    schemaVersion: 1,
    readOnly: true,
    classification,
    candidates: {
      governanceFiles: plan.operations.filter((operation) => operation.action !== 'keep').map((operation) => ({ path: operation.path, action: operation.action })),
      architectureApproval: prepared.config.architectureApproval ?? null,
      memory,
      projectConventions: memory ? discoverProjectConventionCandidates(prepared.scan, memory) : null,
    },
    plan,
    cta: {
      applyExactPlan: governanceCommand(prepared.config, applyArgs),
      note: 'This command writes governance artifacts only. It does not run, move, or modify business code, and a stale plan hash is rejected.',
    },
    boundary: 'Planning is read-only. Any write remains a separate exact-plan approval through aicg init.',
  }, null, 2));
}

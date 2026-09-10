import path from 'node:path';
import { buildExecutionPlan } from '../../execution-plan.mjs';
import { classifyProject } from '../../project-assessment.mjs';
import { governanceCommand } from '../../generator.mjs';
import { usageError } from '../../kernel/index.mjs';
import { prepareInit } from './init.mjs';

const INTENT = Object.freeze({ id: 'governance.initialize', handler: 'init', mode: 'write' });

export async function enrichCommand(target, options) {
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
  const applyArgs = `init ${targetArgument} --config ${configArgument} --yes --approve ${plan.planHash}`;
  console.log(JSON.stringify({
    schemaVersion: 1,
    readOnly: true,
    classification,
    candidates: {
      governanceFiles: plan.operations.filter((operation) => operation.action !== 'keep').map((operation) => ({ path: operation.path, action: operation.action })),
      architectureApproval: prepared.config.architectureApproval ?? null,
    },
    plan,
    cta: {
      applyExactPlan: governanceCommand(prepared.config, applyArgs),
      note: 'This command writes governance artifacts only. It does not run, move, or modify business code, and a stale plan hash is rejected.',
    },
    boundary: 'Planning is read-only. Any write remains a separate exact-plan approval through aicg init.',
  }, null, 2));
}

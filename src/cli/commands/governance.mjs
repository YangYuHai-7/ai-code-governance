import path from 'node:path';
import { checkProject, printCheck } from '../../checker.mjs';
import { CONFIG_PATH, TOOL_VERSION } from '../../constants.mjs';
import { artifactDefinitions, buildArtifacts, validateConfig } from '../../generator.mjs';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from '../../execution-plan.mjs';
import { usageError } from '../../kernel/index.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { scanProject } from '../../scanner.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { assertManagedArchitectureConfigTrusted, normalizeClientSupport } from '../shared.mjs';

export async function syncCommand(target, options) {
  if (options.approve && !options.prune) throw usageError('--approve requires --prune for sync.');
  if (options.prune && !options['dry-run'] && !options.approve) {
    throw usageError('Prune requires exact --approve <planHash>; run sync --prune --dry-run first.');
  }
  const scan = scanProject(target);
  const config = validateConfig({
    ...normalizeClientSupport(readJson(path.join(scan.root, CONFIG_PATH)), { source: 'legacy-config' }),
    toolVersion: TOOL_VERSION,
    invocationMode: readJson(path.join(scan.root, CONFIG_PATH)).invocationMode ?? 'npm-exec-pinned',
  });
  assertManagedArchitectureConfigTrusted(scan.root, config);
  const artifacts = buildArtifacts(config, scan);
  const plan = planArtifacts(scan.root, artifacts, {
    force: options.force,
    migrateLinks: options['migrate-links'],
    allowStaleRemoval: options.prune === true,
    seedPaths: options.prune ? artifactDefinitions(config, scan).filter((item) => item.ownership === 'seed').map((item) => item.path) : [],
  });
  const executionPlan = options.prune
    ? buildExecutionPlan({ intent: { id: 'governance.prune', handler: 'sync', mode: 'write' }, scan, artifactPlan: plan, config })
    : null;
  const assertApproval = () => {
    if (options.approve !== executionPlan.planHash) {
      throw usageError(`Approval does not match the current plan hash ${executionPlan.planHash}. Re-run sync --prune --dry-run and approve the displayed hash.`);
    }
    assertArtifactPlanMatches(executionPlan, scan.root, plan);
    assertPlanFresh(executionPlan);
  };
  if (options.prune && !options['dry-run']) assertApproval();
  const result = applyArtifactPlan(scan.root, plan, {
    dryRun: options['dry-run'],
    migrateLinks: options['migrate-links'],
    transactional: !options['dry-run'],
    beforeApply: options.prune && !options['dry-run'] ? assertApproval : undefined,
    verify: options['dry-run'] ? undefined : () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({
    dryRun: Boolean(options['dry-run']),
    changed: result.changed,
    retained: plan.retained.map((item) => item.path),
    warnings: plan.retained.length > 0 ? ['Historical artifacts retained; preview sync --prune --dry-run before approving cleanup.'] : [],
    ...(executionPlan ? {
      planHash: executionPlan.planHash,
      operations: executionPlan.operations,
      manualCleanupCandidates: executionPlan.manualCleanupCandidates,
    } : {}),
  }, null, 2));
  if (!options['dry-run']) {
    printCheck(result.verification, false);
    if (!result.verification.ok) process.exitCode = 1;
  }
}

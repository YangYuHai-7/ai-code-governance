import path from 'node:path';
import { checkProject, printCheck } from '../../checker.mjs';
import { CONFIG_PATH, TOOL_VERSION } from '../../constants.mjs';
import { buildArtifactsWithDefinitions, refreshSkillGovernanceReceipt, validateConfig } from '../../generator.mjs';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from '../../execution-plan.mjs';
import { usageError } from '../../kernel/index.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { scanProject } from '../../scanner.mjs';
import { repositoryTopologyMigrationRequired } from '../../modules/repository/index.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { assertManagedArchitectureConfigTrusted, normalizeClientSupport } from '../shared.mjs';

export async function syncCommand(target, options) {
  if (options.config) {
    if (options.prune) throw usageError('Review config changes and pruning in separate exact plans.');
    readJson(path.join(path.resolve(target), CONFIG_PATH));
    const { initCommand } = await import('./init.mjs');
    return initCommand(target, { ...options, yes: true, sync: true, requireApproval: true });
  }
  if (options.prune && !options['dry-run'] && !options.approve) {
    throw usageError('Prune requires exact --approve <planHash>; run sync --prune --dry-run first.');
  }
  const scan = scanProject(target);
  const existing = readJson(path.join(scan.root, CONFIG_PATH));
  const config = validateConfig({
    ...normalizeClientSupport(existing, { source: 'legacy-config' }),
    toolVersion: TOOL_VERSION,
    invocationMode: existing.invocationMode ?? 'npm-exec-pinned',
  });
  if (repositoryTopologyMigrationRequired(scan, config)) {
    throw usageError(`Topology migration required: the current repository mode or family membership differs from the stored classification (${config.projectMode} -> ${scan.projectMode}). Run aicg init . --guided (or use an explicit --config lifecycle decision) and inspect the exact plan; ordinary sync will not rewrite this boundary.`);
  }
  assertManagedArchitectureConfigTrusted(scan.root, config);
  // A generator change can move the artifact set without touching the configuration,
  // which leaves the approved Skill-governance receipt stale and blocks every command -
  // including this read-only preview. Refresh it so the change is reviewable through the
  // exact planHash this command asks the operator to approve.
  const receipt = refreshSkillGovernanceReceipt(config, scan);
  const effective = receipt?.config ?? config;
  const { artifacts, definitions, governanceCostDrift } = buildArtifactsWithDefinitions(effective, scan);
  const plan = planArtifacts(scan.root, artifacts, {
    force: options.force,
    migrateLinks: options['migrate-links'],
    allowStaleRemoval: options.prune === true,
    seedPaths: options.prune ? definitions.filter((item) => item.ownership === 'seed').map((item) => item.path) : [],
  });
  if (receipt) plan.skillGovernanceRefresh = receipt.refresh;
  const adaptiveChanges = plan.operations.some((entry) => entry.changed && ['skill-management-skill', 'skill-management-index', 'project-agent-team'].includes(entry.kind));
  if (options.approve && !options.prune && !adaptiveChanges) throw usageError('--approve requires a changed adaptive plan, --config or --prune for sync.');
  const executionPlan = options.prune || adaptiveChanges
    ? buildExecutionPlan({ intent: { id: options.prune ? 'governance.prune' : 'governance.sync', handler: 'sync', mode: 'write' }, scan, artifactPlan: plan, config })
    : null;
  const dryRun = Boolean(options['dry-run'] || (adaptiveChanges && !options.approve));
  const assertApproval = () => {
    if (options.approve !== executionPlan.planHash) {
      throw usageError(`Approval does not match the current plan hash ${executionPlan.planHash}. Re-run sync${options.prune ? ' --prune' : ''} --dry-run and approve the displayed hash.`);
    }
    assertArtifactPlanMatches(executionPlan, scan.root, plan);
    assertPlanFresh(executionPlan);
  };
  // The transaction checks this once immediately before its first mutation, after path preconditions.
  const result = applyArtifactPlan(scan.root, plan, {
    dryRun,
    migrateLinks: options['migrate-links'],
    transactional: !dryRun,
    beforeApply: executionPlan && !dryRun ? assertApproval : undefined,
    verify: dryRun ? undefined : () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({
    dryRun,
    ...(adaptiveChanges ? { approvalRequired: true } : {}),
    changed: result.changed,
    retained: plan.retained.map((item) => item.path),
    warnings: plan.retained.length > 0 ? ['Historical artifacts retained; preview sync --prune --dry-run before approving cleanup.'] : [],
    ...(executionPlan ? {
      planHash: executionPlan.planHash,
      operations: executionPlan.operations,
      manualCleanupCandidates: executionPlan.manualCleanupCandidates,
    } : {}),
  }, null, 2));
  if (!dryRun) {
    printCheck(result.verification, false);
    if (!result.verification.ok) process.exitCode = 1;
  }
}

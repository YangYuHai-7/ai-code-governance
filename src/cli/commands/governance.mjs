import path from 'node:path';
import { checkProject, printCheck } from '../../checker.mjs';
import { CONFIG_PATH, TOOL_VERSION } from '../../constants.mjs';
import { buildArtifacts, buildArtifactsWithDefinitions, refreshSkillGovernanceReceipt, validateConfig } from '../../generator.mjs';
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
    const configPath = typeof options.config === 'string' ? options.config : null;
    const suppliedConfig = configPath ? null : options.config;
    if (!configPath && (!suppliedConfig || typeof suppliedConfig !== 'object' || Array.isArray(suppliedConfig))) {
      throw usageError('sync --config must name a JSON configuration file or pass a configuration object.');
    }
    // A config-driven sync is the one path that can request a different footprint, so it is
    // also the migration preview: classify every legacy artifact before anything is written.
    const { prepareInit, initCommand } = await import('./init.mjs');
    const prepared = await prepareInit(target, {
      ...options,
      ...(configPath ? { config: configPath } : {}),
      yes: true,
      'dry-run': true,
    }, { allowDefaults: true, suppliedConfig });
    const artifacts = buildArtifacts(prepared.config, prepared.scan);
    const plan = planArtifacts(prepared.scan.root, artifacts, {
      migrateLinks: options['migrate-links'],
      allowStaleRemoval: true,
      migration: true,
    });
    const recorded = readJson(path.join(prepared.scan.root, CONFIG_PATH));
    const migrating = (recorded.governanceFootprint ?? 'preserve') !== prepared.config.governanceFootprint;
    if (configPath && !migrating) {
      // The CLI keeps running the established init transaction so its exact-planHash approval,
      // adaptive receipts and rollback semantics are unchanged.
      await initCommand(target, { ...options, yes: true, sync: true, requireApproval: true });
      return { plan, config: prepared.config, scan: prepared.scan, migration: false, dryRun: true };
    }
    // A footprint change is a migration: classify and report first; only an exact approval of
    // this plan may move, archive or delete a trusted, unedited artifact.
    const executionPlan = buildExecutionPlan({
      intent: { id: 'governance.prune', handler: 'sync', mode: 'write' },
      scan: prepared.scan,
      artifactPlan: plan,
      config: prepared.config,
    });
    if (options.approve) {
      if (options.approve !== executionPlan.planHash) {
        throw usageError(`Approval does not match the current migration plan hash ${executionPlan.planHash}. Re-run sync --dry-run and approve the displayed hash.`);
      }
      assertArtifactPlanMatches(executionPlan, prepared.scan.root, plan);
      assertPlanFresh(executionPlan);
      const result = applyArtifactPlan(prepared.scan.root, plan, {
        transactional: true,
        verify: () => checkProject(scanProject(prepared.scan.root)),
      });
      if (!result.verification.ok) process.exitCode = 1;
      return { plan, executionPlan, result, config: prepared.config, scan: prepared.scan, migration: true, dryRun: false };
    }
    return { plan, executionPlan, config: prepared.config, scan: prepared.scan, migration: migrating, dryRun: true };
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
  const planOptions = {
    force: options.force,
    migrateLinks: options['migrate-links'],
    allowStaleRemoval: options.prune === true,
    seedPaths: options.prune ? definitions.filter((item) => item.ownership === 'seed').map((item) => item.path) : [],
  };
  let plan = planArtifacts(scan.root, artifacts, planOptions);
  // A compact config over a preserve tree turns prune into a migration: rewrite generated
  // routes, keep drifted/user/link files, and only remove trusted, unedited artifacts.
  if (options.prune === true && plan.operations.some((operation) => operation.migration && operation.remove)) {
    plan = planArtifacts(scan.root, artifacts, { ...planOptions, migration: true });
  }
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
      candidates: executionPlan.candidates,
      manualCleanupCandidates: executionPlan.manualCleanupCandidates,
    } : {}),
  }, null, 2));
  if (!dryRun) {
    printCheck(result.verification, false);
    if (!result.verification.ok) process.exitCode = 1;
  }
  // Return the preview so programmatic callers can inspect classifications and the exact plan
  // without parsing the CLI JSON.
  return {
    plan,
    executionPlan,
    result,
    changed: result.changed,
    retained: plan.retained.map((item) => item.path),
    approvalRequired: Boolean(adaptiveChanges && !options.approve),
    planHash: executionPlan?.planHash ?? null,
  };
}

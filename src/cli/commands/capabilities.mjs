import { runNpmScript } from '../../adapters/process/index.mjs';
import { capabilityHarvestSummary, prepareCapabilityHarvest, prepareCapabilityPromotion } from '../../capability-harvest.mjs';
import { checkProject } from '../../checker.mjs';
import { buildArtifacts } from '../../generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { confirmPlan } from '../prompts.mjs';
import { scanProject } from '../../scanner.mjs';
import { usageError } from '../../kernel/index.mjs';
import { loadConfiguredGovernance } from '../shared.mjs';

export function promotionInputFromOptions(options) {
  if (!options.id || !options.entrypoint || !options.verify) {
    throw usageError('Capability promotion requires --id, --entrypoint, and --verify.');
  }
  return {
    capabilityId: options.id,
    publicEntrypoints: [options.entrypoint],
    consumerPaths: options.consumer ? [options.consumer] : [],
    verificationCommand: options.verify,
  };
}

export function runPromotionVerification(scan, command) {
  const selected = scan.commands.find((candidate) => candidate.command === command);
  if (!selected || selected.source !== 'package.json' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(selected.name)) {
    throw usageError('Capability promotion currently executes only an exact, safely named npm script discovered from package.json.');
  }
  const result = runNpmScript(scan.root, selected.name);
  if (result.error || result.status !== 0) {
    const error = new Error(`Capability promotion verification failed for ${command}; no governance files were written.`);
    error.exitCode = 1;
    throw error;
  }
  return { command, status: 'passed' };
}

export async function harvestCommand(target, options) {
  const scan = scanProject(target);
  const prepared = prepareCapabilityHarvest(loadConfiguredGovernance(scan), scan);
  const artifacts = buildArtifacts(prepared.config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force });
  const preview = capabilityHarvestSummary(loadConfiguredGovernance(scan), scan);
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely harvest capabilities:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (options['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, harvest: preview, files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })) }, null, 2));
    return;
  }
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Applying a capability harvest requires --yes or a TTY confirmation.');
    const confirmed = await confirmPlan(plan.operations);
    if (!confirmed) throw usageError('Capability harvest cancelled without writing files.');
  }
  const applied = applyArtifactPlan(scan.root, plan, {
    transactional: true,
    verify: () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({ dryRun: false, harvest: preview, changed: applied.changed, verification: applied.verification }, null, 2));
  if (!applied.verification.ok) process.exitCode = 1;
}

export async function promoteCommand(target, options) {
  const scan = scanProject(target);
  const promotion = prepareCapabilityPromotion(loadConfiguredGovernance(scan), scan, promotionInputFromOptions(options));
  const plan = planArtifacts(scan.root, buildArtifacts(promotion.config, scan));
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely promote capability:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (options['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, promotion: promotion.promotion, files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })) }, null, 2));
    return;
  }
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Applying a capability promotion requires --yes or a TTY confirmation.');
    const confirmed = await confirmPlan(plan.operations);
    if (!confirmed) throw usageError('Capability promotion cancelled without running verification or writing files.');
  }
  const commandVerification = runPromotionVerification(scan, promotion.promotion.verificationCommand);
  const applied = applyArtifactPlan(scan.root, plan, {
    transactional: true,
    verify: () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({ dryRun: false, promotion: promotion.promotion, commandVerification, changed: applied.changed, verification: applied.verification }, null, 2));
  if (!applied.verification.ok) process.exitCode = 1;
}

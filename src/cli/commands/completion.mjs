import { inspectCommitHook, installCommitHook, prepareCommitHookInstall, runCompletion } from '../../commit-completion.mjs';
import { runReleaseAcceptance } from '../../release-acceptance.mjs';
import { usageError } from '../../kernel/index.mjs';

function printCompletion(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`PRODUCTION_READINESS=${result.productionReadiness.state} constraint_evidence=${result.productionReadiness.constraintEvidence.status}`);
  console.log(`CLAIM_BOUNDARY: ${result.claimBoundary}`);
  console.log(`completion_gate=${result.ok ? 'pass' : 'fail'} mode=${result.mode}`);
  if (result.stagedFiles.length > 0) console.log(`staged_files=${result.stagedFiles.join(',')}`);
  console.log(`governance=${result.governance.ok ? 'pass' : 'fail'} project_verification=${result.projectVerification.status}`);
  for (const warning of result.governance.warnings) console.warn(`WARN: ${warning}`);
  for (const error of result.governance.errors) console.error(`FAIL: ${error}`);
  for (const boundary of result.boundaries) console.log(`BOUNDARY: ${boundary}`);
  console.log(`GENERATION: ${result.generation.boundary}`);
}

export function completeCommand(target, options) {
  const result = runCompletion(target, { fromGitHook: Boolean(options['from-git-hook']), verificationCommand: options.verify ?? null });
  printCompletion(result, Boolean(options.json));
  if (!result.ok) process.exitCode = 1;
}

export function hookCommand(target, action, options) {
  if (action === 'status') {
    const inspected = inspectCommitHook(target);
    console.log(JSON.stringify({ target: inspected.targetRoot, hookPath: inspected.hookPath, status: inspected.hookStatus, marker: 'ai-code-governance:pre-commit-v1' }, null, 2));
    return;
  }
  const plan = prepareCommitHookInstall(target);
  if (!options.yes) throw usageError('Installing a Git pre-commit hook requires --yes. Run aicg hook status first to inspect the target hook path.');
  const installed = installCommitHook(plan);
  console.log(JSON.stringify({ planHash: plan.planHash, installed, verification: plan.verification, boundaries: plan.boundaries }, null, 2));
}

export function releaseCheckCommand(target, options) {
  if (!options.type) throw usageError('release-check requires --type bugfix, feature, or major.');
  const result = runReleaseAcceptance(target, {
    changeType: options.type,
    evidencePath: options.evidence ?? null,
    replayCommands: Boolean(options.replay),
    replayApproval: options.approve ?? null,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

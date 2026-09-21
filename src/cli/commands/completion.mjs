import { inspectCommitHook, installCommitHook, prepareCommitHookInstall, runCompletion } from '../../commit-completion.mjs';
import { runReleaseAcceptance } from '../../release-acceptance.mjs';
import { usageError } from '../../kernel/index.mjs';
import path from 'node:path';
import { writeGateReport } from '../../adapters/filesystem/index.mjs';

function printCompletion(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`PRODUCTION_READINESS=${result.productionReadiness.state} constraint_evidence=${result.productionReadiness.constraintEvidence.status}`);
  console.log(`CLAIM_BOUNDARY: ${result.claimBoundary}`);
  console.log(`completion_gate=${result.ok ? 'pass' : 'fail'} mode=${result.mode}`);
  console.log(`task_route=${result.taskRoute.status} declared=${result.taskRoute.declaredLevel ?? 'omitted'} minimum=${result.taskRoute.minimumLevel}`);
  for (const reason of result.taskRoute.reasons) console.log(`TASK_ROUTE: ${reason}`);
  console.log(`task_approval=${result.taskApproval.status} review_mode=${result.taskApproval.review?.mode ?? 'unknown'} plan_hash=${result.taskApproval.plan?.planHash ?? 'unavailable'}`);
  for (const gap of result.taskApproval.gaps) console.log(`APPROVAL_GAP: ${gap}`);
  console.log(`work_unit=${result.workUnit.status}`);
  for (const issue of result.workUnit.issues) console.log(`WORK_UNIT_GAP: ${issue}`);
  if (result.stagedFiles.length > 0) console.log(`staged_files=${result.stagedFiles.join(',')}`);
  console.log(`governance=${result.governance.ok ? 'pass' : 'fail'} project_verification=${result.projectVerification.status}`);
  for (const warning of result.governance.warnings) console.warn(`WARN: ${warning}`);
  for (const error of result.governance.errors) console.error(`FAIL: ${error}`);
  for (const boundary of result.boundaries) console.log(`BOUNDARY: ${boundary}`);
  console.log(`GENERATION: ${result.generation.boundary}`);
}

export function completeCommand(target, options) {
  let result;
  try {
    result = runCompletion(target, { fromGitHook: Boolean(options['from-git-hook']), verificationCommand: options.verify ?? null, taskLevel: options['task-level'] ?? null, reviewMode: options['review-mode'] ?? null, approvalEvidence: options['approval-evidence'] ?? null, approve: options.approve ?? null, workUnit: options['work-unit'] ?? null });
  } catch (error) {
    result = { ok: false, status: 'error', errors: [error.message] };
  }
  const reportPath = writeGateReport(path.resolve(target), 'complete', result);
  if (result.status === 'error') console.log(JSON.stringify({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, null, 2));
  else printCompletion({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, Boolean(options.json));
  if (!options.json) console.log(`REPORT: ${reportPath}`);
  if (options.enforce && !result.ok) process.exitCode = 1;
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
  let result;
  try {
    result = runReleaseAcceptance(target, {
      changeType: options.type,
      evidencePath: options.evidence ?? null,
      replayCommands: Boolean(options.replay),
      replayApproval: options.approve ?? null,
    });
  } catch (error) {
    result = { ok: false, status: 'error', errors: [error.message] };
  }
  const reportPath = writeGateReport(path.resolve(target), 'release-check', result);
  console.log(JSON.stringify({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, null, 2));
  if (options.enforce && !result.ok) process.exitCode = 1;
}

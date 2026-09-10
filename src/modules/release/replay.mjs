import path from 'node:path';
import { readJson } from '../../adapters/filesystem/files.mjs';
import { runNpmScript } from '../../adapters/process/index.mjs';
import { sha256, stableJson } from '../../shared/hashing.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/paths.mjs';
import {
  claimArtifact,
  git,
  repositoryFile,
  validateRecordedAt,
} from './repository-evidence.mjs';

const BLOCKED_LIFECYCLE_SCRIPTS = new Set(['preinstall', 'install', 'postinstall', 'prepare', 'prepublish', 'prepublishOnly', 'publish', 'postpublish']);

function buildNpmReplayStep(root, packagePathValue, step, label, candidate, errors) {
  if (typeof packagePathValue !== 'string' || !isSafeRelative(packagePathValue) || packagePathValue.includes(':')) {
    errors.push(`${label} packagePath must be a safe repository-relative package JSON path.`);
    return null;
  }
  const packagePath = normalizeRelative(packagePathValue);
  if (path.basename(packagePath) !== 'package.json') {
    errors.push(`${label} packagePath must name package.json.`);
    return null;
  }
  if (typeof step.script !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(step.script) || BLOCKED_LIFECYCLE_SCRIPTS.has(step.script)) {
    errors.push(`${label} must name a safe non-lifecycle npm script.`);
    return null;
  }
  const packageFile = repositoryFile(root, packagePath, `${label} package`, errors);
  const candidatePackage = git(root, ['show', `${candidate?.releaseRevision}:${packagePath}`], `${label} candidate package`, errors);
  if (!packageFile || !candidatePackage) return null;
  let current;
  let bound;
  try {
    current = readJson(packageFile);
    bound = JSON.parse(candidatePackage.stdout);
  } catch (error) {
    errors.push(`${label} package JSON is invalid: ${error.message}`);
    return null;
  }
  const commandText = bound.scripts?.[step.script];
  if (current.scripts?.[step.script] !== commandText || typeof commandText !== 'string') {
    errors.push(`${label} npm script is missing or differs from the release candidate.`);
    return null;
  }
  if (typeof bound.scripts?.[`pre${step.script}`] === 'string' || typeof bound.scripts?.[`post${step.script}`] === 'string') {
    errors.push(`${label} npm script must not have implicit pre/post lifecycle hooks.`);
    return null;
  }
  if (!Number.isInteger(step.exitCode) || step.exitCode < 0 || step.exitCode > 255) {
    errors.push(`${label} must declare an expected exitCode from 0 to 255.`);
    return null;
  }
  for (const digest of ['stdoutSha256', 'stderrSha256']) {
    if (!/^[a-f0-9]{64}$/.test(step[digest] ?? '')) errors.push(`${label} ${digest} must be a lowercase SHA-256 digest.`);
  }
  return {
    packagePath,
    script: step.script,
    commandText,
    commandSha256: sha256(commandText),
    expectedExitCode: step.exitCode,
    stdoutSha256: step.stdoutSha256,
    stderrSha256: step.stderrSha256,
  };
}

function addReplayGroup(replayState, kind, steps, label, errors) {
  if (steps.length === 0 || steps.some((step) => !step)) return;
  for (const step of steps) {
    if (step.packagePath !== replayState.releaseUnitPath) {
      errors.push(`${label} packagePath must match releaseUnit.packagePath ${replayState.releaseUnitPath}.`);
      return;
    }
    const key = `${step.packagePath}\0${step.script}`;
    const previous = replayState.specByKey.get(key);
    if (previous && stableJson(previous) !== stableJson(step)) {
      errors.push(`${label} conflicts with another receipt for the same npm script.`);
      return;
    }
    if (!previous) replayState.specByKey.set(key, step);
  }
  const group = { kind, steps };
  const signature = sha256(stableJson(group));
  if (!replayState.groupSignatures.has(signature)) {
    replayState.groupSignatures.add(signature);
    replayState.groups.push(group);
  }
}

function collectNpmReplay(root, verification, label, candidate, errors, replayState) {
  if (verification.runner !== 'npm-script') {
    errors.push(`${label} executable verification must use the npm-script runner.`);
    return;
  }
  if (verification.mode === 'command') {
    if (verification.exitCode !== 0) errors.push(`${label} command verification must expect exitCode 0.`);
    const step = buildNpmReplayStep(root, verification.packagePath, verification, label, candidate, errors);
    addReplayGroup(replayState, 'command', step ? [{ ...step, phase: 'command' }] : [], label, errors);
    return;
  }
  if (!Array.isArray(verification.steps) || verification.steps.length !== 2) {
    errors.push(`${label} probe verification must contain exactly failure and recovery steps.`);
    return;
  }
  const [failure, recovery] = verification.steps;
  if (failure?.phase !== 'failure' || !Number.isInteger(failure.exitCode) || failure.exitCode === 0) {
    errors.push(`${label} probe failure step must expect a non-zero exitCode.`);
  }
  if (recovery?.phase !== 'recovery' || recovery.exitCode !== 0) {
    errors.push(`${label} probe recovery step must expect exitCode 0.`);
  }
  const failureStep = buildNpmReplayStep(root, verification.packagePath, failure ?? {}, `${label} failure step`, candidate, errors);
  const recoveryStep = buildNpmReplayStep(root, verification.packagePath, recovery ?? {}, `${label} recovery step`, candidate, errors);
  addReplayGroup(replayState, 'probe', [
    failureStep ? { ...failureStep, phase: 'failure' } : null,
    recoveryStep ? { ...recoveryStep, phase: 'recovery' } : null,
  ], label, errors);
}

export function validateReceiptVerification(root, receipt, label, allowedModes, candidate, policyInfo, generatedAt, errors, identities, replayState) {
  const verification = receipt.verification;
  if (!verification || !allowedModes.includes(verification.mode) || verification.outcome !== 'passed' || typeof verification.summary !== 'string' || !verification.summary.trim()) {
    errors.push(`${label} must contain a passing verification with an allowed mode and summary.`);
    return;
  }
  const startedAt = validateRecordedAt(verification.startedAt, `${label} startedAt`, generatedAt, errors);
  const finishedAt = validateRecordedAt(verification.finishedAt, `${label} finishedAt`, generatedAt, errors);
  if (startedAt !== null && finishedAt !== null && startedAt > finishedAt) errors.push(`${label} startedAt must not be later than finishedAt.`);
  const subject = repositoryFile(root, verification.subjectReference, `${label} subject`, errors);
  if (subject) {
    const identity = claimArtifact(subject, `${label} subject`, identities, errors);
    if (verification.subjectSha256 !== identity.sha256) errors.push(`${label} subjectSha256 does not match its referenced artifact.`);
  }
  if (['command', 'probe'].includes(verification.mode)) {
    collectNpmReplay(root, verification, label, candidate, errors, replayState);
  }
  if (receipt.candidateRevision !== candidate?.releaseRevision || receipt.candidateTree !== candidate?.releaseTree || receipt.policySha256 !== policyInfo.digest) errors.push(`${label} is not bound to the release candidate and policy.`);
}


export function replayPlanFor(root, candidate, preflightHead, replayState) {
  const commands = replayState.groups.flatMap((group, groupIndex) => group.steps.map((step, stepIndex) => ({
    ...step,
    group: groupIndex + 1,
    sequence: stepIndex + 1,
  })));
  if (commands.length === 0) return null;
  const base = {
    schemaVersion: 1,
    targetRoot: root,
    preflightHead,
    releaseUnit: { type: 'npm-package', packagePath: replayState.releaseUnitPath },
    candidateRevision: candidate?.releaseRevision ?? null,
    candidateTree: candidate?.releaseTree ?? null,
    commands,
  };
  return { ...base, planHash: sha256(stableJson(base)) };
}

export function executeReplayPlan(root, replayPlan, errors) {
  const executed = [];
  for (const command of replayPlan.commands) {
    const startedAt = new Date().toISOString();
    const result = runNpmScript(path.dirname(path.join(root, command.packagePath)), command.script, { maxBuffer: 8 * 1024 * 1024 });
    const finishedAt = new Date().toISOString();
    const actual = {
      packagePath: command.packagePath,
      script: command.script,
      commandSha256: command.commandSha256,
      startedAt,
      finishedAt,
      exitCode: result.status,
      stdoutSha256: sha256(result.stdout ?? ''),
      stderrSha256: sha256(result.stderr ?? ''),
      status: 'passed',
    };
    if (result.error) {
      actual.status = 'failed';
      errors.push(`npm script replay could not run: ${command.script}.`);
    }
    if (actual.exitCode !== command.expectedExitCode) {
      actual.status = 'failed';
      errors.push(`npm script replay exitCode did not match its receipt: ${command.script}.`);
    }
    if (actual.stdoutSha256 !== command.stdoutSha256 || actual.stderrSha256 !== command.stderrSha256) {
      actual.status = 'failed';
      errors.push(`npm script replay output did not match its receipt: ${command.script}.`);
    }
    executed.push(actual);
  }
  return executed;
}

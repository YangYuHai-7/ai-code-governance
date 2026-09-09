import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { PACKAGE_ROOT } from './constants.mjs';
import { isSafeRelative, normalizeRelative, readJson, sha256, stableJson, usageError } from './utils.mjs';

const POLICY_PATH = path.join(PACKAGE_ROOT, 'assets', 'release-acceptance-policy.json');
const TIER_ORDER = ['bugfix', 'feature', 'major'];
const FINDING_SEVERITIES = new Set(['P0', 'P1', 'P2', 'P3']);
const FINDING_STATUSES = new Set(['open', 'resolved', 'accepted-risk']);

function assertPolicy(condition, message) {
  if (!condition) throw usageError(`Release acceptance policy is invalid: ${message}`);
}

export function validateReleaseAcceptancePolicy(policy) {
  assertPolicy(policy?.schemaVersion === 1, 'schemaVersion must be 1.');
  assertPolicy(typeof policy.policyId === 'string' && policy.policyId.length > 0, 'policyId is required.');
  assertPolicy(Array.isArray(policy.changeTypes) && policy.changeTypes.join(',') === TIER_ORDER.join(','), 'changeTypes must be bugfix, feature, major.');
  assertPolicy(Number.isFinite(policy.scorecard?.minimumWeightedScore), 'minimumWeightedScore is required.');
  assertPolicy(policy.scorecard.minimumWeightedScore >= 0 && policy.scorecard.minimumWeightedScore <= 100, 'minimumWeightedScore must be from 0 to 100.');
  assertPolicy(policy.scorecard?.blockingFindingSeverities?.join(',') === 'P0,P1', 'blockingFindingSeverities must be P0 and P1.');
  const dimensions = policy.scorecard?.dimensions;
  assertPolicy(Array.isArray(dimensions) && dimensions.length > 0, 'scorecard dimensions are required.');
  const dimensionIds = new Set();
  let weight = 0;
  for (const dimension of dimensions) {
    assertPolicy(typeof dimension.id === 'string' && dimension.id.length > 0, 'every scorecard dimension needs an id.');
    assertPolicy(!dimensionIds.has(dimension.id), `duplicate scorecard dimension ${dimension.id}.`);
    dimensionIds.add(dimension.id);
    assertPolicy(Number.isFinite(dimension.weight) && dimension.weight > 0, `${dimension.id} must have a positive weight.`);
    assertPolicy(Number.isFinite(dimension.minimumScore) && dimension.minimumScore >= 0 && dimension.minimumScore <= 100, `${dimension.id} has an invalid minimumScore.`);
    assertPolicy(typeof dimension.critical === 'boolean', `${dimension.id} must declare critical.`);
    weight += dimension.weight;
  }
  assertPolicy(weight === 100, `scorecard weights must total 100, found ${weight}.`);

  const evidenceCatalog = policy.evidenceCatalog;
  assertPolicy(evidenceCatalog && typeof evidenceCatalog === 'object' && !Array.isArray(evidenceCatalog), 'evidenceCatalog is required.');
  for (const type of TIER_ORDER) {
    const tier = policy.tiers?.[type];
    assertPolicy(tier?.semverChange === ({ bugfix: 'patch', feature: 'minor', major: 'major' })[type], `${type} has the wrong semverChange.`);
    assertPolicy(Number.isInteger(tier?.minimumParticipants?.engineers) && tier.minimumParticipants.engineers > 0, `${type} must require engineers.`);
    assertPolicy(Number.isInteger(tier?.minimumParticipants?.architects) && tier.minimumParticipants.architects > 0, `${type} must require architects.`);
    assertPolicy(Number.isInteger(tier?.maximumEvidenceAgeDays) && tier.maximumEvidenceAgeDays > 0, `${type} must define maximumEvidenceAgeDays.`);
    assertPolicy(Array.isArray(tier?.requiredEngineerScenarios) && tier.requiredEngineerScenarios.length > 0 && tier.requiredEngineerScenarios.length <= tier.minimumParticipants.engineers, `${type} must define primary engineer scenarios within its participant minimum.`);
    assertPolicy(new Set(tier.requiredEngineerScenarios).size === tier.requiredEngineerScenarios.length, `${type} engineer scenarios must be unique.`);
    assertPolicy(Array.isArray(tier?.requiredArchitectLenses) && tier.requiredArchitectLenses.length > 0 && tier.requiredArchitectLenses.length <= tier.minimumParticipants.architects, `${type} must define primary architect lenses within its participant minimum.`);
    assertPolicy(new Set(tier.requiredArchitectLenses).size === tier.requiredArchitectLenses.length, `${type} architect lenses must be unique.`);
    assertPolicy(Array.isArray(tier?.requiredEvidence) && tier.requiredEvidence.length > 0, `${type} must require evidence.`);
    const ids = new Set();
    for (const id of tier.requiredEvidence) {
      assertPolicy(!ids.has(id), `${type} repeats evidence ${id}.`);
      ids.add(id);
      const evidenceType = evidenceCatalog[id];
      assertPolicy(evidenceType && typeof evidenceType.description === 'string' && evidenceType.description.length > 0, `${type} references unknown evidence ${id}.`);
      assertPolicy(Array.isArray(evidenceType.verificationModes) && evidenceType.verificationModes.length > 0 && evidenceType.verificationModes.every((mode) => ['command', 'probe', 'review', 'artifact'].includes(mode)), `${id} must define valid verificationModes.`);
    }
  }
  for (const [signal, escalation] of Object.entries(policy.riskSignals ?? {})) {
    assertPolicy(TIER_ORDER.includes(escalation.minimumTier), `${signal} has an invalid minimumTier.`);
    assertPolicy(typeof escalation.reason === 'string' && escalation.reason.length > 0, `${signal} requires a reason.`);
    assertPolicy(escalation.requiresChangeType === undefined || TIER_ORDER.includes(escalation.requiresChangeType), `${signal} has an invalid requiresChangeType.`);
  }
  return policy;
}

export function loadReleaseAcceptancePolicy(policyPath = POLICY_PATH) {
  return validateReleaseAcceptancePolicy(readJson(policyPath));
}

function assertPolicyNotWeaker(projectPolicy, baseline) {
  assertPolicy(projectPolicy.scorecard.minimumWeightedScore >= baseline.scorecard.minimumWeightedScore, 'project minimumWeightedScore cannot weaken the built-in policy.');
  const projectDimensions = new Map(projectPolicy.scorecard.dimensions.map((dimension) => [dimension.id, dimension]));
  for (const baselineDimension of baseline.scorecard.dimensions) {
    const projectDimension = projectDimensions.get(baselineDimension.id);
    assertPolicy(Boolean(projectDimension), `project policy cannot remove scorecard dimension ${baselineDimension.id}.`);
    assertPolicy(projectDimension.weight === baselineDimension.weight, `project policy cannot reweight scorecard dimension ${baselineDimension.id}.`);
    assertPolicy(projectDimension.minimumScore >= baselineDimension.minimumScore, `project policy cannot lower ${baselineDimension.id} minimumScore.`);
    assertPolicy(!baselineDimension.critical || projectDimension.critical, `project policy cannot make ${baselineDimension.id} non-critical.`);
  }
  for (const type of TIER_ORDER) {
    const projectTier = projectPolicy.tiers[type];
    const baselineTier = baseline.tiers[type];
    for (const role of ['engineers', 'architects']) {
      assertPolicy(projectTier.minimumParticipants[role] >= baselineTier.minimumParticipants[role], `project ${type} policy cannot require fewer ${role}.`);
    }
    assertPolicy(projectTier.maximumEvidenceAgeDays <= baselineTier.maximumEvidenceAgeDays, `project ${type} policy cannot allow older evidence.`);
    for (const scenario of baselineTier.requiredEngineerScenarios) {
      assertPolicy(projectTier.requiredEngineerScenarios.includes(scenario), `project ${type} policy cannot remove engineer scenario ${scenario}.`);
    }
    for (const lens of baselineTier.requiredArchitectLenses) {
      assertPolicy(projectTier.requiredArchitectLenses.includes(lens), `project ${type} policy cannot remove architect lens ${lens}.`);
    }
    const projectEvidence = new Set(projectTier.requiredEvidence);
    for (const id of baselineTier.requiredEvidence) {
      assertPolicy(projectEvidence.has(id), `project ${type} policy cannot remove required evidence ${id}.`);
    }
  }
  for (const [id, description] of Object.entries(baseline.evidenceCatalog)) {
    assertPolicy(JSON.stringify(projectPolicy.evidenceCatalog[id]) === JSON.stringify(description), `project policy cannot redefine baseline evidence ${id}.`);
  }
  for (const [signal, baselineRule] of Object.entries(baseline.riskSignals)) {
    const projectRule = projectPolicy.riskSignals[signal];
    assertPolicy(Boolean(projectRule), `project policy cannot remove risk signal ${signal}.`);
    assertPolicy(TIER_ORDER.indexOf(projectRule.minimumTier) >= TIER_ORDER.indexOf(baselineRule.minimumTier), `project policy cannot lower the ${signal} acceptance tier.`);
    assertPolicy(projectRule.reason === baselineRule.reason, `project policy cannot redefine the ${signal} risk meaning.`);
    if (baselineRule.requiresChangeType) {
      assertPolicy(projectRule.requiresChangeType === baselineRule.requiresChangeType, `project policy cannot remove the ${signal} required change type.`);
    }
  }
}

function loadProjectReleaseAcceptancePolicy(root) {
  const projectPolicy = path.join(root, 'docs', 'ai', 'release-acceptance-policy.json');
  const projectOverride = path.join(root, 'docs', 'ai', 'release-acceptance-override.json');
  const baseline = loadReleaseAcceptancePolicy();
  const baselineDigest = sha256File(POLICY_PATH);
  let selected = { policy: baseline, source: 'built-in', absolutePath: POLICY_PATH, digest: baselineDigest };
  if (!fs.existsSync(projectPolicy)) {
    if (!fs.existsSync(projectOverride)) return selected;
  } else {
    const errors = [];
    const safePolicy = repositoryFile(root, 'docs/ai/release-acceptance-policy.json', 'release acceptance policy', errors);
    if (!safePolicy) throw usageError(errors.join(' '));
    const policy = loadReleaseAcceptancePolicy(safePolicy);
    assertPolicy(sha256File(safePolicy) === baselineDigest, 'project policy snapshot is stale or drifted; review and run aicg sync before release.');
    selected = { policy, source: 'project-snapshot', absolutePath: safePolicy, digest: baselineDigest };
  }
  if (!fs.existsSync(projectOverride)) return selected;
  const errors = [];
  const safeOverride = repositoryFile(root, 'docs/ai/release-acceptance-override.json', 'release acceptance override', errors);
  if (!safeOverride) throw usageError(errors.join(' '));
  const override = loadReleaseAcceptancePolicy(safeOverride);
  assertPolicyNotWeaker(override, baseline);
  return { policy: override, source: 'project-override', absolutePath: safeOverride, digest: sha256File(safeOverride) };
}

function requirementFor(policy, changeType, riskSignals) {
  if (!TIER_ORDER.includes(changeType)) throw usageError('Release acceptance --type must be bugfix, feature, or major.');
  let effectiveTier = changeType;
  const escalations = [];
  for (const signal of riskSignals) {
    const rule = policy.riskSignals[signal];
    if (!rule) continue;
    if (TIER_ORDER.indexOf(rule.minimumTier) > TIER_ORDER.indexOf(effectiveTier)) effectiveTier = rule.minimumTier;
    escalations.push({ signal, ...rule });
  }
  return {
    declaredChangeType: changeType,
    effectiveAcceptanceTier: effectiveTier,
    escalations,
    semverChange: policy.tiers[changeType].semverChange,
    minimumParticipants: policy.tiers[effectiveTier].minimumParticipants,
    requiredEvidence: policy.tiers[effectiveTier].requiredEvidence,
    maximumEvidenceAgeDays: policy.tiers[effectiveTier].maximumEvidenceAgeDays,
    requiredEngineerScenarios: policy.tiers[effectiveTier].requiredEngineerScenarios,
    requiredArchitectLenses: policy.tiers[effectiveTier].requiredArchitectLenses,
    scorecard: policy.scorecard,
  };
}

export function releaseAcceptanceRequirements(changeType, riskSignals = [], policy = loadReleaseAcceptancePolicy()) {
  return requirementFor(policy, changeType, riskSignals);
}

function repositoryFile(root, relative, label, errors) {
  if (typeof relative !== 'string' || !isSafeRelative(relative)) {
    errors.push(`${label} must be a safe repository-relative path.`);
    return null;
  }
  const normalized = normalizeRelative(relative);
  let current = root;
  for (const segment of normalized.split('/')) {
    current = path.join(current, segment);
    let stat;
    try {
      stat = fs.lstatSync(current);
    } catch (error) {
      errors.push(`${label} does not exist: ${normalized}.`);
      return null;
    }
    if (stat.isSymbolicLink()) {
      errors.push(`${label} must not traverse a symbolic link: ${normalized}.`);
      return null;
    }
  }
  const finalStat = fs.statSync(current);
  if (!finalStat.isFile()) {
    errors.push(`${label} must be a regular file: ${normalized}.`);
    return null;
  }
  if (finalStat.nlink > 1) {
    errors.push(`${label} must not be a hard-linked file: ${normalized}.`);
    return null;
  }
  const tracked = git(root, ['ls-files', '--error-unmatch', '--', normalized], `${label} Git tracking`, errors);
  if (!tracked) {
    errors.push(`${label} must be tracked by Git: ${normalized}.`);
    return null;
  }
  const unchanged = git(root, ['diff', '--quiet', 'HEAD', '--', normalized], `${label} HEAD binding`, errors, [0, 1]);
  if (!unchanged || unchanged.status !== 0) {
    errors.push(`${label} must match the file committed at HEAD: ${normalized}.`);
    return null;
  }
  return current;
}

function sha256File(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function artifactIdentity(file) {
  const stat = fs.statSync(file);
  return {
    inode: stat.ino ? `${stat.dev}:${stat.ino}` : null,
    sha256: sha256File(file),
  };
}

function claimArtifact(file, label, identities, errors) {
  const identity = artifactIdentity(file);
  if (identity.inode && identities.inodes.has(identity.inode)) errors.push(`${label} must not reuse a hard-linked evidence file.`);
  if (identities.hashes.has(identity.sha256)) errors.push(`${label} must not reuse identical evidence content.`);
  if (identity.inode) identities.inodes.add(identity.inode);
  identities.hashes.add(identity.sha256);
  identities.snapshots.set(file, identity.sha256);
  return identity;
}

function repositoryJson(root, relative, label, errors, identities = null) {
  const file = repositoryFile(root, relative, label, errors);
  if (!file) return null;
  if (identities) claimArtifact(file, label, identities, errors);
  try {
    return readJson(file);
  } catch (error) {
    errors.push(`${label} must be valid JSON: ${error.message}`);
    return null;
  }
}

function git(root, args, label, errors, acceptedStatuses = [0]) {
  const executable = process.platform === 'win32' ? 'git.exe' : 'git';
  const result = spawnSync(executable, ['-C', root, ...args], {
    encoding: 'utf8',
    timeout: 30000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || !acceptedStatuses.includes(result.status)) {
    errors.push(`${label} could not be verified by Git.`);
    return null;
  }
  return { stdout: result.stdout, text: result.stdout.trim(), status: result.status };
}

function validateCandidate(root, evidence, errors) {
  const candidate = evidence.candidate;
  if (!candidate || typeof candidate !== 'object') {
    errors.push('candidate must bind the release to Git base, revision, and tree hashes.');
    return null;
  }
  for (const field of ['baseRevision', 'releaseRevision', 'releaseTree']) {
    if (!/^[a-f0-9]{40}$/.test(candidate[field] ?? '')) errors.push(`candidate.${field} must be a full lowercase Git SHA.`);
  }
  if (errors.some((error) => error.startsWith('candidate.'))) return null;
  const releaseRevision = git(root, ['rev-parse', `${candidate.releaseRevision}^{commit}`], 'candidate release revision', errors);
  const releaseTree = git(root, ['rev-parse', `${candidate.releaseRevision}^{tree}`], 'candidate release tree', errors);
  const baseRevision = git(root, ['rev-parse', `${candidate.baseRevision}^{commit}`], 'candidate base revision', errors);
  const baseTree = git(root, ['rev-parse', `${candidate.baseRevision}^{tree}`], 'candidate base tree', errors);
  if (!releaseRevision || !releaseTree || !baseRevision || !baseTree) return null;
  if (releaseRevision.text !== candidate.releaseRevision) errors.push('candidate.releaseRevision does not resolve to the declared commit.');
  if (releaseTree.text !== candidate.releaseTree) errors.push('candidate.releaseTree does not match the declared release revision.');
  if (candidate.baseRevision === candidate.releaseRevision) errors.push('candidate.baseRevision and candidate.releaseRevision must differ.');
  if (baseTree.text === releaseTree.text) errors.push('candidate release tree must differ from its base tree.');
  const baseAncestor = git(root, ['merge-base', '--is-ancestor', candidate.baseRevision, candidate.releaseRevision], 'candidate base ancestry', errors, [0, 1]);
  if (baseAncestor?.status !== 0) errors.push('candidate.baseRevision must be an ancestor of candidate.releaseRevision.');
  const headAncestor = git(root, ['merge-base', '--is-ancestor', candidate.releaseRevision, 'HEAD'], 'candidate HEAD ancestry', errors, [0, 1]);
  if (headAncestor?.status !== 0) errors.push('candidate.releaseRevision must be an ancestor of HEAD.');
  const changed = git(root, ['diff', '--name-only', '--no-renames', '-z', `${candidate.releaseRevision}..HEAD`, '--'], 'post-candidate changes', errors);
  if (changed) {
    const paths = changed.stdout.split('\0').filter(Boolean);
    const unexpected = paths.filter((relative) => !normalizeRelative(relative).startsWith('docs/ai/release-evidence/'));
    if (unexpected.length > 0) errors.push(`Only release evidence may change after candidate.releaseRevision: ${unexpected.join(', ')}.`);
  }
  const status = git(root, ['status', '--porcelain=v1', '--untracked-files=all'], 'release worktree cleanliness', errors);
  if (status?.stdout) errors.push('Release acceptance requires a clean Git worktree and index.');
  return candidate;
}

function parseTimestamp(value, label, errors) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/.test(value)) {
    errors.push(`${label} must be an ISO-8601 timestamp.`);
    return null;
  }
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) {
    errors.push(`${label} must be a valid ISO-8601 timestamp.`);
    return null;
  }
  return timestamp;
}

function validateRecordedAt(value, label, generatedAt, errors) {
  const timestamp = parseTimestamp(value, label, errors);
  const generated = Date.parse(generatedAt ?? '');
  if (timestamp !== null && Number.isFinite(generated) && timestamp > generated) errors.push(`${label} must not be later than generatedAt.`);
  return timestamp;
}

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

function validateReceiptVerification(root, receipt, label, allowedModes, candidate, policyInfo, generatedAt, errors, identities, replayState) {
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

function validateEvidenceFreshness(evidence, requirement, errors) {
  const generatedAt = parseTimestamp(evidence.generatedAt, 'generatedAt', errors);
  const consensusAt = parseTimestamp(evidence.consensusAt, 'consensusAt', errors);
  const now = Date.now();
  if (generatedAt !== null) {
    if (generatedAt > now + 5 * 60 * 1000) errors.push('generatedAt cannot be in the future.');
    if (now - generatedAt > requirement.maximumEvidenceAgeDays * 86400000) errors.push(`release evidence is older than ${requirement.maximumEvidenceAgeDays} days.`);
  }
  if (generatedAt !== null && consensusAt !== null && consensusAt > generatedAt) errors.push('consensusAt must not be later than generatedAt.');
  return { generatedAt, consensusAt };
}

function validatePolicyBinding(evidence, policyInfo, errors) {
  if (evidence.policy?.id !== policyInfo.policy.policyId) errors.push(`policy.id must be ${policyInfo.policy.policyId}.`);
  if (evidence.policy?.sha256 !== policyInfo.digest) errors.push('policy.sha256 does not match the effective release acceptance policy.');
}

function parseSemver(value) {
  const identifier = '(?:0|[1-9]\\d*|\\d*[A-Za-z-][0-9A-Za-z-]*)';
  const match = String(value ?? '').match(new RegExp(`^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)(?:-(${identifier}(?:\\.${identifier})*))?(?:\\+([0-9A-Za-z-]+(?:\\.[0-9A-Za-z-]+)*))?$`));
  return match ? { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] ?? null } : null;
}

function validateVersionChange(root, evidence, requirement, candidate, errors) {
  const previous = parseSemver(evidence.previousVersion);
  const release = parseSemver(evidence.releaseVersion);
  if (!previous) errors.push('previousVersion must be valid semver.');
  if (!release) errors.push('releaseVersion must be valid semver.');
  if (previous?.prerelease || release?.prerelease) errors.push('release acceptance currently requires stable SemVer versions; prerelease transitions are unsupported.');
  if (previous && release) {
    const matches = requirement.semverChange === 'patch'
      ? release.major === previous.major && release.minor === previous.minor && release.patch > previous.patch
      : requirement.semverChange === 'minor'
        ? release.major === previous.major && release.minor > previous.minor && release.patch === 0
        : release.major > previous.major && release.minor === 0 && release.patch === 0;
    if (!matches) errors.push(`${evidence.previousVersion} -> ${evidence.releaseVersion} does not match ${requirement.declaredChangeType} (${requirement.semverChange}) versioning.`);
  }
  const authority = evidence.versionAuthority;
  if (!authority || !['package-json', 'git-tags'].includes(authority.type)) {
    errors.push('versionAuthority must select package-json or git-tags.');
    return;
  }
  if (authority.type === 'git-tags') {
    const expectedTags = [
      ['previousTag', evidence.previousVersion, candidate?.baseRevision],
      ['releaseTag', evidence.releaseVersion, candidate?.releaseRevision],
    ];
    for (const [field, version, revision] of expectedTags) {
      const tag = authority[field];
      if (tag !== version && tag !== `v${version}`) {
        errors.push(`versionAuthority.${field} must equal ${version} or v${version}.`);
        continue;
      }
      const resolved = git(root, ['rev-parse', `refs/tags/${tag}^{commit}`], `version tag ${tag}`, errors);
      if (resolved && resolved.text !== revision) errors.push(`version tag ${tag} does not resolve to the bound candidate revision.`);
    }
    return;
  }
  if (typeof authority.path !== 'string' || !isSafeRelative(authority.path) || authority.path.includes(':')) {
    errors.push('versionAuthority.path must be a safe repository-relative package JSON path.');
    return;
  }
  const authorityPath = normalizeRelative(authority.path);
  if (candidate) {
    for (const [revision, expected, label] of [
      [candidate.baseRevision, evidence.previousVersion, 'base'],
      [candidate.releaseRevision, evidence.releaseVersion, 'release'],
    ]) {
      const shown = git(root, ['show', `${revision}:${authorityPath}`], `${label} version authority`, errors);
      if (!shown) continue;
      try {
        const actual = JSON.parse(shown.stdout).version;
        if (actual !== expected) errors.push(`${label} ${authorityPath} version ${actual ?? 'missing'} does not match ${expected}.`);
      } catch (error) {
        errors.push(`${label} ${authorityPath} is not valid package JSON: ${error.message}`);
      }
    }
  }
  const packagePath = path.join(root, authorityPath);
  if (fs.existsSync(packagePath)) {
    try {
      const safePackage = repositoryFile(root, authorityPath, 'version authority', errors);
      if (!safePackage) return;
      const packageVersion = readJson(safePackage).version;
      if (packageVersion !== evidence.releaseVersion) errors.push(`${authorityPath} version ${packageVersion ?? 'missing'} does not match releaseVersion ${evidence.releaseVersion}.`);
    } catch (error) {
      errors.push(`Cannot validate package.json version: ${error.message}`);
    }
  }
}

function validateReleaseUnit(evidence, verifyPackageArtifact, errors) {
  const unit = evidence.releaseUnit;
  if (!unit || unit.type !== 'npm-package' || typeof unit.packagePath !== 'string' || !isSafeRelative(unit.packagePath) || unit.packagePath.includes(':')) {
    errors.push('releaseUnit must select an npm-package with a safe repository-relative packagePath.');
    return null;
  }
  const packagePath = normalizeRelative(unit.packagePath);
  if (path.basename(packagePath) !== 'package.json') {
    errors.push('releaseUnit.packagePath must name package.json.');
    return null;
  }
  if (evidence.versionAuthority?.type === 'package-json' && normalizeRelative(evidence.versionAuthority.path ?? '') !== packagePath) {
    errors.push('package-json versionAuthority.path must match releaseUnit.packagePath.');
  }
  if (verifyPackageArtifact && packagePath !== 'package.json') {
    errors.push('npm publication acceptance must bind releaseUnit.packagePath to the repository root package.json.');
  }
  return packagePath;
}

function validatePostReplayState(root, expectedHead, identities, evidence, errors) {
  const actualHead = git(root, ['rev-parse', 'HEAD'], 'post-replay HEAD', errors);
  if (actualHead && actualHead.text !== expectedHead) errors.push('Replay must not change the preflight HEAD commit.');
  for (const [file, digest] of identities.snapshots) {
    try {
      if (sha256File(file) !== digest) errors.push(`Replay changed a validated evidence artifact: ${normalizeRelative(path.relative(root, file))}.`);
    } catch {
      errors.push(`Replay removed a validated evidence artifact: ${normalizeRelative(path.relative(root, file))}.`);
    }
  }
  validateCandidate(root, evidence, errors);
}

function validateScorecard(policy, evidence, errors) {
  const scorecard = evidence.scorecard;
  if (!scorecard || typeof scorecard !== 'object' || Array.isArray(scorecard)) {
    errors.push('scorecard must provide every policy dimension.');
    return null;
  }
  const known = new Set(policy.scorecard.dimensions.map((dimension) => dimension.id));
  for (const id of Object.keys(scorecard)) if (!known.has(id)) errors.push(`scorecard contains unknown dimension ${id}.`);
  let weightedScore = 0;
  for (const dimension of policy.scorecard.dimensions) {
    const score = scorecard[dimension.id];
    if (!Number.isFinite(score) || score < 0 || score > 100) {
      errors.push(`scorecard.${dimension.id} must be a number from 0 to 100.`);
      continue;
    }
    weightedScore += score * dimension.weight / 100;
    if (score < dimension.minimumScore) errors.push(`scorecard.${dimension.id} ${score} is below ${dimension.minimumScore}.`);
  }
  weightedScore = Math.round(weightedScore * 100) / 100;
  if (weightedScore < policy.scorecard.minimumWeightedScore) errors.push(`weighted score ${weightedScore} is below ${policy.scorecard.minimumWeightedScore}.`);
  return weightedScore;
}

function validateParticipants(root, policy, policyInfo, evidence, requirement, candidate, timestamps, errors, identities) {
  const participants = evidence.participants;
  if (!participants || !Array.isArray(participants.engineers) || !Array.isArray(participants.architects)) {
    errors.push('participants must contain engineers and architects arrays.');
    return { counts: { engineers: 0, architects: 0 }, aggregateScorecard: null, reportedFindings: [] };
  }
  const implementationAuthors = Array.isArray(evidence.implementationAuthors) ? evidence.implementationAuthors : [];
  if (implementationAuthors.length === 0 || implementationAuthors.some((id) => typeof id !== 'string' || !id)) errors.push('implementationAuthors must contain at least one stable identity.');
  if (new Set(implementationAuthors).size !== implementationAuthors.length) errors.push('implementationAuthors must not contain duplicates.');
  const ids = new Set();
  const reports = [];
  function validate(records, role, passingStatus) {
    let accepted = 0;
    for (const record of records) {
      if (!record || typeof record.id !== 'string' || !record.id) {
        errors.push(`${role} participant requires a stable id.`);
        continue;
      }
      if (ids.has(record.id)) errors.push(`participant id is duplicated: ${record.id}.`);
      ids.add(record.id);
      if (implementationAuthors.includes(record.id)) errors.push(`${record.id} cannot review an implementation they authored.`);
      const report = repositoryJson(root, record.scorecard, `${record.id} scorecard`, errors, identities);
      if (!report) continue;
      if (report.schemaVersion !== 1) errors.push(`${record.id} scorecard schemaVersion must be 1.`);
      if (report.participantId !== record.id) errors.push(`${record.id} scorecard participantId does not match.`);
      if (report.role !== role) errors.push(`${record.id} scorecard role must be ${role}.`);
      if (report.independent !== true) errors.push(`${record.id} must attest independent evaluation in the scorecard.`);
      if (report.verdict !== passingStatus) errors.push(`${record.id} scorecard verdict must be ${passingStatus}.`);
      if (report.candidateRevision !== candidate?.releaseRevision || report.candidateTree !== candidate?.releaseTree) errors.push(`${record.id} scorecard is not bound to the release candidate.`);
      if (report.policySha256 !== policyInfo.digest) errors.push(`${record.id} scorecard is not bound to the effective policy.`);
      const submittedAt = parseTimestamp(report.submittedAt, `${record.id} submittedAt`, errors);
      if (submittedAt !== null && timestamps.consensusAt !== null && submittedAt >= timestamps.consensusAt) errors.push(`${record.id} scorecard must be submitted before consensusAt.`);
      if (!report.scores || typeof report.scores !== 'object' || Array.isArray(report.scores)) {
        errors.push(`${record.id} scorecard must contain scores.`);
      } else {
        const known = new Set(policy.scorecard.dimensions.map((dimension) => dimension.id));
        for (const key of Object.keys(report.scores)) if (!known.has(key)) errors.push(`${record.id} scorecard contains unknown dimension ${key}.`);
        for (const dimension of policy.scorecard.dimensions) {
          const score = report.scores[dimension.id];
          if (!Number.isFinite(score) || score < 0 || score > 100) errors.push(`${record.id} scorecard.${dimension.id} must be a number from 0 to 100.`);
        }
      }
      if (!Array.isArray(report.findings)) {
        errors.push(`${record.id} scorecard findings must be an array.`);
      } else {
        for (const finding of report.findings) {
          if (!finding || typeof finding.id !== 'string' || !finding.id || !FINDING_SEVERITIES.has(finding.severity)) errors.push(`${record.id} scorecard contains an invalid finding.`);
        }
      }
      if (role === 'engineer' && (typeof report.primaryScenario !== 'string' || !report.primaryScenario.trim())) errors.push(`${record.id} must name a primaryScenario.`);
      if (role === 'architect' && (typeof report.primaryLens !== 'string' || !report.primaryLens.trim())) errors.push(`${record.id} must name a primaryLens.`);
      reports.push(report);
      if (report.independent === true && report.verdict === passingStatus) accepted += 1;
    }
    return accepted;
  }
  const engineers = validate(participants.engineers, 'engineer', 'passed');
  const architects = validate(participants.architects, 'architect', 'approved');
  if (engineers < requirement.minimumParticipants.engineers) errors.push(`${requirement.effectiveAcceptanceTier} acceptance requires ${requirement.minimumParticipants.engineers} passing engineers; found ${engineers}.`);
  if (architects < requirement.minimumParticipants.architects) errors.push(`${requirement.effectiveAcceptanceTier} acceptance requires ${requirement.minimumParticipants.architects} approving architects; found ${architects}.`);
  const engineerScenarios = reports.filter((report) => report.role === 'engineer').map((report) => report.primaryScenario);
  const architectLenses = reports.filter((report) => report.role === 'architect').map((report) => report.primaryLens);
  if (new Set(engineerScenarios).size !== engineerScenarios.length) errors.push('engineer primaryScenario assignments must be unique.');
  if (new Set(architectLenses).size !== architectLenses.length) errors.push('architect primaryLens assignments must be unique.');
  for (const scenario of requirement.requiredEngineerScenarios) if (!engineerScenarios.includes(scenario)) errors.push(`required engineer scenario is missing: ${scenario}.`);
  for (const lens of requirement.requiredArchitectLenses) if (!architectLenses.includes(lens)) errors.push(`required architect lens is missing: ${lens}.`);
  const aggregateScorecard = Object.fromEntries(policy.scorecard.dimensions.map((dimension) => [
    dimension.id,
    reports.length > 0 ? Math.min(...reports.map((report) => report.scores?.[dimension.id]).filter(Number.isFinite)) : Number.NaN,
  ]));
  return {
    counts: { engineers, architects },
    aggregateScorecard,
    reportedFindings: reports.flatMap((report) => report.findings ?? []),
  };
}

function validateRiskAssessments(policy, policyInfo, evidence, candidate, errors) {
  if (!Array.isArray(evidence.riskAssessments)) {
    errors.push('riskAssessments must contain implementer and independent-reviewer assessments.');
    return [];
  }
  const byRole = new Map();
  const implementationAuthors = new Set(evidence.implementationAuthors ?? []);
  const architectIds = new Set((evidence.participants?.architects ?? []).map((participant) => participant?.id));
  for (const assessment of evidence.riskAssessments) {
    if (!assessment || !['implementer', 'independent-reviewer'].includes(assessment.role)) {
      errors.push('risk assessment role must be implementer or independent-reviewer.');
      continue;
    }
    if (byRole.has(assessment.role)) errors.push(`riskAssessments repeats role ${assessment.role}.`);
    byRole.set(assessment.role, assessment);
    if (typeof assessment.reviewerId !== 'string' || !assessment.reviewerId) errors.push(`${assessment.role} risk assessment requires reviewerId.`);
    if (assessment.role === 'implementer' && !implementationAuthors.has(assessment.reviewerId)) errors.push('implementer risk reviewer must be listed in implementationAuthors.');
    if (assessment.role === 'independent-reviewer' && implementationAuthors.has(assessment.reviewerId)) errors.push('independent risk reviewer cannot be an implementation author.');
    if (assessment.role === 'independent-reviewer' && !architectIds.has(assessment.reviewerId)) errors.push('independent risk reviewer must be a recorded architect participant.');
    if (assessment.candidateRevision !== candidate?.releaseRevision || assessment.candidateTree !== candidate?.releaseTree) errors.push(`${assessment.role} risk assessment is not bound to the release candidate.`);
    if (assessment.policySha256 !== policyInfo.digest) errors.push(`${assessment.role} risk assessment is not bound to the effective policy.`);
    const submittedAt = parseTimestamp(assessment.submittedAt, `${assessment.role} risk assessment submittedAt`, errors);
    const consensusAt = Date.parse(evidence.consensusAt ?? '');
    if (submittedAt !== null && Number.isFinite(consensusAt) && submittedAt >= consensusAt) errors.push(`${assessment.role} risk assessment must be submitted before consensusAt.`);
    if (!Array.isArray(assessment.signals)) {
      errors.push(`${assessment.role} risk assessment signals must be an array.`);
    } else {
      if (new Set(assessment.signals).size !== assessment.signals.length) errors.push(`${assessment.role} risk assessment signals must not contain duplicates.`);
      for (const signal of assessment.signals) if (!policy.riskSignals[signal]) errors.push(`${assessment.role} risk assessment has unknown signal ${signal}.`);
    }
    if (typeof assessment.rationale !== 'string' || !assessment.rationale.trim()) errors.push(`${assessment.role} risk assessment requires rationale.`);
  }
  for (const role of ['implementer', 'independent-reviewer']) if (!byRole.has(role)) errors.push(`risk assessment is missing role ${role}.`);
  const signals = [...new Set([...byRole.values()].flatMap((assessment) => assessment.signals ?? []))].sort();
  const declared = Array.isArray(evidence.riskSignals) ? [...new Set(evidence.riskSignals)].sort() : [];
  if (signals.join(',') !== declared.join(',')) errors.push('riskSignals must equal the union of both risk assessments.');
  return signals;
}

function validateFindingResolution(root, finding, policyInfo, candidate, generatedAt, errors, identities, replayState) {
  const receipt = repositoryJson(root, finding.resolutionReference, `${finding.id} resolution reference`, errors, identities);
  if (!receipt) return;
  if (receipt.schemaVersion !== 1 || receipt.findingId !== finding.id) errors.push(`${finding.id} resolution receipt is invalid.`);
  validateRecordedAt(receipt.recordedAt, `${finding.id} resolution recordedAt`, generatedAt, errors);
  if (typeof receipt.summary !== 'string' || !receipt.summary.trim()) errors.push(`${finding.id} resolution receipt requires summary.`);
  validateReceiptVerification(root, receipt, `${finding.id} resolution receipt`, ['command', 'probe'], candidate, policyInfo, generatedAt, errors, identities, replayState);
}

function validateFindings(root, policy, policyInfo, evidence, reportedFindings, candidate, errors, identities, replayState) {
  if (!Array.isArray(evidence.findings)) {
    errors.push('findings must be an array, including an empty array when no findings remain.');
    return;
  }
  const ids = new Set();
  const blocking = new Set(policy.scorecard.blockingFindingSeverities);
  for (const finding of evidence.findings) {
    if (!finding || typeof finding.id !== 'string' || !finding.id) {
      errors.push('every finding requires an id.');
      continue;
    }
    if (ids.has(finding.id)) errors.push(`finding id is duplicated: ${finding.id}.`);
    ids.add(finding.id);
    if (!FINDING_SEVERITIES.has(finding.severity)) errors.push(`${finding.id} has invalid severity.`);
    if (!FINDING_STATUSES.has(finding.status)) errors.push(`${finding.id} has invalid status.`);
    if (typeof finding.summary !== 'string' || !finding.summary.trim()) errors.push(`${finding.id} requires a summary.`);
    if (blocking.has(finding.severity) && finding.status !== 'resolved') errors.push(`${finding.id} is an unresolved blocking ${finding.severity} finding.`);
    if (blocking.has(finding.severity) && finding.status === 'resolved') validateFindingResolution(root, finding, policyInfo, candidate, evidence.generatedAt, errors, identities, replayState);
    const reviewTime = Date.parse(`${finding.reviewBy ?? ''}T00:00:00Z`);
    if (finding.status === 'accepted-risk' && (typeof finding.owner !== 'string' || !finding.owner.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(finding.reviewBy ?? '') || !Number.isFinite(reviewTime) || finding.reviewBy < new Date().toISOString().slice(0, 10) || typeof finding.reason !== 'string' || !finding.reason.trim())) {
      errors.push(`${finding.id} accepted risk requires a non-empty owner, reason, and a valid non-expired reviewBy date.`);
    }
  }
  const severityRank = { P0: 0, P1: 1, P2: 2, P3: 3 };
  const reportedById = new Map();
  for (const finding of reportedFindings) {
    const previous = reportedById.get(finding.id);
    if (!previous || severityRank[finding.severity] < severityRank[previous]) reportedById.set(finding.id, finding.severity);
  }
  const rootById = new Map(evidence.findings.map((finding) => [finding.id, finding]));
  for (const [id, severity] of reportedById) {
    const finding = rootById.get(id);
    if (!finding) errors.push(`participant finding is missing from root findings: ${id}.`);
    else if (finding.severity !== severity) errors.push(`root finding ${id} must preserve the most severe participant rating ${severity}.`);
  }
}

function validateEvidenceEntries(root, policy, policyInfo, evidence, requirement, candidate, errors, identities, replayState) {
  if (!Array.isArray(evidence.evidence)) {
    errors.push('evidence must be an array.');
    return { passed: 0, required: requirement.requiredEvidence.length };
  }
  const entries = new Map();
  for (const entry of evidence.evidence) {
    if (!entry || typeof entry.id !== 'string' || !entry.id) {
      errors.push('every evidence entry requires an id.');
      continue;
    }
    if (entries.has(entry.id)) errors.push(`evidence id is duplicated: ${entry.id}.`);
    entries.set(entry.id, entry);
    if (!policy.evidenceCatalog[entry.id]) errors.push(`evidence id is unknown: ${entry.id}.`);
  }
  let passed = 0;
  for (const id of requirement.requiredEvidence) {
    const entry = entries.get(id);
    if (!entry) {
      errors.push(`required evidence is missing: ${id}.`);
      continue;
    }
    if (entry.status !== 'passed') errors.push(`${id} must have status passed.`);
    const receipt = repositoryJson(root, entry.reference, `${id} reference`, errors, identities);
    if (receipt) {
      if (receipt.schemaVersion !== 1 || receipt.evidenceId !== id) errors.push(`${id} receipt must use schemaVersion 1 and the matching evidenceId.`);
      validateRecordedAt(receipt.recordedAt, `${id} recordedAt`, evidence.generatedAt, errors);
      const allowedModes = policy.evidenceCatalog[id]?.verificationModes ?? [];
      validateReceiptVerification(root, receipt, `${id} receipt`, allowedModes, candidate, policyInfo, evidence.generatedAt, errors, identities, replayState);
    }
    if (entry.status === 'passed' && receipt) passed += 1;
  }
  return { passed, required: requirement.requiredEvidence.length };
}

function validatePackageArtifact(root, evidence, errors) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(executable, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
    cwd: root,
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    errors.push('npm package artifact fingerprint could not be generated.');
    return null;
  }
  let packed;
  try {
    packed = JSON.parse(result.stdout)?.[0];
  } catch (error) {
    errors.push(`npm package artifact output is invalid: ${error.message}`);
    return null;
  }
  const expected = evidence.packageArtifact;
  if (!expected || expected.type !== 'npm-pack' || expected.filename !== packed?.filename || expected.shasum !== packed?.shasum || expected.integrity !== packed?.integrity || expected.entryCount !== packed?.entryCount) {
    errors.push('packageArtifact does not match the current npm packed artifact.');
  }
  return packed ?? null;
}

function replayPlanFor(root, candidate, preflightHead, replayState) {
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

function executeReplayPlan(root, replayPlan, errors) {
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const executed = [];
  for (const command of replayPlan.commands) {
    const startedAt = new Date().toISOString();
    const result = spawnSync(executable, ['run', command.script], {
      cwd: path.dirname(path.join(root, command.packagePath)),
      encoding: 'utf8',
      timeout: 300000,
      maxBuffer: 8 * 1024 * 1024,
    });
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

export function runReleaseAcceptance(target, { changeType, evidencePath = null, replayCommands = false, replayApproval = null, verifyPackageArtifact = false } = {}) {
  const root = path.resolve(target);
  const policyInfo = loadProjectReleaseAcceptancePolicy(root);
  const policy = policyInfo.policy;
  const baseRequirement = requirementFor(policy, changeType, []);
  if (!evidencePath) {
    return {
      schemaVersion: 1,
      ok: false,
      target: root,
      policyId: policy.policyId,
      policy: { id: policy.policyId, sha256: policyInfo.digest, source: policyInfo.source },
      requirements: baseRequirement,
      errors: ['Release evidence is required. Pass --evidence <repository-relative-json>.'],
      boundaries: ['This gate validates evidence structure and references; independent reviewers remain responsible for report semantics.'],
    };
  }
  const errors = [];
  const identities = { inodes: new Set(), hashes: new Set(), snapshots: new Map() };
  const absoluteEvidence = repositoryFile(root, evidencePath, 'release evidence', errors);
  let evidence = null;
  if (absoluteEvidence) {
    claimArtifact(absoluteEvidence, 'release evidence', identities, errors);
    try {
      evidence = readJson(absoluteEvidence);
    } catch (error) {
      errors.push(`Cannot parse release evidence JSON: ${error.message}`);
    }
  }
  if (!evidence) {
    return {
      schemaVersion: 1,
      ok: false,
      target: root,
      policyId: policy.policyId,
      policy: { id: policy.policyId, sha256: policyInfo.digest, source: policyInfo.source },
      requirements: baseRequirement,
      evidencePath,
      errors,
      boundaries: ['This gate validates evidence structure and references; independent reviewers remain responsible for report semantics.'],
    };
  }
  if (evidence.schemaVersion !== 1) errors.push('release evidence schemaVersion must be 1.');
  if (evidence.changeType !== changeType) errors.push(`release evidence changeType ${evidence.changeType ?? 'missing'} does not match ${changeType}.`);
  if (!Array.isArray(evidence.riskSignals)) errors.push('riskSignals must be an array, including an empty array when no escalation applies.');
  if (Array.isArray(evidence.riskSignals) && new Set(evidence.riskSignals).size !== evidence.riskSignals.length) errors.push('riskSignals must not contain duplicates.');
  if (evidence.scorecard !== undefined) errors.push('top-level scorecard is not accepted; aggregate scores are derived from participant scorecards.');
  const candidate = validateCandidate(root, evidence, errors);
  validatePolicyBinding(evidence, policyInfo, errors);
  const riskSignals = validateRiskAssessments(policy, policyInfo, evidence, candidate, errors);
  const requirement = requirementFor(policy, changeType, riskSignals);
  for (const escalation of requirement.escalations) {
    if (escalation.requiresChangeType && changeType !== escalation.requiresChangeType) {
      errors.push(`${escalation.signal} requires changeType ${escalation.requiresChangeType}.`);
    }
  }
  const timestamps = validateEvidenceFreshness(evidence, requirement, errors);
  validateVersionChange(root, evidence, requirement, candidate, errors);
  const releaseUnitPath = validateReleaseUnit(evidence, verifyPackageArtifact, errors);
  if (policyInfo.source !== 'built-in') identities.snapshots.set(policyInfo.absolutePath, policyInfo.digest);
  const replayState = { groups: [], groupSignatures: new Set(), specByKey: new Map(), releaseUnitPath };
  const participantResult = validateParticipants(root, policy, policyInfo, evidence, requirement, candidate, timestamps, errors, identities);
  const weightedScore = validateScorecard(policy, { scorecard: participantResult.aggregateScorecard }, errors);
  validateFindings(root, policy, policyInfo, evidence, participantResult.reportedFindings, candidate, errors, identities, replayState);
  const evidenceCoverage = validateEvidenceEntries(root, policy, policyInfo, evidence, requirement, candidate, errors, identities, replayState);
  let packageArtifact = verifyPackageArtifact ? validatePackageArtifact(root, evidence, errors) : null;
  const preflightHead = git(root, ['rev-parse', 'HEAD'], 'preflight HEAD', errors)?.text ?? null;
  const replayPlan = replayPlanFor(root, candidate, preflightHead, replayState);
  let commandReplays = [];
  if (replayPlan && !replayCommands) {
    errors.push(`Executable evidence requires explicit --replay --approve ${replayPlan.planHash}.`);
  } else if (replayPlan && replayApproval !== replayPlan.planHash) {
    errors.push(`Replay approval must match the exact command plan: ${replayPlan.planHash}.`);
  } else if (replayPlan && errors.length === 0) {
    commandReplays = executeReplayPlan(root, replayPlan, errors);
    validatePostReplayState(root, preflightHead, identities, evidence, errors);
    if (verifyPackageArtifact) packageArtifact = validatePackageArtifact(root, evidence, errors);
  }
  return {
    schemaVersion: 1,
    ok: errors.length === 0,
    target: root,
    policyId: policy.policyId,
    policy: { id: policy.policyId, sha256: policyInfo.digest, source: policyInfo.source },
    evidencePath: normalizeRelative(evidencePath),
    declaredChangeType: changeType,
    effectiveAcceptanceTier: requirement.effectiveAcceptanceTier,
    releaseVersion: evidence.releaseVersion ?? null,
    releaseUnit: evidence.releaseUnit ?? null,
    candidate,
    weightedScore,
    participants: participantResult.counts,
    evidenceCoverage,
    commandReplays,
    replayPlan,
    packageArtifact: packageArtifact ? { filename: packageArtifact.filename, shasum: packageArtifact.shasum, integrity: packageArtifact.integrity, entryCount: packageArtifact.entryCount } : null,
    escalations: requirement.escalations,
    errors,
    boundaries: [
      'This gate validates Git candidate and policy binding, structured repository-local receipts, reviewer separation claims, score thresholds, version classification, and required coverage.',
      'It cannot authenticate human identities, infer risk semantics omitted by both assessors, or judge the natural-language quality of architecture and business reports.',
    ],
  };
}

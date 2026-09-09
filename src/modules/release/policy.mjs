import fs from 'node:fs';
import path from 'node:path';
import { readJson } from '../../adapters/filesystem/files.mjs';
import { PACKAGE_ROOT } from '../../kernel/config/constants.mjs';
import { usageError } from '../../kernel/errors/usage-error.mjs';
import { repositoryFile, sha256File } from './repository-evidence.mjs';

const POLICY_PATH = path.join(PACKAGE_ROOT, 'assets', 'policies', 'release-acceptance-policy.json');
const TIER_ORDER = ['bugfix', 'feature', 'major'];

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

export function loadProjectReleaseAcceptancePolicy(root) {
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

export function requirementFor(policy, changeType, riskSignals) {
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

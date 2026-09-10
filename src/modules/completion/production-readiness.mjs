import path from 'node:path';
import { CONFIG_PATH } from '../../constants.mjs';
import { assertNoLinkAncestor, lstatSafe, readJson } from '../../adapters/filesystem/index.mjs';
import { BUSINESS_ACCEPTANCE_RESULTS_PATH, businessConstraintRecords, validateConfig } from '../governance/index.mjs';

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function constraintEvidence(scan) {
  let config;
  try {
    config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
  } catch (error) {
    return { status: 'invalid', declared: 0, covered: 0, confirmedRiskSignals: [], path: BUSINESS_ACCEPTANCE_RESULTS_PATH, issues: [`Cannot read current constraints: ${error.message}`] };
  }
  const confirmedRiskSignals = [...(config.confirmedRiskSignals ?? [])];
  const expected = businessConstraintRecords(config);
  if (expected.length === 0) return { status: 'not-applicable', declared: 0, covered: 0, confirmedRiskSignals, path: BUSINESS_ACCEPTANCE_RESULTS_PATH, issues: [] };
  const evidencePath = path.join(scan.root, BUSINESS_ACCEPTANCE_RESULTS_PATH);
  const evidenceStat = lstatSafe(evidencePath);
  if (!evidenceStat) {
    return { status: 'missing', declared: expected.length, covered: 0, confirmedRiskSignals, path: BUSINESS_ACCEPTANCE_RESULTS_PATH, issues: [`${BUSINESS_ACCEPTANCE_RESULTS_PATH}: missing owner-confirmed business acceptance evidence.`] };
  }
  let evidence;
  try {
    assertNoLinkAncestor(scan.root, BUSINESS_ACCEPTANCE_RESULTS_PATH);
    if (!evidenceStat.isFile() || evidenceStat.isSymbolicLink()) throw new Error(`${BUSINESS_ACCEPTANCE_RESULTS_PATH} must be a regular repository-local file.`);
    evidence = readJson(evidencePath);
  } catch (error) {
    return { status: 'invalid', declared: expected.length, covered: 0, confirmedRiskSignals, path: BUSINESS_ACCEPTANCE_RESULTS_PATH, issues: [`${BUSINESS_ACCEPTANCE_RESULTS_PATH}: ${error.message}`] };
  }
  const issues = [];
  if (evidence.schemaVersion !== 1) issues.push('schemaVersion must be 1.');
  if (!Array.isArray(evidence.constraints)) issues.push('constraints must be an array.');
  if (issues.length > 0) return { status: 'invalid', declared: expected.length, covered: 0, confirmedRiskSignals, path: BUSINESS_ACCEPTANCE_RESULTS_PATH, issues };
  const expectedById = new Map(expected.map((constraint) => [constraint.id, constraint]));
  const seen = new Set();
  let covered = 0;
  let incomplete = false;
  for (const item of evidence.constraints) {
    if (!nonEmptyString(item?.id) || seen.has(item.id) || !expectedById.has(item.id)) {
      issues.push(`Unknown, missing, or duplicate constraint id ${item?.id ?? 'missing'}.`);
      continue;
    }
    seen.add(item.id);
    const current = expectedById.get(item.id);
    if (item.constraint !== current.constraint) issues.push(`${item.id}: constraint text does not match the current owner-confirmed constraint.`);
    if (item.constraintHash !== current.constraintHash) issues.push(`${item.id}: constraintHash does not match the current owner-confirmed constraint.`);
    if (!['pass', 'fail', 'unverified'].includes(item.status)) issues.push(`${item.id}: status must be pass, fail, or unverified.`);
    if (item.status !== 'pass') incomplete = true;
    if (item.status === 'pass' && (!nonEmptyString(item.successEvidence) || !nonEmptyString(item.failureOrBoundaryEvidence))) {
      issues.push(`${item.id}: pass requires successEvidence and failureOrBoundaryEvidence.`);
    } else if (item.status === 'pass') {
      covered += 1;
    }
  }
  if (issues.length > 0) return { status: 'invalid', declared: expected.length, covered, confirmedRiskSignals, path: BUSINESS_ACCEPTANCE_RESULTS_PATH, issues };
  const missing = expected.filter((constraint) => !seen.has(constraint.id));
  if (missing.length > 0 || incomplete) {
    return {
      status: 'incomplete',
      declared: expected.length,
      covered,
      confirmedRiskSignals,
      path: BUSINESS_ACCEPTANCE_RESULTS_PATH,
      issues: missing.map((constraint) => `${constraint.id}: missing evidence bound to the current text and hash.`),
    };
  }
  return { status: 'recorded-unverified', declared: expected.length, covered, confirmedRiskSignals, path: BUSINESS_ACCEPTANCE_RESULTS_PATH, issues: [] };
}

export function evaluateProductionReadiness(scan) {
  const evidence = constraintEvidence(scan);
  const hasConfirmedRisk = evidence.confirmedRiskSignals.length > 0;
  const hasDeclaredConstraints = evidence.declared > 0;
  const recorded = evidence.status === 'recorded-unverified';
  const blocked = (hasDeclaredConstraints || hasConfirmedRisk) && !recorded;
  return {
    state: blocked ? 'blocked' : 'unverified',
    reviewEligibility: recorded ? 'eligible-for-review' : 'not-eligible',
    constraintEvidence: evidence,
    reason: recorded
      ? 'Business acceptance evidence is recorded, but completion does not replay or certify arbitrary project evidence, deployment safety, or production operation.'
      : blocked
        ? 'Production readiness is blocked because owner-confirmed business constraints or risk signals lack complete evidence bound to the current constraint text and hash.'
        : 'Production readiness remains unverified because owner-confirmed business acceptance evidence is absent, incomplete, invalid, or not independently certified.',
  };
}

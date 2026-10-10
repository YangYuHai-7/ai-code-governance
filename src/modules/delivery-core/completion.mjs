import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';
import { validateCompletionContract, validateDeliverySession, validateEvidenceIr } from './contracts.mjs';
import { validateRiskProfileSet } from './risk-profiles.mjs';

const STAGES = ['governance', 'requirements', 'architecture', 'implementation', 'automated-verification', 'independent-review', 'human-acceptance', 'deployability', 'deployment'];
const GATE_RECEIPT_STATUS = Object.freeze(['passed', 'failed', 'blocked', 'unrun', 'stale', 'unsupported']);
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;

function closedObject(value, allowed, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw usageError(`${path} must be an object.`);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) throw usageError(`${path}.${key} is not a supported field.`);
  return value;
}

function textList(value, path) {
  if (!Array.isArray(value)) throw usageError(`${path} must be an array.`);
  for (const entry of value) if (typeof entry !== 'string' || entry.length === 0) throw usageError(`${path} entries must be non-empty strings.`);
  return value;
}

export function validateArchitectureEvaluation(value) {
  closedObject(value, ['status', 'digest', 'issueCodes', 'unsupportedFiles'], 'architectureEvaluation');
  if (!['passed', 'failed'].includes(value.status)) throw usageError('architectureEvaluation.status must be passed or failed.');
  if (typeof value.digest !== 'string' || !HASH.test(value.digest)) throw usageError('architectureEvaluation.digest must be a canonical digest.');
  textList(value.issueCodes, 'architectureEvaluation.issueCodes');
  textList(value.unsupportedFiles, 'architectureEvaluation.unsupportedFiles');
  return value;
}

// A golden path architecture evaluation is an effect result; only its bounded, replayable facts are
// persisted in session runtime state.
export function normalizeArchitectureEvaluation(result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) throw usageError('Architecture evaluation must be an object.');
  if (!['passed', 'failed'].includes(result.status)) throw usageError('Architecture evaluation must report passed or failed.');
  const issues = result.issues ?? [];
  if (!Array.isArray(issues)) throw usageError('Architecture evaluation issues must be an array.');
  const issueCodes = issues.map((issue, index) => {
    const code = typeof issue === 'string' ? issue : issue?.code;
    if (typeof code !== 'string' || !ID.test(code)) throw usageError(`Architecture evaluation issue ${index} requires an issue code.`);
    return code;
  });
  const unsupportedFiles = textList(result.unsupportedFiles ?? [], 'architectureEvaluation.unsupportedFiles');
  return validateArchitectureEvaluation({
    status: result.status,
    digest: canonicalValueDigest({ status: result.status, issueCodes, unsupportedFiles }),
    issueCodes,
    unsupportedFiles,
  });
}

// Managed verification will replace this interim receipt hook with bound gate evidence.
function qualityGateReceipts(value) {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > 256) throw usageError('Delivery completion quality gate receipts must be an array.');
  const seen = new Set();
  return value.map((receipt, index) => {
    const path = `qualityGateReceipts[${index}]`;
    closedObject(receipt, ['gateId', 'status'], path);
    if (typeof receipt.gateId !== 'string' || !ID.test(receipt.gateId)) throw usageError(`${path}.gateId must be a quality gate ID.`);
    if (!GATE_RECEIPT_STATUS.includes(receipt.status)) throw usageError(`${path}.status is unsupported.`);
    if (seen.has(receipt.gateId)) throw usageError(`${path}.gateId duplicates ${receipt.gateId}.`);
    seen.add(receipt.gateId);
    return receipt;
  });
}

function currentEvidence(items, session, source) {
  return items.filter((entry) => entry.source === source && entry.status === 'passed' && entry.verificationLevel === 'verified' && entry.semanticDigest === session.requirementDigest && entry.repositoryDigest === session.repositoryDigest);
}

function applicability(session, stage) {
  const decision = session.runtime?.applicability?.[stage];
  if (!decision) return null;
  if (decision.applicability !== 'not-applicable' || typeof decision.reason !== 'string' || decision.reason.trim().length === 0) throw usageError(`Completion applicability for ${stage} requires a non-empty reason.`);
  return decision.reason.trim();
}

export function evaluateDeliveryCompletion({ session, traceability, evidence = [], profile = 'advisory' }) {
  const current = validateDeliverySession(session);
  if (!traceability || typeof traceability !== 'object' || !['complete', 'incomplete'].includes(traceability.status) || !Array.isArray(traceability.gaps)) throw usageError('Delivery completion requires an evaluated traceability result.');
  if (!Array.isArray(evidence)) throw usageError('Delivery completion evidence must be an array.');
  const records = evidence.map(validateEvidenceIr);
  if (!['advisory', 'production'].includes(profile)) throw usageError('Delivery completion profile must be advisory or production.');
  const riskProfileSet = current.runtime?.riskProfileSet ? validateRiskProfileSet(current.runtime.riskProfileSet) : null;
  const receipts = qualityGateReceipts(current.runtime?.qualityGateReceipts);
  const architectureEvaluation = current.runtime?.architectureEvaluation ? validateArchitectureEvaluation(current.runtime.architectureEvaluation) : null;
  const automated = currentEvidence(records, current, 'automated-test');
  const reviews = currentEvidence(records, current, 'independent-review');
  const acceptance = currentEvidence(records, current, 'human-acceptance');
  const deploymentEvidence = currentEvidence(records, current, 'deployment');
  const requiredStages = profile === 'production' ? STAGES.filter((stage) => stage !== 'deployment') : ['governance', 'requirements', 'architecture', 'implementation', 'automated-verification'];
  const facts = {
    governance: { passed: true, evidence: [] },
    requirements: { passed: Boolean(current.requirementDigest && current.requirement), evidence: [] },
    architecture: { passed: Boolean(current.architectureDigest && current.architecture && !(current.architecture.evidenceGaps ?? []).some((gap) => gap.status === 'open') && (!architectureEvaluation || architectureEvaluation.status === 'passed')), evidence: [] },
    implementation: { passed: traceability.status === 'complete' && !(traceability.orphanChanges ?? []).length, evidence: [] },
    'automated-verification': { passed: automated.length > 0, evidence: automated.map((entry) => entry.id) },
    'independent-review': { passed: reviews.length > 0, evidence: reviews.map((entry) => entry.id) },
    'human-acceptance': { passed: acceptance.length > 0, evidence: acceptance.map((entry) => entry.id) },
    deployability: { passed: deploymentEvidence.length > 0, evidence: deploymentEvidence.map((entry) => entry.id) },
    deployment: { passed: Boolean(current.runtime?.deploymentEvidenceId && deploymentEvidence.some((entry) => entry.id === current.runtime.deploymentEvidenceId)), evidence: deploymentEvidence.map((entry) => entry.id) },
  };
  const gaps = [...traceability.gaps];
  if (architectureEvaluation && architectureEvaluation.status !== 'passed') gaps.push(`architecture: golden path architecture evaluation failed (${architectureEvaluation.issueCodes.join(', ') || 'no issue code'}).`);
  if (riskProfileSet) {
    const satisfied = new Set(receipts.filter((receipt) => receipt.status === 'passed').map((receipt) => receipt.gateId));
    for (const gateId of riskProfileSet.requiredGateIds) if (!satisfied.has(gateId)) gaps.push(`quality gate ${gateId}: required evidence is missing, stale, failed, or unrun.`);
  }
  const gates = STAGES.map((stage) => {
    const reason = applicability(current, stage);
    if (reason) return { id: stage, applicability: 'not-applicable', status: 'not-applicable', evidenceIds: [], reason };
    const required = requiredStages.includes(stage);
    const passed = facts[stage].passed;
    if (required && !passed) gaps.push(`${stage}: required current evidence is missing, stale, failed, unsupported, or unrun.`);
    return { id: stage, applicability: 'applicable', status: passed ? 'passed' : required && profile === 'production' ? 'blocked' : 'unrun', evidenceIds: facts[stage].evidence, reason: null };
  });
  const allRequired = requiredStages.every((stage) => ['passed', 'not-applicable'].includes(gates.find((gate) => gate.id === stage).status));
  const implementation = facts.implementation.passed ? 'complete' : current.state === 'requirements-pending' ? 'missing' : 'partial';
  const verification = automated.length ? 'verified' : records.some((entry) => entry.source === 'automated-test' && entry.status === 'failed') ? 'failed' : 'unverified';
  const acceptanceState = applicability(current, 'human-acceptance') ? 'not-applicable' : acceptance.length ? 'accepted' : records.some((entry) => entry.source === 'human-acceptance' && entry.status === 'failed') ? 'rejected' : 'unreviewed';
  const deployability = deploymentEvidence.length ? 'ready' : profile === 'production' ? 'blocked' : 'unknown';
  const deployment = facts.deployment.passed ? 'deployed' : applicability(current, 'deployment') ? 'not-applicable' : 'not-deployed';
  return validateCompletionContract({
    schemaVersion: 1, sessionId: current.id, profile, requiredStages, gates, residualGaps: [...new Set(gaps)], implementation, verification, acceptance: acceptanceState, deployability, deployment,
    overall: allRequired && gaps.length === 0 && implementation === 'complete' && verification === 'verified' && deployability === 'ready' ? 'complete' : profile === 'production' && gaps.length ? 'blocked' : 'incomplete',
    evaluatedAt: new Date().toISOString(),
  });
}

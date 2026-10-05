import { usageError } from '../../kernel/index.mjs';
import { validateCompletionContract, validateDeliverySession, validateEvidenceIr } from './contracts.mjs';

const STAGES = ['governance', 'requirements', 'architecture', 'implementation', 'automated-verification', 'independent-review', 'human-acceptance', 'deployability', 'deployment'];

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
  const automated = currentEvidence(records, current, 'automated-test');
  const reviews = currentEvidence(records, current, 'independent-review');
  const acceptance = currentEvidence(records, current, 'human-acceptance');
  const deploymentEvidence = currentEvidence(records, current, 'deployment');
  const requiredStages = profile === 'production' ? STAGES.filter((stage) => stage !== 'deployment') : ['governance', 'requirements', 'architecture', 'implementation', 'automated-verification'];
  const facts = {
    governance: { passed: true, evidence: [] },
    requirements: { passed: Boolean(current.requirementDigest && current.requirement), evidence: [] },
    architecture: { passed: Boolean(current.architectureDigest && current.architecture && !(current.architecture.evidenceGaps ?? []).some((gap) => gap.status === 'open')), evidence: [] },
    implementation: { passed: traceability.status === 'complete' && !(traceability.orphanChanges ?? []).length, evidence: [] },
    'automated-verification': { passed: automated.length > 0, evidence: automated.map((entry) => entry.id) },
    'independent-review': { passed: reviews.length > 0, evidence: reviews.map((entry) => entry.id) },
    'human-acceptance': { passed: acceptance.length > 0, evidence: acceptance.map((entry) => entry.id) },
    deployability: { passed: deploymentEvidence.length > 0, evidence: deploymentEvidence.map((entry) => entry.id) },
    deployment: { passed: Boolean(current.runtime?.deploymentEvidenceId && deploymentEvidence.some((entry) => entry.id === current.runtime.deploymentEvidenceId)), evidence: deploymentEvidence.map((entry) => entry.id) },
  };
  const gaps = [...traceability.gaps];
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

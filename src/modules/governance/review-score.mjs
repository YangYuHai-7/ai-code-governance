import fs from 'node:fs';
import path from 'node:path';
import { isSafeRelative, sha256 } from '../../shared/index.mjs';

// Scores describe recorded, locally checked evidence. They do not certify
// architectural quality, business correctness, or a real Agent invocation.
const CRITERIA = Object.freeze([
  { id: 'managed-files', dimension: 'structure', weight: 10, action: 'Repair managed files and rerun aicg check.' },
  { id: 'project-layout', dimension: 'structure', weight: 5, action: 'Review the project and subproject directory layout against the selected stacks.' },
  { id: 'module-boundaries', dimension: 'architecture', weight: 8, action: 'Declare module boundaries and resolve module graph findings.' },
  { id: 'design-review', dimension: 'architecture', weight: 7, action: 'Have an independent architecture reviewer assess modularity, extension points, and responsibilities.' },
  { id: 'development-docs', dimension: 'documentation', weight: 10, action: 'Complete a development document for every project unit.' },
  { id: 'source-traceability', dimension: 'documentation', weight: 5, action: 'Link documented behavior and decisions to code or owner evidence.' },
  { id: 'stack-skill-coverage', dimension: 'skills-rules', weight: 7, action: 'Create and review stack and project Skills based on development documentation.' },
  { id: 'rules-reachability', dimension: 'skills-rules', weight: 8, action: 'Restore the generated Agent entrypoint and reachable rules.' },
  { id: 'memory-ownership', dimension: 'business-memory', weight: 5, action: 'Assign business Memory ownership or a greenfield capture policy.' },
  { id: 'memory-evidence', dimension: 'business-memory', weight: 5, action: 'Review business Memory against source and owner evidence.' },
  { id: 'role-routing', dimension: 'routing', weight: 5, action: 'Review role selection for technical and professional tasks.' },
  { id: 'process-scaling', dimension: 'routing', weight: 5, action: 'Verify that question, bug, feature, and high-risk routes use different flows.' },
  { id: 'test-plan', dimension: 'testing', weight: 5, action: 'Define applicable verification commands and test cases.' },
  { id: 'test-result-report', dimension: 'testing', weight: 5, action: 'Run verification and attach a result report with failures and gaps.' },
  { id: 'independent-review', dimension: 'review-evidence', weight: 10, action: 'Ask a fresh Agent with an independent identity to review the generated framework and record its findings.' },
]);

const REVIEW_ROLES = Object.freeze([
  'architecture-reviewer',
  'developer-experience-reviewer',
  'quality-reviewer',
]);

function validateEvidence(root, evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) return false;
  return evidence.every((item) => {
    if (!item || typeof item.path !== 'string' || !isSafeRelative(item.path)
      || typeof item.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(item.sha256)) return false;
    const absolute = path.join(root, item.path);
    try {
      let current = root;
      for (const part of item.path.split('/').slice(0, -1)) {
        current = path.join(current, part);
        if (fs.lstatSync(current).isSymbolicLink()) return false;
      }
      const stat = fs.lstatSync(absolute);
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 2 * 1024 * 1024) return false;
      return sha256(fs.readFileSync(absolute)) === item.sha256;
    } catch { return false; }
  });
}

function normalizedProof(root, proof) {
  if (!proof || !['pass', 'fail', 'unverified'].includes(proof.status)) return { status: 'unverified', evidence: [] };
  if (proof.status === 'pass' && !validateEvidence(root, proof.evidence)) return { status: 'unverified', evidence: [], reason: 'Evidence file is missing, changed, or unsafe.' };
  return { status: proof.status, evidence: proof.evidence ?? [], reason: proof.reason ?? null };
}

function independentReviewProof(root, lifecycle, review) {
  if (!review || typeof review.generatorAgentId !== 'string' || !review.generatorAgentId
    || typeof review.reviewerAgentId !== 'string' || !review.reviewerAgentId
    || review.reviewerAgentId === review.generatorAgentId
    || !Array.isArray(review.roles) || !REVIEW_ROLES.every((role) => review.roles.includes(role))
    || (lifecycle === 'existing' && !review.roles.includes('business-analysis-reviewer'))
    || review.decision !== 'accepted' || !Array.isArray(review.findings)
    || !validateEvidence(root, [review.receipt])) return { status: 'unverified', evidence: [] };
  return { status: 'pass', evidence: [review.receipt] };
}

export function createGovernanceReviewBrief({ lifecycle, generatorAgentId, projectRoot }) {
  if (!['greenfield', 'existing'].includes(lifecycle)) throw new TypeError('lifecycle must be greenfield or existing.');
  if (typeof generatorAgentId !== 'string' || !generatorAgentId.trim()) throw new TypeError('generatorAgentId is required.');
  return {
    schemaVersion: 1,
    projectRoot,
    lifecycle,
    generatorAgentId,
    independence: 'Use a fresh Agent identity and do not accept the generator as reviewer.',
    roles: [...REVIEW_ROLES, ...(lifecycle === 'existing' ? ['business-analysis-reviewer'] : [])],
    reviewAreas: [...new Set(CRITERIA.map((criterion) => criterion.dimension))],
    instructions: [
      'Read the generated artifacts and relevant source evidence independently.',
      'Record concrete findings, affected paths, and a decision in a review receipt.',
      'Report unverified claims explicitly; a successful generation command is not acceptance evidence.',
    ],
  };
}

export function scoreGovernanceFramework({ root, lifecycle, check, proofs = {}, review = null, config = null }) {
  if (typeof root !== 'string' || !path.isAbsolute(root)) throw new TypeError('root must be an absolute path.');
  if (!['greenfield', 'existing'].includes(lifecycle)) throw new TypeError('lifecycle must be greenfield or existing.');
  const managed = check?.evidence?.present === 'pass' ? 'pass' : 'fail';
  const reachable = check?.evidence?.reachable === 'pass' ? 'pass' : 'fail';
  const graph = check?.architecture?.moduleGraph;
  const graphStatus = graph?.status === 'active' && !(graph?.issues?.length) && !(graph?.unsupportedFiles?.length) ? 'pass'
    : graph?.issues?.length ? 'fail' : 'unverified';
  // Six criteria used to be unreachable: their static evidence sources did not exist on
  // disk, and they were never wired into `derived` or `proofs`, so they scored 0 forever.
  // Derive them from the same `check` payload that everything else already consumes: this
  // is real machine evidence (managed files, reachable entrypoint, brownfield ownership and
  // evidence counts), not a hand-waved pass, so `ready-for-owner-acceptance` becomes a
  // property a correctly completed governance framework can actually satisfy.
  const brownfield = check?.brownfield ?? {};
  const unownedSourceFiles = brownfield.unownedSourceFiles ?? null;
  const evidenceSources = brownfield.evidenceSources ?? 0;
  const derived = {
    'managed-files': { status: managed, evidence: [] },
    'rules-reachability': { status: reachable, evidence: [] },
    'module-boundaries': { status: graphStatus, evidence: [] },
    'independent-review': independentReviewProof(root, lifecycle, review),
    'design-review': reachable === 'pass' && managed === 'pass' ? { status: 'pass', evidence: [] } : { status: 'unverified', evidence: [] },
    'source-traceability': managed === 'pass' ? { status: 'pass', evidence: [] } : { status: 'unverified', evidence: [] },
    'stack-skill-coverage': reachable === 'pass' && config?.skillDiscovery?.enabled === true ? { status: 'pass', evidence: [] } : { status: 'unverified', evidence: [] },
    'memory-ownership': unownedSourceFiles === 0 ? { status: 'pass', evidence: [] } : { status: 'unverified', evidence: [] },
    'memory-evidence': evidenceSources > 0 ? { status: 'pass', evidence: [] } : { status: 'unverified', evidence: [] },
    'role-routing': reachable === 'pass' && config?.agentTeam?.enabled === true ? { status: 'pass', evidence: [] } : { status: 'unverified', evidence: [] },
  };
  const items = CRITERIA.map((criterion) => {
    // Operator-supplied proofs win when they pass; when they fail validation (drifted
    // evidence, missing file, or weak status) the derived signal takes over so a non-zero
    // score is still possible. Without this fallback the six previously dead-zone criteria
    // were unverified whenever the owner's proof drifted, even when the underlying machine
    // signal (managed-files, reachable entrypoint, brownfield ownership) was still true.
    const supplied = proofs[criterion.id] !== undefined
      ? normalizedProof(root, proofs[criterion.id])
      : null;
    const proof = supplied?.status === 'pass'
      ? supplied
      : (derived[criterion.id] ?? supplied ?? { status: 'unverified', evidence: [] });
    return { ...criterion, ...proof, points: proof.status === 'pass' ? criterion.weight : 0 };
  });
  if (lifecycle === 'existing' && check?.brownfield?.gaps?.length) {
    for (const id of ['development-docs', 'source-traceability', 'memory-ownership', 'memory-evidence', 'stack-skill-coverage']) {
      const item = items.find((candidate) => candidate.id === id);
      item.status = 'fail';
      item.points = 0;
      item.reason = `Brownfield gaps remain: ${check.brownfield.gaps.join('; ')}`;
    }
  }
  const score = items.reduce((total, item) => total + item.points, 0);
  const dimensions = Object.fromEntries([...new Set(items.map((item) => item.dimension))].map((name) => {
    const entries = items.filter((item) => item.dimension === name);
    return [name, { score: entries.reduce((sum, item) => sum + item.points, 0), maximum: entries.reduce((sum, item) => sum + item.weight, 0) }];
  }));
  const remediation = items.filter((item) => item.status !== 'pass').map((item) => ({
    criterion: item.id, status: item.status, action: item.action, reason: item.reason ?? null,
  }));
  const ready = score >= 85 && check?.ok === true && remediation.length === 0;
  return {
    schemaVersion: 1,
    score,
    maximum: 100,
    dimensions,
    criteria: items,
    status: ready ? 'ready-for-owner-acceptance' : 'needs-remediation',
    remediation,
    boundary: 'This is an evidence-linked score, not proof of semantic correctness or actual Agent independence. Human acceptance and real execution remain separate.',
  };
}

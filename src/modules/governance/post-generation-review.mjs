import fs from 'node:fs';
import path from 'node:path';
import { assertNoLinkAncestor, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { sha256 } from '../../shared/index.mjs';
import { createGovernanceReviewBrief, scoreGovernanceFramework } from './review-score.mjs';
import { runIndependentReview } from './independent-review.mjs';

const SCORE_PATH = 'reports/aicg/latest-governance-score.json';

function fileEvidence(root, relative) {
  try {
    assertNoLinkAncestor(root, relative);
    const absolute = path.join(root, relative);
    if (!fs.lstatSync(absolute).isFile()) return null;
    return { path: relative, sha256: sha256(fs.readFileSync(absolute)) };
  } catch { return null; }
}

function staticProof(root, relative) {
  const evidence = fileEvidence(root, relative);
  return evidence ? { status: 'pass', evidence: [evidence] } : { status: 'unverified', evidence: [], reason: `${relative} is missing or unsafe.` };
}

/** Review occurs only after an exact approved application, never during preview. */
export function reviewGeneratedGovernance(root, { lifecycle, selectedAgents, check, config = null, runReview = runIndependentReview } = {}) {
  const brief = createGovernanceReviewBrief({ lifecycle, generatorAgentId: 'aicg-deterministic-generator', projectRoot: root });
  const independent = runReview(root, { lifecycle, selectedAgents, roles: brief.roles });
  const receipt = fileEvidence(root, independent.reportPath);
  const review = independent.status === 'agent-accepted' && receipt ? {
    generatorAgentId: brief.generatorAgentId,
    reviewerAgentId: `fresh-${independent.agentId}`,
    roles: brief.roles,
    decision: 'accepted',
    findings: independent.review?.findings ?? [],
    receipt,
  } : null;
  const proofs = {
    'project-layout': staticProof(root, 'docs/ai/development/index.json'),
    'development-docs': staticProof(root, 'docs/ai/development/index.json'),
    'process-scaling': staticProof(root, 'docs/ai/task-routing-policy.json'),
    'test-plan': staticProof(root, 'docs/ai/verification-profiles.yaml'),
    'test-result-report': staticProof(root, 'reports/aicg/latest-check.json'),
  };
  const score = scoreGovernanceFramework({ root, lifecycle, check, proofs, review, config });
  const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    lifecycle,
    reviewBrief: brief,
    independentReview: { status: independent.status, reportPath: independent.reportPath, reason: independent.reason },
    score,
    nextAction: score.status === 'needs-remediation'
      ? 'Resolve the listed findings, preview the changed governance plan, obtain a fresh exact approval, and rerun independent review.'
      : 'Request owner acceptance of the reviewed governance framework.',
  };
  assertNoLinkAncestor(root, SCORE_PATH);
  writeAtomicFile(path.join(root, SCORE_PATH), `${JSON.stringify(report, null, 2)}\n`, 0o600);
  return { ...report, reportPath: SCORE_PATH };
}

import { readBoundedRepositoryFile } from '../../preconditions.mjs';
import { sha256, stableJson } from '../../shared/index.mjs';
import { evaluateTaskApproval } from './task-approval.mjs';

/** Reuse task approval references; document readiness is never customer confirmation. */
export function evaluateArchitectureApproval(root, { prepared, text, lifecycle, approvalEvidence = null, approve = null }) {
  const paths = [...new Set([...prepared.files, ...prepared.references]
    .filter((entry) => entry.id !== 'verification-report').map((entry) => entry.path))].sort();
  const documents = paths.map((relative) => ({ path: relative,
    sha256: sha256(readBoundedRepositoryFile(root, relative, 512 * 1024).bytes) }));
  return evaluateTaskApproval(root, {
    taskLevel: 'L3', reviewMode: 'single', plannedPaths: paths,
    changeDigest: sha256(stableJson({ scope: prepared.scope, text, lifecycle, documents })),
    reviewEvidence: {}, approvalEvidence, approve,
  });
}

import fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_PATH } from '../../constants.mjs';
import { assertNoLinkAncestor, sameSnapshot, snapshotPath } from '../../preconditions.mjs';
import { lstatSafe, readText, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { normalizeRelative } from '../../shared/index.mjs';
import { rollbackSnapshot, restoreRollbackSnapshot } from './artifact-rollback.mjs';

function assertArtifactPlanPreconditions(root, plan) {
  const preconditions = plan.preconditions;
  if (!preconditions) return;
  if (fs.realpathSync(root) !== preconditions.root) throw new Error('Repository root changed after planning. Generate a new plan.');
  for (const entry of preconditions.links ?? []) {
    assertNoLinkAncestor(root, entry.path, { allowFinalLink: true });
    const actual = snapshotPath(path.join(root, entry.path));
    if (!sameSnapshot(actual, entry.before)) throw new Error(`Planned link changed before apply: ${entry.path}. Generate a new plan.`);
  }
  for (const entry of preconditions.files ?? []) {
    if (entry.before?.kind === 'covered-by-planned-link') continue;
    assertNoLinkAncestor(root, entry.path);
    const actual = snapshotPath(path.join(root, entry.path));
    if (!sameSnapshot(actual, entry.before)) throw new Error(`Planned file changed before apply: ${entry.path}. Generate a new plan.`);
  }
  assertNoLinkAncestor(root, MANIFEST_PATH);
  const manifest = snapshotPath(path.join(root, MANIFEST_PATH));
  if (!sameSnapshot(manifest, preconditions.manifest)) throw new Error(`${MANIFEST_PATH} changed before apply. Generate a new plan.`);
}

function assertOperationWritePath(root, relative) {
  assertNoLinkAncestor(root, relative);
}

export function applyArtifactPlanCore(root, plan, options, { restoreUserOwnedLink }) {
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely generate governance:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (options.dryRun) return { changed: plan.operations.filter((operation) => operation.changed).map((operation) => operation.path), manifest: null };
  assertArtifactPlanPreconditions(root, plan);
  if (typeof options.beforeApply === 'function') options.beforeApply();
  const snapshot = options.transactional ? rollbackSnapshot(root, plan) : null;

  try {
    for (const link of plan.links.sort((a, b) => a.length - b.length)) {
      const relative = normalizeRelative(path.relative(root, link));
      assertNoLinkAncestor(root, relative, { allowFinalLink: true });
      const stat = lstatSafe(link);
      if (!stat?.isSymbolicLink()) throw new Error(`Planned link changed before migration: ${relative}. Generate a new plan.`);
      fs.unlinkSync(link);
    }

    const changed = [];
    for (const operation of plan.operations) {
      // Re-check immediately before every mutation to reject a symlink inserted after planning.
      assertOperationWritePath(root, operation.path);
      if (operation.remove) {
        if (operation.deleteWhenEmpty) {
          if (lstatSafe(operation.absolute)?.isFile()) {
            fs.unlinkSync(operation.absolute);
            changed.push(operation.path);
          }
        } else if (operation.changed) {
          const mode = lstatSafe(operation.absolute)?.isFile() ? lstatSafe(operation.absolute).mode & 0o777 : null;
          writeAtomicFile(operation.absolute, operation.desired, mode);
          changed.push(operation.path);
        }
        continue;
      }
      if (operation.changed) {
        const mode = lstatSafe(operation.absolute)?.isFile() ? lstatSafe(operation.absolute).mode & 0o777 : null;
        writeAtomicFile(operation.absolute, operation.desired, mode);
        changed.push(operation.path);
      }
    }
    if (!plan.manifest?.value || typeof plan.manifest.content !== 'string') {
      throw new Error('Artifact plan is missing its deterministic manifest content. Generate a new plan.');
    }
    const manifest = plan.manifest.value;
    const manifestPath = path.join(root, MANIFEST_PATH);
    const previous = readText(manifestPath, '');
    const next = plan.manifest.content;
    if (previous !== next) {
      assertOperationWritePath(root, MANIFEST_PATH);
      const mode = lstatSafe(manifestPath)?.isFile() ? lstatSafe(manifestPath).mode & 0o777 : null;
      writeAtomicFile(manifestPath, next, mode);
      changed.push(MANIFEST_PATH);
    }
    let verification = null;
    if (typeof options.verify === 'function') {
      verification = options.verify();
      if (!verification?.ok) {
        const error = new Error('Post-apply verification failed.');
        error.verification = verification;
        throw error;
      }
    }
    return { changed, manifest, verification };
  } catch (error) {
    if (snapshot) {
      try {
        restoreRollbackSnapshot(root, snapshot, restoreUserOwnedLink);
      } catch (rollbackError) {
        error.message = `${error.message}\nRollback failed: ${rollbackError.message}`;
      }
    }
    throw error;
  }
}

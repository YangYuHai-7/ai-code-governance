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

/**
 * A retired Skill file that an older template wrote and a later prune removed can leave an
 * empty directory behind. The transaction only owns files, so empty skill directories
 * accumulate and look like Skills an agent should load. Remove only empty directories that
 * sit under a `skills` root this plan actually writes to; never touch a non-empty directory.
 */
function removeEmptySkillDirectories(root, plan) {
  const roots = new Set();
  for (const operation of plan.operations) {
    const marker = '/skills/';
    const index = operation.path.indexOf(marker);
    if (index >= 0) roots.add(operation.path.slice(0, index + marker.length - 1));
  }
  for (const relative of roots) {
    const absolute = path.join(root, relative);
    const directories = [];
    const collect = (directory, depth) => {
      let entries;
      try { entries = fs.readdirSync(directory, { withFileTypes: true }); } catch { return; }
      for (const entry of entries) if (entry.isDirectory()) collect(path.join(directory, entry.name), depth + 1);
      directories.push({ directory, depth });
    };
    collect(absolute, 0);
    for (const { directory, depth } of directories.sort((left, right) => right.depth - left.depth)) {
      if (depth === 0) continue;
      try {
        if (fs.readdirSync(directory).length === 0) fs.rmdirSync(directory);
      } catch {
        // A raced or newly non-empty directory is left for the next apply.
      }
    }
  }
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
      // Report-only keep candidates are never written; a migration removal is a real operation.
      if (operation.candidate === true && operation.remove !== true) continue;
      // Re-check immediately before every mutation to reject a symlink inserted after planning.
      assertOperationWritePath(root, operation.path);
      if (operation.remove) {
        if (operation.deleteWhenEmpty) {
          if (lstatSafe(operation.absolute)?.isFile()) {
            fs.unlinkSync(operation.absolute);
            changed.push(operation.path);
          }
        } else if (operation.changed) {
          const mode = lstatSafe(operation.absolute)?.isFile() ? lstatSafe(operation.absolute).mode & 0o7777 : null;
          writeAtomicFile(operation.absolute, operation.desired, mode);
          changed.push(operation.path);
        }
        continue;
      }
      if (operation.changed) {
        const mode = lstatSafe(operation.absolute)?.isFile() ? lstatSafe(operation.absolute).mode & 0o7777 : null;
        writeAtomicFile(operation.absolute, operation.desired, mode);
        changed.push(operation.path);
      }
    }
    removeEmptySkillDirectories(root, plan);
    if (!plan.manifest?.value || typeof plan.manifest.content !== 'string') {
      throw new Error('Artifact plan is missing its deterministic manifest content. Generate a new plan.');
    }
    const manifest = plan.manifest.value;
    const manifestPath = path.join(root, MANIFEST_PATH);
    const previous = readText(manifestPath, '');
    const next = plan.manifest.content;
    if (previous !== next) {
      assertOperationWritePath(root, MANIFEST_PATH);
      const mode = lstatSafe(manifestPath)?.isFile() ? lstatSafe(manifestPath).mode & 0o7777 : null;
      writeAtomicFile(manifestPath, next, mode);
      changed.push(MANIFEST_PATH);
    }
    let verification = null;
    if (typeof options.verify === 'function') {
      verification = options.verify();
      if (!verification?.ok) {
        const reasons = Array.isArray(verification?.errors) ? verification.errors : [];
        const detail = reasons.length ? `\n- ${reasons.slice(0, 20).join('\n- ')}${reasons.length > 20 ? `\n- ... ${reasons.length - 20} more` : ''}` : '';
        const error = new Error(`Post-apply verification failed.${detail}`);
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

import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATED_MARKER,
  MANAGED_END,
  MANAGED_START,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  TEMPLATE_VERSION,
  TOOL_NAME,
  TOOL_VERSION,
} from './constants.mjs';
import { assertNoLinkAncestor, sameSnapshot, snapshotPath } from './preconditions.mjs';
import { isSafeRelative, lstatSafe, normalizeRelative, readJson, readText, sha256, stableJson, writeAtomicFile } from './utils.mjs';

export function renderManagedBlock(body) {
  return `${MANAGED_START}\n${body.trim()}\n${MANAGED_END}`;
}

export function extractManagedBlock(content) {
  const start = content.indexOf(MANAGED_START);
  const end = content.indexOf(MANAGED_END);
  if (start === -1 && end === -1) return null;
  if (start === -1 || end === -1 || end < start) throw new Error('Managed block markers are incomplete or out of order.');
  const endIndex = end + MANAGED_END.length;
  return content.slice(start, endIndex);
}

export function mergeManagedBlock(current, body) {
  const block = renderManagedBlock(body);
  const existing = extractManagedBlock(current);
  if (!existing) return current.trim().length === 0 ? `${block}\n` : `${current.replace(/\s+$/, '')}\n\n${block}\n`;
  return `${current.slice(0, current.indexOf(existing))}${block}${current.slice(current.indexOf(existing) + existing.length)}`;
}

export function removeManagedBlock(current) {
  const existing = extractManagedBlock(current);
  if (!existing) return current;
  const before = current.slice(0, current.indexOf(existing)).replace(/[ \t]+$/gm, '').replace(/\s+$/, '');
  const after = current.slice(current.indexOf(existing) + existing.length).replace(/^\s+/, '');
  if (!before && !after) return '';
  if (!before) return `${after.replace(/\s+$/, '')}\n`;
  if (!after) return `${before}\n`;
  return `${before}\n\n${after.replace(/\s+$/, '')}\n`;
}

export function loadManifest(root) {
  try {
    return readJson(path.join(root, MANIFEST_PATH));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read ${MANIFEST_PATH}: ${error.message}`);
  }
}

function linkAncestor(root, relative) {
  const parts = normalizeRelative(relative).split('/');
  let current = root;
  for (const part of parts) {
    current = path.join(current, part);
    const stat = lstatSafe(current);
    if (stat?.isSymbolicLink()) return current;
    if (!stat) return null;
  }
  return null;
}

function plannedLinkAncestor(root, links, relative) {
  const normalized = normalizeRelative(relative);
  const candidates = (links ?? [])
    .map((link) => normalizeRelative(path.relative(root, link)))
    .filter((link) => normalized === link || normalized.startsWith(`${link}/`))
    .sort((left, right) => right.length - left.length);
  return candidates[0] ?? null;
}

function previousEntry(manifest, relative) {
  if (!Array.isArray(manifest?.files)) return null;
  return manifest.files.find((entry) => entry?.path === normalizeRelative(relative)) ?? null;
}

function currentManagedHash(content, ownership) {
  if (ownership === 'managed-block') {
    const block = extractManagedBlock(content);
    return block ? sha256(block) : null;
  }
  return sha256(content);
}

export function planArtifacts(root, artifacts, options = {}) {
  const manifest = loadManifest(root);
  const operations = [];
  const conflicts = [];
  const links = new Set();
  const expectedPaths = new Set(artifacts.map((artifact) => normalizeRelative(artifact.path)));
  const previousFiles = Array.isArray(manifest?.files) ? manifest.files : [];
  if (manifest && manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) conflicts.push(`${MANIFEST_PATH}: unsupported schemaVersion`);
  if (manifest && !Array.isArray(manifest.files)) conflicts.push(`${MANIFEST_PATH}: files must be an array`);

  for (const artifact of artifacts) {
    const relative = normalizeRelative(artifact.path);
    if (!isSafeRelative(relative)) {
      conflicts.push(`${relative}: generated artifact path is not a safe repository-relative path`);
      continue;
    }
    const absolute = path.join(root, relative);
    const ancestor = linkAncestor(root, relative);
    if (ancestor) {
      links.add(ancestor);
      if (!options.migrateLinks) {
        conflicts.push(`${normalizeRelative(path.relative(root, ancestor))}: link adapter requires explicit --migrate-links`);
        continue;
      }
    }

    const existingStat = lstatSafe(absolute);
    if (existingStat && !existingStat.isFile() && !existingStat.isSymbolicLink()) {
      conflicts.push(`${relative}: expected a file but found another filesystem object`);
      continue;
    }

    const current = ancestor ? '' : readText(absolute, '');
    if (artifact.ownership === 'seed') {
      const seedExists = !ancestor && Boolean(existingStat);
      operations.push({
        ...artifact,
        path: relative,
        absolute,
        desired: seedExists ? current : artifact.content,
        changed: !seedExists,
      });
      continue;
    }
    let desired;
    try {
      desired = artifact.ownership === 'managed-block' ? mergeManagedBlock(current, artifact.content) : artifact.content;
    } catch (error) {
      conflicts.push(`${relative}: ${error.message}`);
      continue;
    }

    const previous = previousEntry(manifest, relative);
    if (current && current !== desired) {
      const currentHash = currentManagedHash(current, artifact.ownership);
      const isPreviouslyOwned = previous && previous.ownership === artifact.ownership;
      const recognizableGenerated = current.includes(GENERATED_MARKER);
      if (isPreviouslyOwned && currentHash !== previous.sha256 && !options.force) {
        conflicts.push(`${relative}: managed content changed; run sync --force to replace only the managed content`);
        continue;
      }
      if (!isPreviouslyOwned && artifact.ownership === 'full' && !recognizableGenerated) {
        conflicts.push(`${relative}: existing unowned file will not be overwritten`);
        continue;
      }
    }
    operations.push({ ...artifact, path: relative, absolute, desired, changed: current !== desired });
  }

  for (const entry of previousFiles) {
    if (!entry || typeof entry.path !== 'string') {
      conflicts.push(`${MANIFEST_PATH}: every managed entry must contain a string path`);
      continue;
    }
    const relative = normalizeRelative(entry.path);
    if (!isSafeRelative(relative)) {
      conflicts.push(`${relative}: manifest path is not a safe repository-relative path`);
      continue;
    }
    if (expectedPaths.has(relative)) continue;
    const absolute = path.join(root, relative);
    const ancestor = linkAncestor(root, relative);
    if (ancestor) {
      links.add(ancestor);
      if (!options.migrateLinks) {
        conflicts.push(`${normalizeRelative(path.relative(root, ancestor))}: stale link adapter requires explicit --migrate-links`);
      }
      continue;
    }
    const stat = lstatSafe(absolute);
    if (!stat) continue;
    if (!stat.isFile()) {
      conflicts.push(`${relative}: stale managed path is no longer a regular file`);
      continue;
    }
    if (!['full', 'managed-block'].includes(entry.ownership)) {
      conflicts.push(`${relative}: manifest contains unsupported ownership ${entry.ownership}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
      conflicts.push(`${relative}: manifest contains an invalid SHA-256`);
      continue;
    }
    const current = readText(absolute, '');
    let actualHash;
    try {
      actualHash = currentManagedHash(current, entry.ownership);
    } catch (error) {
      conflicts.push(`${relative}: ${error.message}`);
      continue;
    }
    if (actualHash !== entry.sha256 && !options.force) {
      conflicts.push(`${relative}: stale managed content changed; use --force to remove only the previously managed artifact`);
      continue;
    }
    if (entry.ownership === 'full' && !current.includes(GENERATED_MARKER)) {
      conflicts.push(`${relative}: stale full-file artifact lacks a generated marker and will not be removed`);
      continue;
    }
    if (entry.ownership === 'managed-block') {
      let desired;
      try {
        desired = removeManagedBlock(current);
      } catch (error) {
        conflicts.push(`${relative}: ${error.message}`);
        continue;
      }
      operations.push({ ...entry, absolute, desired, changed: current !== desired, remove: true, deleteWhenEmpty: desired.trim().length === 0 });
    } else {
      operations.push({ ...entry, absolute, changed: true, remove: true, deleteWhenEmpty: true });
    }
  }
  const linkPaths = [...links];
  const manifestValue = buildManifest(operations, { generatedAt: manifest?.generatedAt ?? null });
  const manifestContent = stableJson(manifestValue);
  const manifestPath = path.join(root, MANIFEST_PATH);
  return {
    operations,
    conflicts,
    links: linkPaths,
    previousManifest: manifest,
    manifest: {
      value: manifestValue,
      content: manifestContent,
      changed: readText(manifestPath, '') !== manifestContent,
    },
    preconditions: {
      root: fs.realpathSync(root),
      files: operations.map((operation) => {
        const coveredByLink = plannedLinkAncestor(root, linkPaths, operation.path);
        return {
          path: operation.path,
          before: coveredByLink ? { kind: 'covered-by-planned-link', link: coveredByLink } : snapshotPath(operation.absolute),
        };
      }),
      links: linkPaths.map((link) => ({ path: normalizeRelative(path.relative(root, link)), before: snapshotPath(link) })),
      manifest: snapshotPath(path.join(root, MANIFEST_PATH)),
    },
  };
}

export function buildManifest(operations, { generatedAt = null } = {}) {
  const manifest = {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    templateVersion: TEMPLATE_VERSION,
    files: operations.filter((operation) => !operation.remove && operation.ownership !== 'seed').map((operation) => ({
      path: operation.path,
      ownership: operation.ownership,
      kind: operation.kind,
      source: operation.source,
      sha256: operation.ownership === 'managed-block' ? sha256(renderManagedBlock(operation.content)) : sha256(operation.desired),
    })),
  };
  if (generatedAt) manifest.generatedAt = generatedAt;
  return manifest;
}

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

function rollbackSnapshot(root, plan) {
  const linkPaths = [...new Set((plan.links ?? []).map((link) => normalizeRelative(path.relative(root, link))))];
  const coveredByMigration = (relative) => plannedLinkAncestor(root, plan.links, relative);
  const paths = new Set([MANIFEST_PATH, ...plan.operations.map((operation) => operation.path)]);
  const files = [...paths].map((relative) => {
    const absolute = path.join(root, relative);
    if (coveredByMigration(relative)) return { relative, kind: 'missing' };
    const stat = lstatSafe(absolute);
    if (!stat) return { relative, kind: 'missing' };
    if (!stat.isFile()) throw new Error(`Transactional apply does not support non-file target ${relative}.`);
    return {
      relative,
      kind: 'file',
      content: fs.readFileSync(absolute),
      mode: stat.mode & 0o777,
      atimeMs: stat.atimeMs,
      mtimeMs: stat.mtimeMs,
    };
  });
  const directories = new Map();
  for (const entry of files) {
    let relative = normalizeRelative(path.dirname(entry.relative));
    while (relative && relative !== '.') {
      const migrationLink = coveredByMigration(relative);
      if (migrationLink === relative) break;
      if (!directories.has(relative)) {
        directories.set(relative, migrationLink ? { kind: 'missing' } : snapshotPath(path.join(root, relative)));
      }
      relative = normalizeRelative(path.dirname(relative));
    }
  }
  const links = linkPaths.map((relative) => {
    const before = snapshotPath(path.join(root, relative));
    if (before.kind !== 'link') throw new Error(`Transactional link migration expected a symbolic link at ${relative}.`);
    return { relative, target: before.target };
  });
  return { files, directories: [...directories].map(([relative, before]) => ({ relative, before })), links };
}

function restoreRollbackSnapshot(root, snapshot) {
  const failures = [];
  for (const entry of [...snapshot.files].sort((left, right) => right.relative.length - left.relative.length)) {
    const absolute = path.join(root, entry.relative);
    try {
      const current = lstatSafe(absolute);
      if (entry.kind === 'missing') {
        if (current?.isFile() || current?.isSymbolicLink()) fs.unlinkSync(absolute);
        else if (current) throw new Error('expected a regular file while restoring a missing path');
        continue;
      }
      if (current && !current.isFile()) throw new Error('expected a regular file while restoring a file');
      writeAtomicFile(absolute, entry.content, entry.mode);
      fs.utimesSync(absolute, entry.atimeMs / 1000, entry.mtimeMs / 1000);
    } catch (error) {
      failures.push(`${entry.relative}: ${error.message}`);
    }
  }
  for (const entry of [...snapshot.directories].sort((left, right) => right.relative.length - left.relative.length)) {
    if (entry.before.kind !== 'missing') continue;
    const absolute = path.join(root, entry.relative);
    try {
      if (lstatSafe(absolute)?.isDirectory()) fs.rmdirSync(absolute);
    } catch (error) {
      if (!['ENOTEMPTY', 'ENOENT'].includes(error.code)) failures.push(`${entry.relative}: ${error.message}`);
    }
  }
  for (const entry of [...(snapshot.links ?? [])].sort((left, right) => right.relative.length - left.relative.length)) {
    const absolute = path.join(root, entry.relative);
    try {
      const current = lstatSafe(absolute);
      if (current?.isDirectory()) fs.rmdirSync(absolute);
      else if (current) fs.unlinkSync(absolute);
      // Controlled rollback: restore only the user-owned link removed by this failed migration.
      fs.symlinkSync(entry.target, absolute);
    } catch (error) {
      failures.push(`${entry.relative}: ${error.message}`);
    }
  }
  if (failures.length > 0) throw new Error(`Rollback could not restore all files:\n- ${failures.join('\n- ')}`);
}

export function applyArtifactPlan(root, plan, options = {}) {
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
        restoreRollbackSnapshot(root, snapshot);
      } catch (rollbackError) {
        error.message = `${error.message}\nRollback failed: ${rollbackError.message}`;
      }
    }
    throw error;
  }
}

export function generatedHeader(comment = '<!--') {
  return comment === '<!--' ? `<!-- ${GENERATED_MARKER} -->` : `${comment} ${GENERATED_MARKER}`;
}

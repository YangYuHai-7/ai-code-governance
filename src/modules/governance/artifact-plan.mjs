import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATED_MARKER,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
} from '../../constants.mjs';
import { snapshotPath } from '../../preconditions.mjs';
import { lstatSafe, readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, normalizeRelative, stableJson } from '../../shared/index.mjs';
import { linkAncestor, plannedLinkAncestor } from './link-paths.mjs';
import { managedContentHash, previousManifestEntry, buildManifest } from './manifest.mjs';
import { loadManifest } from './manifest-store.mjs';
import { mergeManagedBlock, removeManagedBlock } from './managed-block.mjs';

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

    const previous = previousManifestEntry(manifest, relative);
    if (current && current !== desired) {
      const currentHash = managedContentHash(current, artifact.ownership);
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
      actualHash = managedContentHash(current, entry.ownership);
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

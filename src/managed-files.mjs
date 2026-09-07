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
import { isSafeRelative, lstatSafe, normalizeRelative, readJson, readText, sha256, stableJson, writeText } from './utils.mjs';

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
  return { operations, conflicts, links: [...links], previousManifest: manifest };
}

export function buildManifest(operations) {
  return {
    schemaVersion: MANIFEST_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    templateVersion: TEMPLATE_VERSION,
    generatedAt: new Date().toISOString(),
    files: operations.filter((operation) => !operation.remove && operation.ownership !== 'seed').map((operation) => ({
      path: operation.path,
      ownership: operation.ownership,
      kind: operation.kind,
      source: operation.source,
      sha256: operation.ownership === 'managed-block' ? sha256(renderManagedBlock(operation.content)) : sha256(operation.desired),
    })),
  };
}

export function applyArtifactPlan(root, plan, options = {}) {
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely generate governance:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (options.dryRun) return { changed: plan.operations.filter((operation) => operation.changed).map((operation) => operation.path), manifest: null };

  for (const link of plan.links.sort((a, b) => a.length - b.length)) {
    const stat = lstatSafe(link);
    if (stat?.isSymbolicLink()) fs.unlinkSync(link);
  }

  const changed = [];
  for (const operation of plan.operations) {
    if (operation.remove) {
      if (operation.deleteWhenEmpty) {
        if (lstatSafe(operation.absolute)?.isFile()) {
          fs.unlinkSync(operation.absolute);
          changed.push(operation.path);
        }
      } else if (writeText(operation.absolute, operation.desired)) {
        changed.push(operation.path);
      }
      continue;
    }
    if (writeText(operation.absolute, operation.desired)) changed.push(operation.path);
  }
  const manifest = buildManifest(plan.operations);
  const manifestPath = path.join(root, MANIFEST_PATH);
  const previous = readText(manifestPath, '');
  const stableManifest = { ...manifest, generatedAt: plan.previousManifest?.generatedAt ?? manifest.generatedAt };
  const next = stableJson(stableManifest);
  if (previous !== next) {
    writeText(manifestPath, next);
    changed.push(MANIFEST_PATH);
  }
  return { changed, manifest: stableManifest };
}

export function generatedHeader(comment = '<!--') {
  return comment === '<!--' ? `<!-- ${GENERATED_MARKER} -->` : `${comment} ${GENERATED_MARKER}`;
}

import fs from 'node:fs';
import path from 'node:path';
import { MANIFEST_PATH } from '../../constants.mjs';
import { snapshotPath } from '../../preconditions.mjs';
import { lstatSafe, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { normalizeRelative } from '../../shared/index.mjs';
import { plannedLinkAncestor } from './link-paths.mjs';

export function rollbackSnapshot(root, plan) {
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

export function restoreRollbackSnapshot(root, snapshot, restoreUserOwnedLink) {
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
      restoreUserOwnedLink(entry, absolute);
    } catch (error) {
      failures.push(`${entry.relative}: ${error.message}`);
    }
  }
  if (failures.length > 0) throw new Error(`Rollback could not restore all files:\n- ${failures.join('\n- ')}`);
}

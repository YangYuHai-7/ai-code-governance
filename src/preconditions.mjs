import fs from 'node:fs';
import path from 'node:path';
import { isSafeRelative, lstatSafe, normalizeRelative, sha256, stableJson, walkFiles } from './utils.mjs';

export function snapshotPath(absolute) {
  const stat = lstatSafe(absolute);
  if (!stat) return { kind: 'missing' };
  if (stat.isSymbolicLink()) return { kind: 'link', target: fs.readlinkSync(absolute) };
  if (stat.isDirectory()) return { kind: 'directory', mode: stat.mode & 0o777 };
  if (!stat.isFile()) return { kind: 'other', mode: stat.mode & 0o777 };
  return { kind: 'file', sha256: sha256(fs.readFileSync(absolute)), mode: stat.mode & 0o777 };
}

export function sameSnapshot(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function repositoryFingerprint(root) {
  const files = walkFiles(root, { maxDepth: 5 })
    .map((file) => ({ path: file.relative, snapshot: snapshotPath(file.absolute) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256(stableJson({ root: fs.realpathSync(root), files }));
}

export function assertNoLinkAncestor(root, relative, { allowFinalLink = false } = {}) {
  const normalized = normalizeRelative(relative);
  if (!isSafeRelative(normalized)) throw new Error(`Unsafe repository-relative path: ${relative}`);
  const realRoot = fs.realpathSync(root);
  let current = realRoot;
  const parts = normalized.split('/');
  for (let index = 0; index < parts.length; index += 1) {
    current = path.join(current, parts[index]);
    const stat = lstatSafe(current);
    if (!stat) break;
    if (stat.isSymbolicLink() && !(allowFinalLink && index === parts.length - 1)) {
      throw new Error(`${normalized}: path traverses a symbolic link at ${normalizeRelative(path.relative(realRoot, current))}`);
    }
  }
}

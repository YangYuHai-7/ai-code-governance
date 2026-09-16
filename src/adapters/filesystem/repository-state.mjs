import fs from 'node:fs';
import path from 'node:path';
import { lstatSafe, walkFiles } from './files.mjs';
import { sha256, stableJson } from '../../shared/hashing.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/paths.mjs';

export function snapshotPath(absolute) {
  const stat = lstatSafe(absolute);
  if (!stat) return { kind: 'missing' };
  if (stat.isSymbolicLink()) return { kind: 'link', target: fs.readlinkSync(absolute) };
  if (stat.isDirectory()) return { kind: 'directory', mode: stat.mode & 0o7777 };
  if (!stat.isFile()) return { kind: 'other', mode: stat.mode & 0o7777 };
  return { kind: 'file', sha256: sha256(fs.readFileSync(absolute)), mode: stat.mode & 0o7777 };
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

// Read bytes without decoding them. Evidence consumers choose their own format.
export function readBoundedRepositoryFile(root, relative, limit = 2 * 1024 * 1024) {
  if (typeof relative !== 'string' || !isSafeRelative(relative) || normalizeRelative(relative) !== relative || relative.split('/').some((part) => part.toLowerCase() === '.git')) throw new Error(`unsafe evidence path: ${relative}`);
  if (!Number.isSafeInteger(limit) || limit < 0 || limit > 32 * 1024 * 1024) throw new Error('Invalid evidence byte budget.');
  assertNoLinkAncestor(root, relative);
  const absolute = path.join(root, relative), stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.size > limit) throw new Error(`evidence must be a bounded regular file: ${relative}`);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const current = fs.fstatSync(fd);
    const same = (left, right) => left.isFile() && left.dev === right.dev && left.ino === right.ino && left.size === right.size && left.mode === right.mode && left.mtimeMs === right.mtimeMs && left.ctimeMs === right.ctimeMs;
    if (!same(current, stat) || current.size > limit) throw new Error(`evidence changed while reading: ${relative}`);
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    assertNoLinkAncestor(root, relative);
    if (size > limit || size !== current.size || !same(fs.fstatSync(fd), current) || !same(fs.lstatSync(absolute), current)) throw new Error(`evidence changed or exceeds budget: ${relative}`);
    return { bytes: bytes.subarray(0, size), mode: current.mode };
  } finally { fs.closeSync(fd); }
}

import path from 'node:path';
import { lstatSafe } from '../../adapters/filesystem/index.mjs';
import { normalizeRelative } from '../../shared/index.mjs';

export function linkAncestor(root, relative) {
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

export function plannedLinkAncestor(root, links, relative) {
  const normalized = normalizeRelative(relative);
  const candidates = (links ?? [])
    .map((link) => normalizeRelative(path.relative(root, link)))
    .filter((link) => normalized === link || normalized.startsWith(`${link}/`))
    .sort((left, right) => right.length - left.length);
  return candidates[0] ?? null;
}

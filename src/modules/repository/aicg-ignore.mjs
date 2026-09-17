import fs from 'node:fs';
import path from 'node:path';
import { normalizeRelative, sha256, stableJson } from '../../shared/index.mjs';

export function scanExclusionEvidenceHash(policySha256, exclusion) {
  return sha256(stableJson({
    schemaVersion: 1,
    policySha256,
    path: exclusion.path,
    type: exclusion.type,
    line: exclusion.line,
    pattern: exclusion.pattern,
    category: exclusion.category,
    evidenceStatus: exclusion.evidenceStatus,
    contentSha256: exclusion.contentSha256,
  }));
}

function globExpression(pattern) {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
}

function parseRule(line, index) {
  const source = line.trim();
  if (!source || source.startsWith('#')) return null;
  const ignored = !source.startsWith('!');
  const raw = ignored ? source : source.slice(1);
  if (!raw || raw.includes('\u0000')) return null;
  const directoryOnly = raw.endsWith('/');
  const anchored = raw.startsWith('/');
  const pattern = normalizeRelative(raw.replace(/^\/+/, '').replace(/\/+$/, ''));
  if (!pattern || pattern.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return { line: index + 1, ignored, directoryOnly, anchored, pattern, expression: new RegExp(`^${globExpression(pattern)}$`, process.platform === 'win32' ? 'i' : '') };
}

function ruleMatches(rule, relative, type) {
  const segments = relative.split('/');
  if (rule.directoryOnly) {
    const directories = type === 'directory'
      ? [relative]
      : segments.slice(0, -1).map((_, index) => segments.slice(0, index + 1).join('/'));
    const candidates = rule.anchored || rule.pattern.includes('/')
      ? directories
      : directories.flatMap((directory) => directory.split('/'));
    return candidates.some((candidate) => rule.expression.test(candidate));
  }
  const candidates = rule.anchored || rule.pattern.includes('/') ? [relative] : segments;
  for (const candidate of candidates) {
    if (!rule.expression.test(candidate)) continue;
    return true;
  }
  return false;
}

export function loadAicgIgnore(root) {
  const file = path.join(root, '.aicgignore');
  let contents;
  try {
    contents = fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT') return { path: '.aicgignore', sha256: null, rules: [], policy: [], match: () => null, shouldIgnore: () => false };
    throw error;
  }
  const rules = contents.split(/\r?\n/).map(parseRule).filter(Boolean);
  const hasReincludes = rules.some((rule) => !rule.ignored);
  const match = (entry) => {
    if (entry.relative === '.aicgignore') return null;
    let matched = null;
    for (const rule of rules) if (ruleMatches(rule, entry.relative, entry.type)) matched = rule;
    return matched;
  };
  return {
    path: '.aicgignore',
    sha256: sha256(contents),
    rules,
    policy: rules.map(({ line, ignored, directoryOnly, anchored, pattern }) => ({
      line,
      action: ignored ? 'exclude' : 'include',
      pattern,
      directoryOnly,
      anchored,
    })),
    match,
    shouldIgnore(entry) {
      // Keep the ignore policy itself observable and make directory traversal
      // conservative whenever a later negated pattern could re-include a child.
      const matched = match(entry);
      return matched?.ignored === true && !(entry.type === 'directory' && hasReincludes);
    },
  };
}

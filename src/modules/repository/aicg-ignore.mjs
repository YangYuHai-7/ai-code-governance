import fs from 'node:fs';
import path from 'node:path';
import { normalizeRelative } from '../../shared/index.mjs';

function globExpression(pattern) {
  return pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\u0000')
    .replaceAll('*', '[^/]*')
    .replaceAll('\u0000', '.*');
}

function parseRule(line) {
  const source = line.trim();
  if (!source || source.startsWith('#')) return null;
  const ignored = !source.startsWith('!');
  const raw = ignored ? source : source.slice(1);
  if (!raw || raw.includes('\u0000')) return null;
  const directoryOnly = raw.endsWith('/');
  const anchored = raw.startsWith('/');
  const pattern = normalizeRelative(raw.replace(/^\/+/, '').replace(/\/+$/, ''));
  if (!pattern || pattern.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  return { ignored, directoryOnly, anchored, pattern, expression: new RegExp(`^${globExpression(pattern)}$`, process.platform === 'win32' ? 'i' : '') };
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
    if (error.code === 'ENOENT') return { path: '.aicgignore', rules: [], shouldIgnore: () => false };
    throw error;
  }
  const rules = contents.split(/\r?\n/).map(parseRule).filter(Boolean);
  const hasReincludes = rules.some((rule) => !rule.ignored);
  return {
    path: '.aicgignore',
    rules,
    shouldIgnore(entry) {
      // Keep the ignore policy itself observable and make directory traversal
      // conservative whenever a later negated pattern could re-include a child.
      if (entry.relative === '.aicgignore') return false;
      let ignored = false;
      for (const rule of rules) if (ruleMatches(rule, entry.relative, entry.type)) ignored = rule.ignored;
      return ignored && !(entry.type === 'directory' && hasReincludes);
    },
  };
}

import path from 'node:path';
import { isSafeRelative, normalizeRelative } from '../../shared/index.mjs';

const JS_TS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

function tokenize(content) {
  const tokens = [];
  let index = 0;
  let incomplete = false;
  let lineBreakBefore = false;
  const push = (type, value) => {
    tokens.push({ type, value, lineBreakBefore });
    lineBreakBefore = false;
  };
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (/\s/.test(char)) {
      if (char === '\n' || char === '\r') lineBreakBefore = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index += 2;
      while (index < content.length && content[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      if (end < 0) {
        incomplete = true;
        break;
      }
      if (/\r|\n/.test(content.slice(index, end + 2))) lineBreakBefore = true;
      index = end + 2;
      continue;
    }
    if (char === '`') {
      index += 1;
      let closed = false;
      while (index < content.length) {
        if (content[index] === '\\') index += 2;
        else if (content[index] === '`') {
          index += 1;
          closed = true;
          break;
        } else index += 1;
      }
      if (!closed) incomplete = true;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      let closed = false;
      index += 1;
      while (index < content.length) {
        if (content[index] === '\\' && index + 1 < content.length) {
          value += content[index + 1];
          index += 2;
        } else if (content[index] === quote) {
          index += 1;
          closed = true;
          break;
        } else {
          value += content[index];
          index += 1;
        }
      }
      if (!closed) incomplete = true;
      push('string', value);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < content.length && /[A-Za-z0-9_$]/.test(content[index])) index += 1;
      push('identifier', content.slice(start, index));
      continue;
    }
    push('punctuation', char);
    index += 1;
  }
  return { tokens, incomplete };
}

function statementStart(tokens, index) {
  return index === 0 || tokens[index].lineBreakBefore || [';', '}'].includes(tokens[index - 1].value);
}

function reference(specifier, kind, typeOnly = false) {
  return { specifier, kind, typeOnly };
}

/** Extract only literal, statically declared TypeScript module references. */
export function extractTypeScriptReferences(content) {
  if (typeof content !== 'string') return { references: [], unsupported: true, unsupportedReasons: ['invalid-source'] };
  const { tokens, incomplete } = tokenize(content);
  const references = [];
  const reasons = new Set(incomplete ? ['incomplete-source'] : []);
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    if (token.value === 'require' && tokens[index + 1]?.value === '(') {
      reasons.add(tokens[index + 2]?.type === 'string' ? 'require-call' : 'computed-require');
      continue;
    }
    if (token.value === 'import' && tokens[index + 1]?.value === '(') {
      const literal = tokens[index + 2]?.type === 'string';
      if (literal) references.push(reference(tokens[index + 2].value, 'dynamic-import'));
      reasons.add(literal ? 'dynamic-import' : 'computed-dynamic-import');
      continue;
    }
    if (!['import', 'export'].includes(token.value) || !statementStart(tokens, index)) continue;
    const typeOnly = tokens[index + 1]?.value === 'type';
    if (token.value === 'import' && tokens[index + 1]?.type === 'string') {
      references.push(reference(tokens[index + 1].value, 'import'));
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].value !== ';'; cursor += 1) {
      if (cursor > index + 1 && tokens[cursor].lineBreakBefore && tokens[cursor].type === 'identifier' && ['import', 'export'].includes(tokens[cursor].value)) break;
      if (tokens[cursor].value === 'from' && tokens[cursor + 1]?.type === 'string') {
        references.push(reference(tokens[cursor + 1].value, token.value, typeOnly));
        break;
      }
    }
  }
  return {
    references,
    unsupported: reasons.size > 0,
    unsupportedReasons: [...reasons].sort((left, right) => left.localeCompare(right)),
  };
}

function filesByPath(files) {
  const result = new Map();
  const entries = files instanceof Set ? [...files] : Array.isArray(files) ? files : [];
  for (const entry of entries) {
    const relative = typeof entry === 'string' ? entry : entry?.relative;
    if (typeof relative !== 'string' || !isSafeRelative(relative)) continue;
    result.set(normalizeRelative(relative), typeof entry === 'string' ? 'file' : entry.type ?? 'file');
  }
  return result;
}

function result(kind, target = null, packageName = null, supported = true, reason = null) {
  return { kind, target, packageName, supported, reason };
}

function resolveFile(base, files) {
  if (!isSafeRelative(base)) return { target: null, reason: 'unsafe-target' };
  const normalized = normalizeRelative(base);
  const candidates = [normalized];
  if (!path.posix.extname(normalized)) {
    for (const extension of JS_TS_EXTENSIONS) candidates.push(`${normalized}${extension}`);
    for (const extension of JS_TS_EXTENSIONS) candidates.push(`${normalized}/index${extension}`);
  }
  const linked = candidates.some((candidate) => files.get(candidate) === 'link');
  if (linked) return { target: null, reason: 'unsafe-target' };
  const targets = candidates.filter((candidate) => files.get(candidate) === 'file');
  if (targets.length !== 1) return { target: null, reason: 'unresolved-target' };
  return { target: targets[0], reason: null };
}

function tsPathTargets(specifier, paths) {
  const matches = [];
  for (const [pattern, targets] of Object.entries(paths ?? {})) {
    if (!Array.isArray(targets)) continue;
    const star = pattern.indexOf('*');
    const matchesPattern = star === -1
      ? specifier === pattern
      : specifier.startsWith(pattern.slice(0, star)) && specifier.endsWith(pattern.slice(star + 1));
    if (!matchesPattern) continue;
    const captured = star === -1 ? '' : specifier.slice(pattern.slice(0, star).length, specifier.length - pattern.slice(star + 1).length);
    for (const target of targets) if (typeof target === 'string') matches.push(target.replaceAll('*', captured));
  }
  return matches;
}

function viteTargets(specifier, viteAliases) {
  const matches = [];
  for (const [alias, replacement] of Object.entries(viteAliases ?? {})) {
    if (typeof replacement !== 'string' || !(specifier === alias || specifier.startsWith(`${alias}/`))) continue;
    matches.push(`${replacement}${specifier.slice(alias.length)}`.replace(/\/$/, ''));
  }
  return matches;
}

function packageName(specifier) {
  if (specifier.startsWith('@')) return specifier.split('/').slice(0, 2).join('/');
  return specifier.split('/')[0];
}

/** Resolve a static reference against only declared repository alias and workspace facts. */
export function resolveTypeScriptReference({ source, specifier, files, aliases = {}, workspacePackages = {} }) {
  const known = filesByPath(files);
  if (typeof source !== 'string' || !isSafeRelative(source) || typeof specifier !== 'string' || specifier.length === 0) {
    return result('unknown', null, null, false, 'invalid-reference');
  }
  if (specifier.startsWith('.')) {
    const resolved = resolveFile(path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier)), known);
    return result('relative', resolved.target, null, resolved.target !== null, resolved.reason);
  }
  if (Object.hasOwn(workspacePackages, specifier)) {
    const resolved = resolveFile(workspacePackages[specifier], known);
    return result('workspace', resolved.target, specifier, resolved.target !== null, resolved.reason);
  }
  const aliasTargets = [...tsPathTargets(specifier, aliases.tsconfigPaths), ...viteTargets(specifier, aliases.viteAliases)];
  if (aliasTargets.length > 1) return result('alias', null, null, false, 'ambiguous-alias');
  if (aliasTargets.length === 1) {
    const resolved = resolveFile(aliasTargets[0], known);
    return result('alias', resolved.target, null, resolved.target !== null, resolved.reason);
  }
  if (/^(?:@\/|~\/|#\/|src\/)/.test(specifier)) return result('alias', null, null, false, 'alias-facts-unavailable');
  return result('external', null, packageName(specifier), true, null);
}

#!/usr/bin/env node
/**
 * Public-surface guard.
 *
 * AICG publishes two surfaces: the Git repository and the npm package. Neither may contain
 * machine-specific home paths, private project codenames, private contact addresses, or human
 * working notes. Working notes (plans, reviews, reports, pilots) belong under local/, which is
 * git-ignored and excluded from the npm package.
 *
 * Specific project names are deliberately not hard-coded in this public repository. Operators
 * add them to local/public-surface-denylist.txt (one token per line) or to the
 * AICG_PUBLIC_SURFACE_DENYLIST environment variable (comma-separated). Generic rules always
 * run, so absolute home paths, private email domains, and working-note locations fail closed
 * even without a machine-local deny list.
 *
 * Usage: node scripts/public-surface-check.mjs [--root <dir>]
 */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_PATH = fileURLToPath(import.meta.url);
const DEFAULT_ROOT = path.resolve(path.dirname(SCRIPT_PATH), '..');
// Files that define the policy itself necessarily spell out the rules they enforce.
const POLICY_PATHS = new Set(['scripts/public-surface-check.mjs', 'test/public-surface-guard.test.mjs']);
const MAX_TEXT_BYTES = 2 * 1024 * 1024;

// Files under these roots are machine-local working material, not part of either surface.
const LOCAL_ROOTS = ['local/'];

// A path matching one of these shapes is a working note and must live under local/ instead.
const NOTE_PATH_PATTERNS = [
  /^docs\/评测-/u,
  /^docs\/整改-/u,
  /^docs\/优化方案-/u,
  /^docs\/[^/]*报告[^/]*\.md$/u,
  /^docs\/pilots\//u,
  /^docs\/reports\//u,
  /^docs\/superpowers\//u,
  /^reports\//u,
  /^reviews\//u,
];

// Machine-independent rules. Placeholder home directories owned by examples are allowed.
const ALLOWED_HOME_NAMES = 'owner|you|user|example|sample|test|runner|name|me';
const GENERIC_CONTENT_PATTERNS = [
  {
    id: 'absolute-home-path',
    pattern: new RegExp(
      '(?:\\/Users\\/(?!' + ALLOWED_HOME_NAMES + '\\b)'
      + '|\\/home\\/(?!' + ALLOWED_HOME_NAMES + '\\b)'
      + '|[A-Za-z]:[\\\\/]Users[\\\\/](?!' + ALLOWED_HOME_NAMES + '\\b))',
      'u',
    ),
  },
  {
    id: 'private-email',
    pattern: /[A-Za-z0-9._%+-]+@(?:gmail|googlemail|qq|163|126|outlook|hotmail|yahoo|icloud)\.(?:com|cn|net)\b/iu,
  },
];

export function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function loadDenyTokens(root) {
  const tokens = new Set();
  const fromEnvironment = process.env.AICG_PUBLIC_SURFACE_DENYLIST;
  if (fromEnvironment) for (const token of fromEnvironment.split(',')) if (token.trim()) tokens.add(token.trim());
  const file = path.join(root, 'local', 'public-surface-denylist.txt');
  if (fs.existsSync(file)) {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const token = line.trim();
      if (token && !token.startsWith('#')) tokens.add(token);
    }
  }
  return [...tokens];
}

export function isLocalPath(relative) {
  const normalized = relative.replace(/\\/g, '/');
  return LOCAL_ROOTS.some((root) => normalized === root.replace(/\/$/, '') || normalized.startsWith(root));
}

export function pathViolation(relative) {
  if (isLocalPath(relative)) return null;
  const normalized = relative.replace(/\\/g, '/');
  for (const pattern of NOTE_PATH_PATTERNS) {
    if (pattern.test(normalized)) return { rule: 'working-note-path', file: relative };
  }
  return null;
}

export function contentViolations(relative, text, denyTokens = []) {
  if (POLICY_PATHS.has(relative.replace(/\\/g, '/'))) return [];
  const findings = [];
  const lowered = text.toLowerCase();
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    for (const rule of GENERIC_CONTENT_PATTERNS) {
      if (rule.pattern.test(line)) findings.push({ rule: rule.id, file: relative, line: index + 1 });
    }
    for (const token of denyTokens) {
      if (lowered.includes(token.toLowerCase()) && line.toLowerCase().includes(token.toLowerCase())) {
        findings.push({ rule: 'denylisted-token', file: relative, line: index + 1 });
      }
    }
  }
  return findings;
}

function gitFiles(root) {
  try {
    const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
    return output.split('\0').filter(Boolean);
  } catch {
    return null;
  }
}

function packedFiles(root) {
  const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  try {
    const output = execFileSync(npm, ['pack', '--dry-run', '--ignore-scripts', '--json'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 120000, maxBuffer: 32 * 1024 * 1024,
    });
    const parsed = JSON.parse(output);
    const entry = Array.isArray(parsed) ? parsed[0] : Object.values(parsed)[0];
    return (entry?.files ?? []).map((file) => file.path);
  } catch {
    return null;
  }
}

export function scan(root) {
  const denyTokens = loadDenyTokens(root);
  const surfaces = [];
  const tracked = gitFiles(root);
  if (tracked) surfaces.push({ name: 'git', files: tracked });
  const packed = packedFiles(root);
  if (packed) surfaces.push({ name: 'npm', files: packed });

  const findings = [];
  const seen = new Set();
  for (const surface of surfaces) {
    for (const relative of surface.files) {
      if (!seen.has('path:' + relative)) {
        seen.add('path:' + relative);
        const violation = pathViolation(relative);
        if (violation) findings.push({ ...violation, surface: surface.name });
      }
      const absolute = path.join(root, relative);
      if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) continue;
      if (fs.statSync(absolute).size > MAX_TEXT_BYTES) continue;
      const buffer = fs.readFileSync(absolute);
      if (buffer.includes(0)) continue;
      const key = 'content:' + relative;
      if (seen.has(key)) continue;
      seen.add(key);
      findings.push(...contentViolations(relative, buffer.toString('utf8'), denyTokens).map((entry) => ({ ...entry, surface: surface.name })));
    }
  }
  return {
    ok: findings.length === 0,
    root,
    denyTokens: denyTokens.length,
    surfaces: surfaces.map((surface) => ({ name: surface.name, files: surface.files.length })),
    findings,
  };
}

function parseRoot(argv) {
  const index = argv.indexOf('--root');
  if (index >= 0 && argv[index + 1]) return path.resolve(argv[index + 1]);
  const positional = argv.find((value) => !value.startsWith('-'));
  return positional ? path.resolve(positional) : DEFAULT_ROOT;
}

if (path.resolve(process.argv[1] ?? '') === SCRIPT_PATH) {
  const result = scan(parseRoot(process.argv.slice(2)));
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

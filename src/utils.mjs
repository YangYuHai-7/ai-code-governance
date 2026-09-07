import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

export function stableJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

export function normalizeRelative(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//, '');
}

export function isSafeRelative(value) {
  const normalized = normalizeRelative(value);
  if (!normalized || normalized.includes('\0') || normalized.startsWith('/') || /^[A-Za-z]:\//.test(normalized)) return false;
  return !normalized.split('/').some((part) => part === '' || part === '.' || part === '..');
}

export function exists(target) {
  try {
    fs.accessSync(target);
    return true;
  } catch {
    return false;
  }
}

export function lstatSafe(target) {
  try {
    return fs.lstatSync(target);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

export function readText(target, fallback) {
  try {
    return fs.readFileSync(target, 'utf8');
  } catch (error) {
    if (fallback !== undefined && error.code === 'ENOENT') return fallback;
    throw error;
  }
}

export function readJson(target) {
  return JSON.parse(readText(target));
}

export function writeText(target, content) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const current = readText(target, '');
  if (current === content) return false;
  fs.writeFileSync(target, content, 'utf8');
  return true;
}

export function commandExists(command, env = process.env) {
  const executable = process.platform === 'win32' ? 'where' : 'sh';
  const args = process.platform === 'win32' ? [command] : ['-c', 'command -v "$1" >/dev/null 2>&1', 'sh', command];
  return spawnSync(executable, args, { env, stdio: 'ignore' }).status === 0;
}

export function commandVersion(command, env = process.env) {
  const result = spawnSync(command, ['--version'], { env, encoding: 'utf8', timeout: 5000 });
  if (result.error || result.status !== 0) return null;
  return `${result.stdout || result.stderr}`.trim().split(/\r?\n/, 1)[0] || null;
}

export function walkFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const ignored = new Set(options.ignored ?? ['.git', 'node_modules', 'dist', 'build', 'target', '.next']);
  const result = [];

  function visit(current, depth) {
    if (depth > maxDepth) return;
    let entries;
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (ignored.has(entry.name)) continue;
      const absolute = path.join(current, entry.name);
      const relative = normalizeRelative(path.relative(root, absolute));
      if (entry.isSymbolicLink()) {
        result.push({ absolute, relative, type: 'link' });
      } else if (entry.isDirectory()) {
        visit(absolute, depth + 1);
      } else if (entry.isFile()) {
        result.push({ absolute, relative, type: 'file' });
      }
    }
  }

  visit(root, 0);
  return result;
}

export function matchSimpleGlob(file, pattern) {
  const normalizedFile = normalizeRelative(file);
  const normalizedPattern = normalizeRelative(pattern);
  const escaped = normalizedPattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '::DOUBLE::').replaceAll('*', '[^/]*').replaceAll('::DOUBLE::', '.*');
  const regex = new RegExp(`(^|/)${escaped}$`, process.platform === 'win32' ? 'i' : '');
  return regex.test(normalizedFile);
}

export function usageError(message) {
  const error = new Error(message);
  error.code = 'AICG_USAGE';
  error.exitCode = 2;
  return error;
}

export function unique(values) {
  return [...new Set(values)];
}

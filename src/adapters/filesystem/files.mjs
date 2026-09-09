import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeRelative } from '../../shared/paths.mjs';

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

export function writeAtomicFile(target, content, mode = null) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const temporary = path.join(path.dirname(target), `.${path.basename(target)}.${process.pid}.${crypto.randomBytes(6).toString('hex')}.tmp`);
  try {
    fs.writeFileSync(temporary, content, { encoding: typeof content === 'string' ? 'utf8' : undefined, flag: 'wx' });
    if (mode !== null) fs.chmodSync(temporary, mode);
    fs.renameSync(temporary, target);
  } finally {
    try {
      fs.unlinkSync(temporary);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

export function walkFiles(root, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const caseInsensitiveIgnored = options.caseInsensitiveIgnored === true;
  const normalizeIgnored = (name) => caseInsensitiveIgnored ? name.toLowerCase() : name;
  const ignored = new Set((options.ignored ?? ['.git', 'node_modules', 'dist', 'build', 'target', '.next']).map(normalizeIgnored));
  const ignoredAtAnyDepth = new Set([...((options.ignoredAtAnyDepth ?? ignored))].map(normalizeIgnored));
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
      const ignoredName = normalizeIgnored(entry.name);
      if (ignoredAtAnyDepth.has(ignoredName) || (depth === 0 && ignored.has(ignoredName))) continue;
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

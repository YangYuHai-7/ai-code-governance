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
  return walkFilesDetailed(root, options).files;
}

export function walkFilesDetailed(root, options = {}) {
  const maxDepth = options.maxDepth ?? 4;
  const maxFiles = options.maxFiles ?? Infinity;
  const maxFileBytes = options.maxFileBytes ?? Infinity;
  const maxDirectories = options.maxDirectories ?? Infinity;
  const maxEntries = options.maxEntries ?? Infinity;
  const caseInsensitiveIgnored = options.caseInsensitiveIgnored === true;
  const normalizeIgnored = (name) => caseInsensitiveIgnored ? name.toLowerCase() : name;
  const ignored = new Set((options.ignored ?? ['.git', 'node_modules', 'dist', 'build', 'target', '.next']).map(normalizeIgnored));
  const ignoredAtAnyDepth = new Set([...((options.ignoredAtAnyDepth ?? ignored))].map(normalizeIgnored));
  const result = [];
  const truncatedDirectories = [];
  const directoryBudgetPaths = [];
  const oversizedFiles = [];
  const readErrors = [];
  let fileLimitReached = false;
  let directoryLimitReached = false;
  let entryLimitReached = false;
  let observedDirectories = 0;
  let observedEntries = 0;

  function stopped() {
    return fileLimitReached || directoryLimitReached || entryLimitReached;
  }

  function visit(current, depth) {
    if (stopped()) return;
    const currentRelative = normalizeRelative(path.relative(root, current)) || '.';
    if (observedDirectories >= maxDirectories) {
      directoryLimitReached = true;
      directoryBudgetPaths.push(currentRelative);
      return;
    }
    observedDirectories += 1;
    let directory;
    try {
      directory = fs.opendirSync(current);
    } catch (error) {
      readErrors.push({ path: currentRelative, operation: 'readdir', code: error.code ?? 'UNKNOWN' });
      return;
    }
    try {
      while (!stopped()) {
        const entry = directory.readSync();
        if (!entry) break;
        if (observedEntries >= maxEntries) {
          entryLimitReached = true;
          break;
        }
        observedEntries += 1;
        const ignoredName = normalizeIgnored(entry.name);
        if (ignoredAtAnyDepth.has(ignoredName) || (depth === 0 && ignored.has(ignoredName))) continue;
        const absolute = path.join(current, entry.name);
        const relative = normalizeRelative(path.relative(root, absolute));
        if (entry.isSymbolicLink()) {
          if (result.length >= maxFiles) {
            fileLimitReached = true;
            break;
          }
          result.push({ absolute, relative, type: 'link', contentScannable: false });
        } else if (entry.isDirectory()) {
          if (depth >= maxDepth) truncatedDirectories.push(relative);
          else if (observedDirectories >= maxDirectories) {
            directoryLimitReached = true;
            directoryBudgetPaths.push(relative);
          } else visit(absolute, depth + 1);
        } else if (entry.isFile()) {
          if (result.length >= maxFiles) {
            fileLimitReached = true;
            break;
          }
          let size = null;
          try {
            size = fs.statSync(absolute).size;
          } catch (error) {
            readErrors.push({ path: relative, operation: 'stat', code: error.code ?? 'UNKNOWN' });
          }
          const contentScannable = size !== null && size <= maxFileBytes;
          if (size !== null && size > maxFileBytes) oversizedFiles.push({ path: relative, bytes: size });
          result.push({ absolute, relative, type: 'file', size, contentScannable });
        }
      }
    } catch (error) {
      readErrors.push({ path: currentRelative, operation: 'readdir', code: error.code ?? 'UNKNOWN' });
    } finally {
      try {
        directory.closeSync();
      } catch (error) {
        if (error.code !== 'ERR_DIR_CLOSED') readErrors.push({ path: currentRelative, operation: 'closedir', code: error.code ?? 'UNKNOWN' });
      }
    }
  }

  visit(root, 0);
  const byPath = (left, right) => left.path.localeCompare(right.path) || left.operation?.localeCompare(right.operation ?? '') || 0;
  return {
    files: result,
    budget: {
      maxDepth,
      maxFiles,
      maxFileBytes,
      maxDirectories,
      maxEntries,
      observedFiles: result.length,
      observedDirectories,
      observedEntries,
      complete: !fileLimitReached && !directoryLimitReached && !entryLimitReached && truncatedDirectories.length === 0 && directoryBudgetPaths.length === 0 && oversizedFiles.length === 0 && readErrors.length === 0,
      truncation: {
        fileLimitReached,
        directoryLimitReached,
        entryLimitReached,
        directories: [...truncatedDirectories].sort((left, right) => left.localeCompare(right)).slice(0, 20),
        directoryBudgetPaths: [...directoryBudgetPaths].sort((left, right) => left.localeCompare(right)).slice(0, 20),
        oversizedFiles: [...oversizedFiles].sort(byPath).slice(0, 20),
        readErrors: [...readErrors].sort(byPath).slice(0, 20),
      },
    },
  };
}

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { sha256, stableJson } from '../../shared/index.mjs';

const POLICY_VERSION = 'effective-scan-input-v2';
const HASH_BUFFER_BYTES = 64 * 1024;

function sameRegularFile(left, right) {
  return right.isFile()
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs;
}

function regularFileSha256(absolute, before) {
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const opened = fs.fstatSync(fd);
    if (!sameRegularFile(before, opened)) throw new Error(`Scan input changed while fingerprinting: ${absolute}`);
    const digest = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(HASH_BUFFER_BYTES);
    let offset = 0;
    while (offset < opened.size) {
      const bytesRead = fs.readSync(fd, buffer, 0, Math.min(buffer.length, opened.size - offset), offset);
      if (!bytesRead) break;
      digest.update(buffer.subarray(0, bytesRead));
      offset += bytesRead;
    }
    if (offset !== opened.size || !sameRegularFile(opened, fs.fstatSync(fd)) || !sameRegularFile(opened, fs.lstatSync(absolute))) {
      throw new Error(`Scan input changed while fingerprinting: ${absolute}`);
    }
    return digest.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function fileSnapshot(file) {
  let stat;
  try {
    stat = fs.lstatSync(file.absolute);
  } catch (error) {
    return { path: file.relative, type: 'missing', error: error.code ?? 'UNKNOWN' };
  }
  const base = {
    path: file.relative,
    type: file.type,
    mode: stat.mode & 0o7777,
    size: stat.size,
    mtimeMs: stat.mtimeMs,
    ctimeMs: stat.ctimeMs,
  };
  if (stat.isSymbolicLink()) {
    try {
      return { ...base, target: fs.readlinkSync(file.absolute) };
    } catch (error) {
      return { ...base, targetError: error.code ?? 'UNKNOWN' };
    }
  }
  if (stat.isFile()) return { ...base, sha256: regularFileSha256(file.absolute, stat) };
  return base;
}

function scanPolicy(scan) {
  const budget = scan.scanBudget ?? {};
  return {
    maxDepth: budget.maxDepth ?? null,
    maxFiles: budget.maxFiles ?? null,
    maxFileBytes: budget.maxFileBytes ?? null,
    maxDirectories: budget.maxDirectories ?? null,
    maxEntries: budget.maxEntries ?? null,
    complete: budget.complete ?? null,
    truncation: budget.truncation ?? null,
  };
}

export function scanInputDescriptor(scan) {
  return {
    schemaVersion: 1,
    policyVersion: POLICY_VERSION,
    root: fs.realpathSync(scan.root),
    projectMode: scan.projectMode,
    repositoryFamily: scan.repositoryFamily ?? null,
    scanIgnore: scan.scanIgnore ?? null,
    scanPolicy: scanPolicy(scan),
    governanceUnits: (scan.governanceUnits ?? []).map((unit) => ({
      id: unit.id,
      unitId: unit.unitId,
      path: unit.path,
      status: unit.status,
      projectMode: unit.projectMode ?? null,
      stacks: unit.stacks ?? [],
      commands: unit.commands ?? [],
      manifests: unit.manifests ?? [],
      scanIgnore: unit.scanIgnore ?? null,
      scanPolicy: scanPolicy({ scanBudget: unit.scanBudget }),
      files: (unit.inventory ?? []).map(fileSnapshot).sort((left, right) => left.path.localeCompare(right.path)),
    })),
    files: (scan.files ?? [])
      .map(fileSnapshot)
      .sort((left, right) => left.path.localeCompare(right.path)),
  };
}

export function scanInputFingerprint(scan) {
  return sha256(stableJson(scanInputDescriptor(scan)));
}

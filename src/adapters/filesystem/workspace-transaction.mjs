import fs from 'node:fs';
import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative, normalizeRelative, sha256 } from '../../shared/index.mjs';
import { assertNoLinkAncestor } from './repository-state.mjs';
import { lstatSafe, writeAtomicFile } from './files.mjs';

const MAX_INVENTORY_FILES = 100000;
const MAX_INVENTORY_BYTES = 128 * 1024 * 1024;

function snapshot(absolute, includeBytes = true) {
  const stat = lstatSafe(absolute);
  if (!stat) return { kind: 'missing' };
  if (stat.isSymbolicLink()) return { kind: 'link', target: fs.readlinkSync(absolute) };
  if (!stat.isFile()) return { kind: stat.isDirectory() ? 'directory' : 'other', mode: stat.mode & 0o7777 };
  const bytes = fs.readFileSync(absolute);
  return { kind: 'file', digest: sha256(bytes), size: bytes.length, mode: stat.mode & 0o7777, ...(includeBytes ? { bytes } : {}) };
}

function comparable(value) {
  if (!value) return value;
  const { bytes, ...rest } = value;
  return rest;
}

function same(left, right) { return JSON.stringify(comparable(left)) === JSON.stringify(comparable(right)); }

function inventory(root) {
  const values = new Map();
  let bytes = 0;
  function visit(directory, relativeDirectory = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      if (!relativeDirectory && ['.git', '.ai-governance'].includes(entry.name)) continue;
      const relative = normalizeRelative(path.join(relativeDirectory, entry.name));
      const absolute = path.join(directory, entry.name);
      const stat = fs.lstatSync(absolute);
      if (stat.isDirectory() && !stat.isSymbolicLink()) { visit(absolute, relative); continue; }
      const value = snapshot(absolute);
      values.set(relative, value);
      bytes += value.size ?? Buffer.byteLength(value.target ?? '');
      if (values.size > MAX_INVENTORY_FILES || bytes > MAX_INVENTORY_BYTES) throw usageError('Workspace transaction inventory exceeds its safety budget.');
    }
  }
  visit(root);
  return values;
}

function changed(before, after) {
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  return paths.filter((relative) => !same(before.get(relative) ?? { kind: 'missing' }, after.get(relative) ?? { kind: 'missing' }));
}

function pathAllowed(authority, relative) {
  return authority.allowedPaths.some((allowed) => allowed.endsWith('/') ? relative.startsWith(allowed) : relative === allowed);
}

function restore(root, relative, value) {
  const absolute = path.join(root, relative);
  if (value.kind === 'missing') {
    const stat = lstatSafe(absolute);
    if (stat?.isDirectory()) throw usageError(`Workspace rollback refuses directory mutation at ${relative}.`);
    if (stat) fs.unlinkSync(absolute);
    return;
  }
  if (value.kind !== 'file') throw usageError(`Workspace rollback cannot restore unsupported ${value.kind} at ${relative}.`);
  writeAtomicFile(absolute, value.bytes, value.mode);
}

export function beginWorkspaceTransaction(root, { sessionId, authority, repositorySnapshot }) {
  const realRoot = fs.realpathSync(root);
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(sessionId)) throw usageError('Invalid workspace transaction session id.');
  if (!authority || !Array.isArray(authority.allowedPaths) || !Number.isSafeInteger(authority.maxChangedFiles) || !Number.isSafeInteger(authority.maxChangedBytes)) throw usageError('Normalized delivery authority is required.');
  if (!repositorySnapshot || typeof repositorySnapshot !== 'object' || !Array.isArray(repositorySnapshot.files)) throw usageError('Approved repository snapshot is required.');
  if (repositorySnapshot.sessionDigest !== undefined && !/^[a-f0-9]{64}$/.test(repositorySnapshot.sessionDigest)) throw usageError('Approved repository snapshot session digest is invalid.');
  for (const allowed of authority.allowedPaths) {
    const relative = allowed.endsWith('/') ? allowed.slice(0, -1) : allowed;
    if (!isSafeRelative(relative)) throw usageError(`Unsafe workspace authority path: ${allowed}.`);
    assertNoLinkAncestor(realRoot, relative);
  }
  const before = inventory(realRoot);
  const approved = new Map(repositorySnapshot.files.map((entry) => [entry.path, entry]));
  for (const [relative, value] of before) {
    if (!pathAllowed(authority, relative)) continue;
    const bound = approved.get(relative);
    if (!bound || bound.kind !== value.kind || (value.kind === 'file' && (bound.digest ?? bound.sha256) !== value.digest)) throw usageError(`Workspace transaction overlapping dirty scope is not bound by the approved snapshot: ${relative}.`);
  }
  let postRun = null;
  let status = 'open';

  function inspectInventory(current = inventory(realRoot)) {
    const changedPaths = changed(before, current);
    const outside = changedPaths.filter((relative) => !pathAllowed(authority, relative));
    const changedBytes = changedPaths.reduce((sum, relative) => sum + (current.get(relative)?.size ?? 0), 0);
    const reasons = [];
    if (outside.length) reasons.push(`writes outside approved paths: ${outside.join(', ')}`);
    if (changedPaths.length > authority.maxChangedFiles) reasons.push(`changed-file budget exceeded: ${changedPaths.length} > ${authority.maxChangedFiles}`);
    if (changedBytes > authority.maxChangedBytes) reasons.push(`changed-byte budget exceeded: ${changedBytes} > ${authority.maxChangedBytes}`);
    return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons), changedPaths: Object.freeze(changedPaths), changedBytes, current });
  }

  function rollbackInternal(reason) {
    if (!postRun) return Object.freeze({ status: 'rolled-back', reason, changedPaths: Object.freeze([]) });
    const current = inventory(realRoot);
    const touched = changed(before, postRun);
    for (const relative of touched) if (!same(current.get(relative) ?? { kind: 'missing' }, postRun.get(relative) ?? { kind: 'missing' })) throw usageError(`Workspace rollback refused concurrent modification at ${relative}.`);
    for (const relative of [...touched].reverse()) restore(realRoot, relative, before.get(relative) ?? { kind: 'missing' });
    status = 'rolled-back';
    return Object.freeze({ status, reason, changedPaths: Object.freeze(touched) });
  }

  const transaction = {
    run(turn) {
      if (status !== 'open') throw usageError(`Workspace transaction is ${status}.`);
      try {
        if (typeof turn === 'function') turn(Object.freeze({ root: realRoot, sessionId }));
        else {
          if (!turn || typeof turn !== 'object' || !Array.isArray(turn.writes ?? []) || !Array.isArray(turn.deletes ?? [])) throw usageError('Workspace transaction turn must be a mutation function or proposal.');
          for (const mutation of turn.writes ?? []) {
            if (!mutation || typeof mutation.path !== 'string' || !(typeof mutation.content === 'string' || Buffer.isBuffer(mutation.content)) || !pathAllowed(authority, normalizeRelative(mutation.path))) throw usageError(`Workspace proposal write is outside approved paths: ${mutation?.path ?? 'unknown'}.`);
            const relative = normalizeRelative(mutation.path); assertNoLinkAncestor(realRoot, relative); writeAtomicFile(path.join(realRoot, relative), mutation.content);
          }
          for (const mutation of turn.deletes ?? []) {
            const relative = normalizeRelative(mutation.path ?? '');
            if (!pathAllowed(authority, relative)) throw usageError(`Workspace proposal delete is outside approved paths: ${relative || 'unknown'}.`);
            assertNoLinkAncestor(realRoot, relative); const stat = lstatSafe(path.join(realRoot, relative)); if (stat && !stat.isFile()) throw usageError(`Workspace proposal can delete only regular files: ${relative}.`); if (stat) fs.unlinkSync(path.join(realRoot, relative));
          }
        }
      } catch (error) {
        postRun = inventory(realRoot);
        try { rollbackInternal(`turn failed: ${error.message}`); } catch (rollbackError) { error.rollbackError = rollbackError; }
        throw error;
      }
      postRun = inventory(realRoot);
      const inspection = inspectInventory(postRun);
      if (!inspection.allowed) {
        rollbackInternal('authority or budget violation');
        throw usageError(`Workspace transaction rejected: ${inspection.reasons.join('; ')}.`);
      }
      status = 'inspected';
      return inspection;
    },
    inspect() {
      const inspection = inspectInventory();
      const plain = { ...inspection }; delete plain.current;
      return Object.freeze(plain);
    },
    commit(expectedSessionDigest) {
      if (repositorySnapshot.sessionDigest !== undefined && expectedSessionDigest !== repositorySnapshot.sessionDigest) throw usageError('Workspace transaction session digest does not match the approved snapshot.');
      if (status !== 'inspected' || !postRun) throw usageError('Workspace transaction must run and pass inspection before commit.');
      const current = inventory(realRoot);
      const drift = changed(postRun, current);
      if (drift.length) throw usageError(`Workspace transaction concurrent modification detected: ${drift.join(', ')}.`);
      status = 'committed';
      return Object.freeze({ status, sessionId, changedPaths: Object.freeze(changed(before, current)) });
    },
    rollback(reason) {
      if (status === 'committed') throw usageError('Committed workspace transaction cannot be rolled back by this handle.');
      return rollbackInternal(reason ?? 'operator requested rollback');
    },
  };
  return Object.freeze(transaction);
}

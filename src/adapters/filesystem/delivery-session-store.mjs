import fs from 'node:fs';
import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';
import { assertNoLinkAncestor } from './repository-state.mjs';
import { lstatSafe, writeAtomicFile } from './files.mjs';

const VOLATILE = ['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt'];
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_EVENTS = 1024;
const MAX_EVENT_BYTES = 64 * 1024;
const MAX_EVENT_LOG_BYTES = 8 * 1024 * 1024;
const MAX_CHECKPOINTS = 16;

function digestSession(session) { return canonicalValueDigest(session, { omit: VOLATILE }); }
function serialized(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function checkedId(id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw usageError('Invalid delivery session id.');
  return id;
}

function parseSession(text, label, expectedId = null) {
  let value;
  try { value = JSON.parse(text); } catch { throw usageError(`Unreadable delivery session ${label}.`); }
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !SESSION_ID.test(value.id ?? '') || (expectedId !== null && value.id !== expectedId)) throw usageError(`Unreadable delivery session ${label}.`);
  return value;
}

function syncFile(target) {
  const descriptor = fs.openSync(target, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

function syncDirectory(target) {
  const descriptor = fs.openSync(target, 'r');
  try { fs.fsyncSync(descriptor); } finally { fs.closeSync(descriptor); }
}

export function openDeliverySessionStore(root, options = {}) {
  const realRoot = fs.realpathSync(root);
  const baseRelative = '.ai-governance/state/delivery-sessions';
  const base = path.join(realRoot, baseRelative);

  function directory(id) {
    checkedId(id);
    assertNoLinkAncestor(realRoot, `${baseRelative}/${id}`);
    return path.join(base, id);
  }

  function checkpointDirectory(id) { return path.join(directory(id), 'checkpoints'); }

  function publishedCompanions(id) {
    const targetDirectory = directory(id);
    const marker = lstatSafe(path.join(targetDirectory, 'session.json'));
    if (!marker) {
      if (lstatSafe(targetDirectory)) throw usageError(`Delivery session ${id} is incomplete.`);
      throw usageError(`Delivery session ${id} does not exist.`);
    }
    const events = lstatSafe(path.join(targetDirectory, 'events.jsonl'));
    const checkpoints = lstatSafe(path.join(targetDirectory, 'checkpoints'));
    if (!marker.isFile() || !events?.isFile() || events.size > MAX_EVENT_LOG_BYTES || !checkpoints?.isDirectory()) {
      throw usageError(`Unreadable delivery session ${id}; published companions are incomplete.`);
    }
    try {
      const eventLines = fs.readFileSync(path.join(targetDirectory, 'events.jsonl'), 'utf8').split('\n').filter(Boolean);
      if (eventLines.length > MAX_EVENTS) throw new Error('event limit');
      const eventIds = new Set();
      for (const line of eventLines) {
        if (Buffer.byteLength(line, 'utf8') + 1 > MAX_EVENT_BYTES) throw new Error('event bytes');
        const event = JSON.parse(line);
        if (!event || typeof event !== 'object' || Array.isArray(event) || !SESSION_ID.test(event.id ?? '') || eventIds.has(event.id)) throw new Error('invalid event');
        eventIds.add(event.id);
      }
      const checkpointRoot = path.join(targetDirectory, 'checkpoints');
      const hasValidCheckpoint = fs.readdirSync(checkpointRoot).some((entry) => {
        if (!entry.endsWith('.json')) return false;
        const file = path.join(checkpointRoot, entry);
        if (!lstatSafe(file)?.isFile()) return false;
        try { parseSession(fs.readFileSync(file, 'utf8'), `${id} checkpoint`, id); return true; }
        catch { return false; }
      });
      if (!hasValidCheckpoint) throw new Error('invalid checkpoint');
    } catch {
      throw usageError(`Unreadable delivery session ${id}; published companions are incomplete.`);
    }
  }

  function pruneCheckpoints(id) {
    const checkpointRoot = checkpointDirectory(id);
    if (!fs.existsSync(checkpointRoot)) return;
    const files = fs.readdirSync(checkpointRoot).filter((entry) => entry.endsWith('.json')).sort();
    for (const file of files.slice(0, Math.max(0, files.length - MAX_CHECKPOINTS))) fs.unlinkSync(path.join(checkpointRoot, file));
  }

  function writeCheckpoint(id, session) {
    const checkpointRoot = checkpointDirectory(id);
    fs.mkdirSync(checkpointRoot, { recursive: true });
    const name = `${String(session.sequence).padStart(12, '0')}-${digestSession(session).slice(0, 12)}.json`;
    writeAtomicFile(path.join(checkpointRoot, name), serialized(session));
    pruneCheckpoints(id);
  }

  function recover(id) {
    const checkpointRoot = checkpointDirectory(id);
    const files = fs.existsSync(checkpointRoot) ? fs.readdirSync(checkpointRoot).filter((entry) => entry.endsWith('.json')).sort().reverse() : [];
    for (const file of files) {
      try { return parseSession(fs.readFileSync(path.join(checkpointRoot, file), 'utf8'), `${id} checkpoint`, id); } catch { /* try the previous durable checkpoint */ }
    }
    throw usageError(`Unreadable delivery session ${id}; no durable checkpoint is available.`);
  }

  const store = {
    create(session) {
      checkedId(session?.id);
      const targetDirectory = directory(session.id);
      assertNoLinkAncestor(realRoot, baseRelative);
      fs.mkdirSync(base, { recursive: true });
      const staging = fs.mkdtempSync(path.join(base, '.create-'));
      let reserved = false;
      let published = false;
      try {
        const checkpointName = `${String(session.sequence).padStart(12, '0')}-${digestSession(session).slice(0, 12)}.json`;
        const stagedSession = path.join(staging, 'session.json');
        const stagedEvents = path.join(staging, 'events.jsonl');
        const stagedCheckpoint = path.join(staging, checkpointName);
        fs.writeFileSync(stagedSession, serialized(session), { flag: 'wx' });
        options.onCreateStep?.('after-stage-session');
        fs.writeFileSync(stagedEvents, '', { flag: 'wx' });
        options.onCreateStep?.('after-stage-events');
        fs.writeFileSync(stagedCheckpoint, serialized(session), { flag: 'wx' });
        options.onCreateStep?.('after-stage-checkpoint');
        for (const file of [stagedSession, stagedEvents, stagedCheckpoint]) syncFile(file);
        parseSession(fs.readFileSync(stagedSession, 'utf8'), session.id, session.id);
        parseSession(fs.readFileSync(stagedCheckpoint, 'utf8'), `${session.id} checkpoint`, session.id);
        syncDirectory(staging);
        options.onCreateStep?.('after-stage-sync');
        options.onCreateStep?.('before-reserve');
        try { fs.mkdirSync(targetDirectory); reserved = true; }
        catch (error) {
          if (error.code !== 'EEXIST') throw error;
          publishedCompanions(session.id);
          throw usageError(`Delivery session ${session.id} already exists.`);
        }
        options.onCreateStep?.('after-reserve');
        const checkpointRoot = path.join(targetDirectory, 'checkpoints');
        fs.mkdirSync(checkpointRoot);
        fs.copyFileSync(stagedEvents, path.join(targetDirectory, 'events.jsonl'), fs.constants.COPYFILE_EXCL);
        options.onCreateStep?.('after-events');
        fs.copyFileSync(stagedCheckpoint, path.join(checkpointRoot, checkpointName), fs.constants.COPYFILE_EXCL);
        options.onCreateStep?.('after-checkpoint');
        syncFile(path.join(targetDirectory, 'events.jsonl'));
        syncFile(path.join(checkpointRoot, checkpointName));
        syncDirectory(checkpointRoot);
        syncDirectory(targetDirectory);
        options.onCreateStep?.('before-publish');
        fs.linkSync(stagedSession, path.join(targetDirectory, 'session.json'));
        published = true;
        syncDirectory(targetDirectory);
        syncDirectory(base);
        options.onCreateStep?.('after-publish');
        return session;
      } finally {
        if (reserved && !published) fs.rmSync(targetDirectory, { recursive: true, force: true });
        fs.rmSync(staging, { recursive: true, force: true });
      }
    },
    read(id, options = {}) {
      const target = path.join(directory(id), 'session.json');
      publishedCompanions(id);
      try {
        return parseSession(fs.readFileSync(target, 'utf8'), id, id);
      }
      catch (error) {
        if (options.recover === true) return recover(id);
        throw error;
      }
    },
    compareAndSwap(id, expectedDigest, next) {
      checkedId(id);
      if (next?.id !== id) throw usageError('Delivery session compare-and-swap cannot change the session id.');
      const current = store.read(id);
      if (digestSession(current) !== expectedDigest) throw usageError(`Delivery session ${id} compare-and-swap conflict.`);
      writeCheckpoint(id, next);
      writeAtomicFile(path.join(directory(id), 'session.json'), serialized(next));
      return next;
    },
    appendEvent(id, event) {
      checkedId(id);
      if (!event || typeof event !== 'object' || !SESSION_ID.test(event.id ?? '')) throw usageError('Delivery session event requires a safe id.');
      const eventLine = JSON.stringify(event);
      if (typeof eventLine !== 'string' || Buffer.byteLength(eventLine, 'utf8') + 1 > MAX_EVENT_BYTES) throw usageError('Delivery session event exceeds the bounded record size.');
      store.read(id);
      const target = path.join(directory(id), 'events.jsonl');
      const records = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { throw usageError(`Unreadable delivery session ${id} event log.`); }
      });
      if (records.some((record) => record.id === event.id)) throw usageError(`Duplicate event id ${event.id}.`);
      const next = [...records, event].slice(-MAX_EVENTS).map((record) => JSON.stringify(record));
      let totalBytes = next.reduce((total, line) => total + Buffer.byteLength(line, 'utf8') + 1, 0);
      while (totalBytes > MAX_EVENT_LOG_BYTES) totalBytes -= Buffer.byteLength(next.shift(), 'utf8') + 1;
      writeAtomicFile(target, next.join('\n') + '\n');
      return event;
    },
    list() {
      assertNoLinkAncestor(realRoot, baseRelative);
      if (!lstatSafe(base)) return [];
      return fs.readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name))
        .filter((entry) => lstatSafe(path.join(base, entry.name, 'session.json')) !== null)
        .map((entry) => store.read(entry.name))
        .sort((left, right) => left.id.localeCompare(right.id));
    },
  };
  return Object.freeze(store);
}

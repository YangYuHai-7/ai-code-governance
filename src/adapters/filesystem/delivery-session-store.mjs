import fs from 'node:fs';
import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';
import { assertNoLinkAncestor } from './repository-state.mjs';
import { createExclusiveFile, lstatSafe, writeAtomicFile } from './files.mjs';

const VOLATILE = ['createdAt', 'updatedAt', 'recordedAt', 'evaluatedAt'];
const SESSION_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_EVENTS = 1024;
const MAX_CHECKPOINTS = 16;

function digestSession(session) { return canonicalValueDigest(session, { omit: VOLATILE }); }
function serialized(value) { return `${JSON.stringify(value, null, 2)}\n`; }

function checkedId(id) {
  if (typeof id !== 'string' || !SESSION_ID.test(id)) throw usageError('Invalid delivery session id.');
  return id;
}

function parseSession(text, label) {
  let value;
  try { value = JSON.parse(text); } catch { throw usageError(`Unreadable delivery session ${label}.`); }
  if (!value || typeof value !== 'object' || value.schemaVersion !== 1 || !SESSION_ID.test(value.id ?? '')) throw usageError(`Unreadable delivery session ${label}.`);
  return value;
}

export function openDeliverySessionStore(root) {
  const realRoot = fs.realpathSync(root);
  const baseRelative = '.ai-governance/state/delivery-sessions';
  const base = path.join(realRoot, baseRelative);

  function directory(id) {
    checkedId(id);
    assertNoLinkAncestor(realRoot, `${baseRelative}/${id}`);
    return path.join(base, id);
  }

  function checkpointDirectory(id) { return path.join(directory(id), 'checkpoints'); }

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
      try { return parseSession(fs.readFileSync(path.join(checkpointRoot, file), 'utf8'), `${id} checkpoint`); } catch { /* try the previous durable checkpoint */ }
    }
    throw usageError(`Unreadable delivery session ${id}; no durable checkpoint is available.`);
  }

  const store = {
    create(session) {
      checkedId(session?.id);
      const targetDirectory = directory(session.id);
      fs.mkdirSync(targetDirectory, { recursive: true });
      const target = path.join(targetDirectory, 'session.json');
      if (!createExclusiveFile(target, serialized(session))) throw usageError(`Delivery session ${session.id} already exists.`);
      createExclusiveFile(path.join(targetDirectory, 'events.jsonl'), '');
      writeCheckpoint(session.id, session);
      return session;
    },
    read(id, options = {}) {
      const target = path.join(directory(id), 'session.json');
      try { return parseSession(fs.readFileSync(target, 'utf8'), id); }
      catch (error) {
        if (options.recover === true) return recover(id);
        if (error.code === 'ENOENT') throw usageError(`Delivery session ${id} does not exist.`);
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
      store.read(id);
      const target = path.join(directory(id), 'events.jsonl');
      const records = fs.readFileSync(target, 'utf8').split('\n').filter(Boolean).map((line) => {
        try { return JSON.parse(line); } catch { throw usageError(`Unreadable delivery session ${id} event log.`); }
      });
      if (records.some((record) => record.id === event.id)) throw usageError(`Duplicate event id ${event.id}.`);
      const next = [...records, event].slice(-MAX_EVENTS);
      writeAtomicFile(target, next.map((record) => JSON.stringify(record)).join('\n') + '\n');
      return event;
    },
    list() {
      assertNoLinkAncestor(realRoot, baseRelative);
      if (!lstatSafe(base)) return [];
      return fs.readdirSync(base, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && SESSION_ID.test(entry.name))
        .map((entry) => store.read(entry.name))
        .sort((left, right) => left.id.localeCompare(right.id));
    },
  };
  return Object.freeze(store);
}

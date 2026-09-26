import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { writeAtomicFile } from '../src/adapters/filesystem/files.mjs';

function fixture(context) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-atomic-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

function temporaryFiles(directory) {
  return fs.readdirSync(directory).filter((entry) => entry.endsWith('.tmp'));
}

// Renaming onto a brand-new name is the happy path and must not leave staging files behind.
test('an atomic write to a fresh target leaves no staging file', (context) => {
  const root = fixture(context);
  const target = path.join(root, 'report.json');
  assert.equal(writeAtomicFile(target, '{"a":1}\n'), true);
  assert.equal(fs.readFileSync(target, 'utf8'), '{"a":1}\n');
  assert.deepEqual(temporaryFiles(root), []);
});

// Sandbox seatbelts and Windows file locks refuse to replace an existing file through rename.
// The write must still land, and the environment failure must stay visible as `renameError`
// rather than being swallowed or replaced by a misleading unlink error.
test('a destination that refuses rename is still overwritten and the refusal stays visible', (context) => {
  const root = fixture(context);
  const target = path.join(root, 'report.json');
  fs.writeFileSync(target, '{"a":1}\n');

  const original = fs.renameSync;
  const observed = [];
  fs.renameSync = (from, to) => {
    observed.push([from, to]);
    const error = new Error('EPERM: operation not permitted, rename');
    error.code = 'EPERM';
    throw error;
  };
  try {
    assert.equal(writeAtomicFile(target, '{"a":2}\n'), true);
  } finally {
    fs.renameSync = original;
  }

  assert.equal(observed.length, 1, 'rename must be attempted before any fallback');
  assert.equal(fs.readFileSync(target, 'utf8'), '{"a":2}\n', 'the staged bytes must reach the destination');
  assert.deepEqual(temporaryFiles(root), [], 'the fallback must consume its staging file');
});

// `mode` describes the destination, so the fallback path has to apply it too — otherwise hooks
// written through this path would silently lose their executable bit.
test('a rename-resistant destination still receives the requested mode', (context) => {
  const root = fixture(context);
  const target = path.join(root, 'hook.sh');
  fs.writeFileSync(target, '#!/bin/sh\n');
  fs.chmodSync(target, 0o644);

  const original = fs.renameSync;
  fs.renameSync = () => {
    const error = new Error('EBUSY: resource busy or locked, rename');
    error.code = 'EBUSY';
    throw error;
  };
  try {
    writeAtomicFile(target, '#!/bin/sh\necho ok\n', 0o755);
  } finally {
    fs.renameSync = original;
  }

  assert.equal(fs.readFileSync(target, 'utf8'), '#!/bin/sh\necho ok\n');
  if (process.platform !== 'win32') assert.equal(fs.statSync(target).mode & 0o777, 0o755);
});

// A directory in the destination slot is not an "environment refuses to replace" case. Falling
// back to a byte copy would fail obscurely, so the original rename error must surface intact.
test('a directory destination is reported as the rename failure, not as a copy failure', (context) => {
  const root = fixture(context);
  const target = path.join(root, 'nested');
  fs.mkdirSync(target);

  const original = fs.renameSync;
  fs.renameSync = () => {
    const error = new Error('EISDIR: illegal operation on a directory, rename');
    error.code = 'EISDIR';
    throw error;
  };
  try {
    assert.throws(() => writeAtomicFile(target, 'x'), (error) => error.code === 'EISDIR');
  } finally {
    fs.renameSync = original;
  }
  assert.deepEqual(temporaryFiles(root), [], 'a rejected write must not orphan staging files');
});

// Staging failures are ordinary write failures: no fallback, no masking, no residue.
test('a staging failure is rethrown and cleaned up', (context) => {
  const root = fixture(context);
  const target = path.join(root, 'report.json');

  const original = fs.writeFileSync;
  fs.writeFileSync = (file, ...rest) => {
    if (String(file).endsWith('.tmp')) {
      const error = new Error('ENOSPC: no space left on device, write');
      error.code = 'ENOSPC';
      throw error;
    }
    return original.call(fs, file, ...rest);
  };
  try {
    assert.throws(() => writeAtomicFile(target, 'x'), (error) => error.code === 'ENOSPC');
  } finally {
    fs.writeFileSync = original;
  }
  assert.equal(fs.existsSync(target), false);
  assert.deepEqual(temporaryFiles(root), []);
});

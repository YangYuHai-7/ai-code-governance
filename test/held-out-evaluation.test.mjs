import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { loadHeldOutEvaluationSet } from '../src/modules/evaluation/index.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const providerRoot = path.join(testRoot, '..', 'test-support/fixtures/golden-path/held-out-provider');

function temporaryCopy() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-held-out-'));
  fs.cpSync(providerRoot, root, { recursive: true });
  return root;
}

test('a closed provider manifest loads with verified case digests', () => {
  const set = loadHeldOutEvaluationSet(providerRoot);
  assert.equal(set.schemaVersion, 1);
  assert.equal(set.cases.length, 2);
  assert.match(set.sourceDigest, /^[a-f0-9]{64}$/);
  for (const entry of set.cases) {
    assert.match(entry.repositoryDigest, /^[a-f0-9]{64}$/);
    assert.match(entry.requirementDigest, /^[a-f0-9]{64}$/);
    assert.match(entry.inputDigest, /^[a-f0-9]{64}$/);
    assert.ok(entry.platforms.length > 0);
    assert.equal(typeof entry.structurallyDistinct, 'boolean');
  }
  assert.ok(Object.isFrozen(set));
  assert.ok(Object.isFrozen(set.cases));
});

test('declared and actual case digests must match', () => {
  const root = temporaryCopy();
  try {
    const manifestPath = path.join(root, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.cases[0].repositoryDigest = 'f'.repeat(64);
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(root), /digest/i);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('escaping paths, duplicate case ids, and unknown fields are rejected', () => {
  const escaping = temporaryCopy();
  try {
    const manifestPath = path.join(escaping, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.cases[1].repository = '../outside';
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(escaping), /path/i);
  } finally { fs.rmSync(escaping, { recursive: true, force: true }); }

  const duplicated = temporaryCopy();
  try {
    const manifestPath = path.join(duplicated, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.cases[1].id = manifest.cases[0].id;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(duplicated), /duplicate/i);
  } finally { fs.rmSync(duplicated, { recursive: true, force: true }); }

  const unknown = temporaryCopy();
  try {
    const manifestPath = path.join(unknown, 'manifest.json');
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    manifest.extra = true;
    fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
    assert.throws(() => loadHeldOutEvaluationSet(unknown), /extra/);
  } finally { fs.rmSync(unknown, { recursive: true, force: true }); }
});

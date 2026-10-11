import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = fs.readFileSync(path.join(root, 'scripts/golden-path-live-concurrency.mjs'), 'utf8');
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'test-support/evaluations/golden-path/receipts/macos-concurrency.json'), 'utf8'));

// A lost update only shows up with several processes against one database. This pins the committed
// check and the receipt it produced, so the defense cannot regress to a single-process claim.
test('the committed concurrency check drives several processes and one shared database', () => {
  assert.match(script, /this check requires every API process to be serving/);
  assert.match(script, /AND version|expectedVersion: 1/);
  assert.match(script, /refused === writers - 1/);
  assert.match(script, /audits === 1/);
});

test('the recorded outcome is one winner, one version increment, and one audit row', () => {
  assert.equal(receipt.passed, true);
  assert.ok(receipt.processes >= 2);
  assert.equal(receipt.accepted, 1);
  assert.equal(receipt.refused, receipt.writers - 1);
  assert.equal(receipt.version, 2);
  assert.equal(receipt.audits, 1);
});

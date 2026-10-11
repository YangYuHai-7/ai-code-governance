import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'test-support/evaluations/golden-path/receipts/macos-probe-detection.json'), 'utf8'));
const roadmap = fs.readFileSync(path.join(root, 'docs/internal/reference/roadmap.md'), 'utf8');

test('executed probe detection is recorded, and its gaps are not smoothed over', () => {
  assert.equal(receipt.length, 14);
  const detected = receipt.filter((probe) => probe.detected);
  assert.equal(detected.length, 4);
  assert.deepEqual(detected.map((probe) => probe.faultId).sort(), ['cross-tenant-access', 'domain-framework-import', 'missing-acceptance-test', 'transaction-leak']);
  assert.ok(receipt.every((probe) => probe.detected === (probe.detectedBy.length > 0)));
});

test('the roadmap states the probe coverage gap instead of claiming full coverage', () => {
  assert.match(roadmap, /Negative probe coverage \(executed, incomplete\)/);
  assert.match(roadmap, /detects \*\*four\*\*/);
  assert.match(roadmap, /ten are not caught by the gates that declare them/);
  assert.match(roadmap, /declared negative-probe coverage is materially weaker than the Pack advertises/);
});

test('the probe receipt carries no host paths', () => {
  assert.ok(!/\/Users\/|\/private\/|\/var\/folders/.test(JSON.stringify(receipt)));
});

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
  assert.equal(receipt.length, 14);
  assert.equal(detected.length, 14);
  assert.deepEqual(detected.map((probe) => probe.faultId).sort(), ['contract-drift', 'cross-layer-import', 'cross-tenant-access', 'domain-framework-import', 'failed-migration', 'interrupted-resume-drift', 'lost-update', 'missing-acceptance-test', 'omitted-gate', 'private-feature-import', 'stale-evidence', 'transaction-leak', 'unauthorized-path', 'unsafe-dto-actor']);
  assert.ok(receipt.every((probe) => probe.detected === (probe.detectedBy.length > 0)));
});

test('the roadmap states the probe coverage gap instead of claiming full coverage', () => {
  assert.match(roadmap, /Negative probe coverage \(executed, incomplete\)/);
  assert.match(roadmap, /detects \*\*all fourteen\*\*/);
  assert.match(roadmap, /the workload's own architecture gate was a hand-written token list/i);
  assert.match(roadmap, /reports such a path as an authority violation/);
  assert.match(roadmap, /declared negative-probe coverage is materially weaker than the Pack advertises/);
});

test('the probe receipt carries no host paths', () => {
  assert.ok(!/\/Users\/|\/private\/|\/var\/folders/.test(JSON.stringify(receipt)));
});

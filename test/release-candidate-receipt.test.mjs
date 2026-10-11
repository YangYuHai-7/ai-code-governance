import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'docs/internal/validation/receipts/macos-release-candidate.json'), 'utf8'));

// The published verification receipt has to stay honest: it records the steps that actually ran on one
// host, and it must never be read as cross-platform, Agent, held-out, or qualified-human evidence.
test('the release candidate verification receipt records the real chain', () => {
  const steps = receipt.steps.map((entry) => entry.step);
  for (const step of ['test:full', 'validate', 'smoke', 'smoke:package', 'prepublish-check']) assert.ok(steps.includes(step), step);
  assert.ok(receipt.steps.every((entry) => entry.exit === 0));
  assert.equal(receipt.passed, true);
  assert.equal(receipt.platform, 'darwin');
  assert.match(receipt.note, /not cross-platform evidence/);
  assert.match(receipt.note, /no Agent, held-out, or qualified-human evidence is implied/);
  assert.ok(!/\/Users\/|\/private\/|\/var\/folders/.test(JSON.stringify(receipt)));
});

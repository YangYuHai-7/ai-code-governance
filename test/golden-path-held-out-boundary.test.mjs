import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const provider = path.join(root, 'test-support/fixtures/golden-path/held-out-provider');
const manifest = JSON.parse(fs.readFileSync(path.join(provider, 'manifest.json'), 'utf8'));

// The implementation side cannot manufacture its own held-out evidence. These assertions keep the
// placeholder honest: as long as the cases are skeletons on one platform, no held-out receipt may be
// claimed from them, and nobody may quietly promote the placeholder into certification input.
test('the committed held-out cases are placeholders, not executable repositories', () => {
  for (const entry of manifest.cases) {
    const repo = path.join(provider, entry.repository);
    const files = fs.readdirSync(repo);
    assert.ok(files.length > 0);
    assert.ok(!files.includes('package.json'), `${entry.id} must not look executable`);
    const requirement = JSON.parse(fs.readFileSync(path.join(provider, entry.requirement), 'utf8'));
    assert.equal(requirement.actors, undefined);
    assert.equal(requirement.acceptanceScenarios, undefined);
  }
});

test('the placeholder declares one platform and no held-out receipt is committed', () => {
  const platforms = [...new Set(manifest.cases.flatMap((entry) => entry.platforms ?? []))].sort();
  assert.deepEqual(platforms, ['linux']);
  const receipts = fs.readdirSync(path.join(root, 'test-support/evaluations/golden-path/receipts'));
  assert.deepEqual(receipts.filter((name) => name.includes('held-out')), []);
});

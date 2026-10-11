import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const runbook = fs.readFileSync(path.join(root, 'docs/internal/validation/golden-path-cross-os-runbook.md'), 'utf8');

// The runbook has to name the operational inputs a real host needs; discovering them by failing is
// how the first attempts went, and none of them may be dropped from the written procedure.
test('the runbook names every operational prerequisite the evaluation actually needs', () => {
  for (const token of ['PSQL_BIN', 'PGHOST', 'npm ci', 'playwright install chromium', 'AICG_LIVE_API', 'AICG_LIVE_WEB', 'AICG_ROOT', 'os.tmpdir()', '.cmd', 'per platform']) {
    assert.ok(runbook.includes(token), `the runbook must mention ${token}`);
  }
  assert.match(runbook, /refuses the evaluation instead of publishing a receipt/);
  assert.match(runbook, /a quality matrix run is not an evaluation receipt/);
});

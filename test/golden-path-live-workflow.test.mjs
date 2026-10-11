import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const workflow = fs.readFileSync(path.join(testRoot, '..', '.github/workflows/golden-path-evaluation.yml'), 'utf8');
const reference = fs.readFileSync(path.join(testRoot, '..', 'scripts/golden-path-reference-evaluation.mjs'), 'utf8');
const live = fs.readFileSync(path.join(testRoot, '..', 'scripts/golden-path-live-evaluation.mjs'), 'utf8');

test('the manual evaluation workflow refuses a host that cannot execute the gates', () => {
  assert.match(workflow, /Verify this runner can inspect reality/);
  assert.match(workflow, /needs a provisioned host/);
  assert.match(workflow, /exit 1/);
});

test('the manual evaluation workflow runs the live drivers and validates a matrix run', () => {
  assert.match(workflow, /scripts\/golden-path-live-evaluation\.mjs/);
  assert.doesNotMatch(workflow, /node scripts\/golden-path-reference-evaluation\.mjs --fixture/);
  assert.match(workflow, /validateQualityMatrixRun/);
  assert.doesNotMatch(workflow, /validateGoldenPathEvaluation/);
});

test('the reference harness keeps its work root portable and the live harness resolves executables per platform', () => {
  assert.match(reference, /fs\.mkdtempSync\(path\.join\(os\.tmpdir\(\)/);
  assert.doesNotMatch(reference, /process\.env\.TMPDIR/);
  assert.match(live, /process\.platform === 'win32'/);
  assert.match(live, /playwright\.cmd/);
});

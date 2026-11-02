import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const handover = fs.readFileSync(path.join(root, 'docs/internal/validation/golden-path-e4-handover.md'), 'utf8');

// The handover is the actionable form of "what is missing": each external input, how to produce it,
// and what must come back. It may not quietly drop an input or claim one is already satisfied.
test('the E4 handover names every external input with its command and acceptance', () => {
  for (const heading of ['1. Evaluation receipts for each remaining claimed platform', '2. Evaluator-owned held-out cases', '3. Qualified human acceptance', 'Historical E3 evidence and current gap']) {
    assert.ok(handover.includes(heading), heading);
  }
  for (const token of ['golden-path-live-evaluation.mjs', 'validateQualityMatrixRun', 'runHeldOutEvaluationSet', 'macos-codex-e3.json', 'applyQualifiedUserEvidence', 'missing-qualified-human', 'golden-path-qualified-user-protocol.md']) {
    assert.ok(handover.includes(token), token);
  }
  assert.match(handover, /does not clear `missing-e3`/);
  assert.match(handover, /AI review is not qualified-human evidence/);
  assert.match(handover, /Do not author these cases inside this repository/);
  assert.match(handover, /historical E3.*latest matrix/i);
});

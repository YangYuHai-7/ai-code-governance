import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const roadmap = fs.readFileSync(path.join(testRoot, '..', 'docs/internal/reference/roadmap.md'), 'utf8');

test('the roadmap publishes an evaluator-derived status that cannot drift silently', () => {
  assert.match(roadmap, /Current execution status \(evaluator-derived\)/);
  assert.match(roadmap, /Milestone 1 \(Core semantic and runtime foundation\): complete/);
  assert.match(roadmap, /Milestone 2 \(one production-capable golden path\): evidence-incomplete/);
  assert.match(roadmap, /Milestone 3[^\n]*not authorized/i);
  for (const code of ['missing-e3', 'missing-held-out-case', 'missing-qualified-human', 'platform-missing']) {
    assert.ok(roadmap.includes(code), code);
  }
  for (const gate of ['evaluateGoldenPathCertification', 'publicationDecision', 'derivePackMaturity', 'applyQualifiedUserEvidence']) {
    assert.ok(roadmap.includes(gate), gate);
  }
});

test('the priority defect register records the closure state of every P2 item', () => {
  assert.match(roadmap, /Priority defect register closure/);
  for (const item of ['P2-001', 'P2-002', 'P2-003', 'P2-004']) assert.ok(roadmap.includes(item), item);
  assert.match(roadmap, /P2-004[^\n]*Phase B/);
  assert.match(roadmap, /candidate review/);
});

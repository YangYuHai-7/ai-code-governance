import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { canonicalContractDigest } from '../src/modules/delivery-core/index.mjs';
import { evaluateGoldenPathCertification } from '../src/modules/evaluation/index.mjs';
import { loadGoldenPathPack } from '../src/modules/stack-packs/index.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(testRoot, '..');
const fixture = 'test-support/evaluations/golden-path/reference-work-tracker';
const receipt = JSON.parse(fs.readFileSync(path.join(root, 'test-support/evaluations/golden-path/receipts/macos-live-matrix.json'), 'utf8'));

// Real executed evidence is still not a certification: the matrix receipt proves the golden path ran
// on one host, and the certification gate must keep naming every input that is still missing.
test('a single-host matrix receipt never yields a certification verdict', () => {
  const pack = loadGoldenPathPack('react-mantine-nest-fastify-drizzle-postgresql');
  const requirement = JSON.parse(fs.readFileSync(path.join(root, fixture, 'expected-requirement.json'), 'utf8'));
  const result = evaluateGoldenPathCertification({
    pack,
    referenceDigests: {
      pack: receipt.digests.pack,
      requirement: canonicalContractDigest('requirement', requirement),
      repository: receipt.digests.repository,
      environment: receipt.digests.environment,
    },
    platformPolicy: { claimed: ['linux', 'darwin', 'win32'], informational: ['win32'] },
    thresholdPolicy: { minimumHeldOutCases: 2 },
    evaluationReceipts: [],
    now: new Date().toISOString(),
  });
  const codes = result.gaps.map((gap) => gap.code);
  assert.equal(result.status, 'incomplete');
  assert.notEqual(result.evidenceLevel, 'E4-golden-path-certified');
  for (const code of ['missing-e3', 'missing-held-out-case', 'insufficient-held-out-cases', 'missing-qualified-human', 'missing-negative-probes', 'platform-missing:linux', 'platform-missing:win32']) {
    assert.ok(codes.includes(code), `${code} must be reported`);
  }
});

test('the committed matrix receipt proves execution, not certification', () => {
  assert.equal(receipt.status, 'passed');
  assert.equal(receipt.gates.length, 14);
  assert.ok(receipt.gates.every((gate) => gate.status === 'passed' && Array.isArray(gate.artifacts)));
  assert.match(receipt.note, /not cross-platform, held-out, real-Agent, or qualified-human evidence/);
  assert.ok(!/\/Users\/|\/tmp\/|\/private\//.test(JSON.stringify(receipt)));
});

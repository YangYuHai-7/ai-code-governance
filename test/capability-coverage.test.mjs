import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { summarizeCapabilityCoverage, validateCapabilityCoverage } from '../src/modules/capabilities/coverage.mjs';

const testRoot = path.dirname(fileURLToPath(import.meta.url));
const registry = JSON.parse(fs.readFileSync(path.join(testRoot, '..', 'assets/registries/capability-pack-registry.json'), 'utf8'));

function pack(overrides = {}) {
  return {
    id: 'frontend-fixture', family: 'frontend', release: 'v1', lifecycle: 'active', evidence: 'unverified',
    detect: { requiredPackages: ['react'] },
    coverage: { detectionSupport: 'supported', standardSkillCoverage: 'partial', scenarioEvidence: 'synthetic-only', coveredPackages: ['react'], gaps: ['real-project evidence'] },
    ...overrides,
  };
}
const withPack = (entry) => ({ ...registry, packs: [entry] });

test('the shipped registry validates clean and yields a derived summary', () => {
  const result = validateCapabilityCoverage({ registry });
  assert.equal(result.status, 'clean');
  assert.deepEqual(result.findings, []);
  const summary = summarizeCapabilityCoverage({ registry, evaluationRecords: [] });
  assert.equal(summary.length, registry.packs.length);
  for (const entry of summary) {
    assert.ok(entry.id);
    assert.ok(['detected', 'guided', 'executable', 'certified', 'unverified'].includes(entry.maturityCandidate));
    assert.ok(Array.isArray(entry.gaps));
  }
});

test('a real-project coverage claim cannot stand on unverified evidence', () => {
  const result = validateCapabilityCoverage({ registry: withPack(pack({ coverage: { ...pack().coverage, scenarioEvidence: 'real-project' } })) });
  assert.equal(result.status, 'drifted');
  assert.ok(result.findings.some((finding) => finding.code === 'coverage-evidence-drift'));
});

test('a verified claim requires a current evaluation record', () => {
  const verified = withPack(pack({ evidence: 'verified', coverage: { ...pack().coverage, scenarioEvidence: 'real-project', gaps: [] } }));
  assert.ok(validateCapabilityCoverage({ registry: verified }).findings.some((finding) => finding.code === 'missing-evaluation-record'));
  assert.equal(validateCapabilityCoverage({ registry: verified, evaluationRecords: [{ packId: 'frontend-fixture', level: 'E4-golden-path-certified' }] }).status, 'clean');
});

test('coverage cannot contradict detection or hide partial coverage', () => {
  const driftedDetection = validateCapabilityCoverage({ registry: withPack(pack({ coverage: { ...pack().coverage, coveredPackages: ['react', 'svelte'] } })) });
  assert.ok(driftedDetection.findings.some((finding) => finding.code === 'coverage-detection-drift'));
  const hiddenGaps = validateCapabilityCoverage({ registry: withPack(pack({ coverage: { ...pack().coverage, gaps: [] } })) });
  assert.ok(hiddenGaps.findings.some((finding) => finding.code === 'undeclared-coverage-gaps'));
  const badEvidence = validateCapabilityCoverage({ registry: withPack(pack({ evidence: 'totally-verified' })) });
  assert.ok(badEvidence.findings.some((finding) => finding.code === 'unsupported-evidence-level'));
});

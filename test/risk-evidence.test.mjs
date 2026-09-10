import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import test from 'node:test';
import { defaultConfig } from '../src/generator.mjs';
import { scanProject } from '../src/scanner.mjs';
import { evaluateRiskEvidence, requiredRiskProbeIds, riskEvidenceFingerprint } from '../src/modules/completion/index.mjs';

const CASES = [
  ['sensitive-data', 'webhook-secret-missing'],
  ['sensitive-data', 'vault-default-token'],
  ['authorization', 'body-actor-identity'],
  ['multi-tenancy', 'inactive-membership'],
  ['payment', 'canceled-invoice-settlement'],
  ['data-consistency', 'multi-instance-lost-update'],
];
const FIXTURE_ROOT = path.resolve('test/fixtures/risk-evidence');

function evidenceFixture(riskId, variant) {
  return JSON.parse(fs.readFileSync(path.join(FIXTURE_ROOT, `${riskId}.${variant}.json`), 'utf8'));
}

function runEvidenceFixture(riskId, variant) {
  const fixture = evidenceFixture(riskId, variant);
  const [runtime, script, fixtureRiskId, fixtureVariant, ...extra] = fixture.entrypoint.split(' ');
  assert.deepEqual({ runtime, fixtureRiskId, fixtureVariant, extra }, { runtime: 'node', fixtureRiskId: riskId, fixtureVariant: variant, extra: [] });
  const result = spawnSync(process.execPath, [path.join(FIXTURE_ROOT, script), fixtureRiskId, fixtureVariant], { encoding: 'utf8' });
  assert.equal(result.status, fixture.expectedExitCode, `${result.stdout}\n${result.stderr}`);
  const line = result.stdout.split(/\r?\n/).find((candidate) => candidate.startsWith('AICG_RISK_PROBE '));
  assert.ok(line, `Missing risk probe marker:\n${result.stdout}\n${result.stderr}`);
  const marker = JSON.parse(line.slice('AICG_RISK_PROBE '.length));
  assert.equal(marker.riskId, riskId);
  assert.equal(marker.variant, variant);
  return { fixture, result, marker };
}

function fixture(name) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `aicg-risk-evidence-${name}-`));
}

function configure(root, signal) {
  fs.mkdirSync(path.join(root, '.ai-governance'), { recursive: true });
  fs.mkdirSync(path.join(root, 'src', 'modules', 'app'), { recursive: true });
  fs.writeFileSync(path.join(root, 'src', 'modules', 'app', 'index.ts'), 'export const app = true;\n');
  const scan = scanProject(root);
  const config = {
    ...defaultConfig(scan),
    domainConstraints: [`Owner constraint for ${signal}.`],
    confirmedRiskSignals: [signal],
  };
  fs.writeFileSync(path.join(root, '.ai-governance', 'config.json'), `${JSON.stringify(config, null, 2)}\n`);
  return { config, scan: scanProject(root) };
}

for (const [signal, riskId] of CASES) {
  test(`${riskId} vulnerable evidence blocks and repaired negative/recovery evidence is recorded-unverified`, (context) => {
    const root = fixture(riskId);
    context.after(() => fs.rmSync(root, { recursive: true, force: true }));
    const { config, scan } = configure(root, signal);
    const fingerprint = riskEvidenceFingerprint(scan, config);
    const vulnerableProbe = runEvidenceFixture(riskId, 'vulnerable');
    const repairedProbe = runEvidenceFixture(riskId, 'repaired');
    assert.equal(vulnerableProbe.marker.outcome, 'blocked');
    assert.equal(repairedProbe.marker.outcome, 'passed');
    assert.ok(vulnerableProbe.marker.diagnostic);
    assert.ok(repairedProbe.marker.negativeDiagnostic);
    assert.ok(repairedProbe.marker.recoveryEvidence);
    const evidencePath = path.join(root, 'docs', 'ai', 'risk-evidence.json');
    fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
    const base = {
      schemaVersion: 1,
      owner: 'product-owner',
      source: 'owner-confirmed',
      risks: requiredRiskProbeIds(config).map((requiredId) => requiredId === riskId ? {
          riskId,
          applicability: 'applicable',
          reason: `${riskId} applies to the confirmed ${signal} boundary.`,
          status: 'blocked',
          entrypoint: vulnerableProbe.fixture.entrypoint,
          negativeDiagnostic: `exitCode=${vulnerableProbe.result.status}; ${vulnerableProbe.marker.diagnostic}`,
          recoveryEvidence: `Recovery did not run because the vulnerable probe exited ${vulnerableProbe.result.status}.`,
          sourceFingerprint: fingerprint,
          evidenceLevel: 'project-local-unverified',
        } : {
          riskId: requiredId,
          applicability: 'not-applicable',
          reason: `${requiredId} does not apply to this fixture variant.`,
          status: 'not-applicable',
          sourceFingerprint: fingerprint,
          evidenceLevel: 'project-local-unverified',
        }),
    };
    fs.writeFileSync(evidencePath, JSON.stringify(base));
    const vulnerable = evaluateRiskEvidence(scanProject(root));
    assert.equal(vulnerable.status, 'incomplete');

    const repairedRecord = base.risks.find((record) => record.riskId === riskId);
    repairedRecord.status = 'passed';
    repairedRecord.entrypoint = repairedProbe.fixture.entrypoint;
    repairedRecord.negativeDiagnostic = `exitCode=${repairedProbe.result.status}; ${repairedProbe.marker.negativeDiagnostic}`;
    repairedRecord.recoveryEvidence = repairedProbe.marker.recoveryEvidence;
    fs.writeFileSync(evidencePath, JSON.stringify(base));
    const repaired = evaluateRiskEvidence(scanProject(root));
    assert.equal(repaired.status, 'recorded-unverified');
    assert.equal(repaired.covered, repaired.required);
  });
}

test('risk evidence rejects certified simulation, stale fingerprints, duplicates, and unexplained not-applicable records', (context) => {
  const root = fixture('invalid-shapes');
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const { config, scan } = configure(root, 'authorization');
  const fingerprint = riskEvidenceFingerprint(scan, config);
  const evidencePath = path.join(root, 'docs', 'ai', 'risk-evidence.json');
  fs.mkdirSync(path.dirname(evidencePath), { recursive: true });
  const record = {
    riskId: 'body-actor-identity', applicability: 'not-applicable', reason: '', sourceFingerprint: fingerprint,
    evidenceLevel: 'certified',
  };
  fs.writeFileSync(evidencePath, JSON.stringify({
    schemaVersion: 1,
    owner: 'product-owner',
    source: 'owner-confirmed',
    risks: [record, { ...record, sourceFingerprint: '0'.repeat(64) }],
  }));
  const result = evaluateRiskEvidence(scanProject(root));
  assert.equal(result.status, 'invalid');
  assert.match(result.issues.join('\n'), /duplicate/);
  assert.match(result.issues.join('\n'), /reason/);
  assert.match(result.issues.join('\n'), /certified/);
  assert.match(result.issues.join('\n'), /sourceFingerprint/);
});

import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  certificationEvidenceStatus,
  exportCertificationEvidence,
  readCertificationReceiptInput,
  recordCertificationEvidence,
  validateCertificationReceipt,
} from '../src/evidence.mjs';

function fixture() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-certification-evidence-'));
}

function receipt(overrides = {}) {
  return {
    schemaVersion: 1,
    id: 'u01-novice-task-app',
    evidenceKind: 'simulated-persona',
    toolVersion: '0.2.0',
    candidateFingerprint: 'a'.repeat(64),
    packId: 'generic-unknown',
    projectMode: 'greenfield',
    os: 'macos',
    agent: 'codex',
    durationMs: 1200,
    outcome: 'pass',
    anonymized: true,
    sourceCodeIncluded: false,
    verification: ['npm test', 'aicg check .'],
    findings: [],
    experience: { installation: 4, clarity: 3, nextStep: 3, recovery: 4, confidence: 3 },
    reviewers: [{ role: 'quality-reviewer', independent: true }],
    acknowledgements: [{ kind: 'none', reason: 'No acknowledgement was required.' }],
    ...overrides,
  };
}

test('simulated persona receipts remain unverified and never count as real certification', () => {
  const root = fixture();
  try {
    const verified = validateCertificationReceipt(receipt());
    assert.equal(verified.qualification, 'simulation-only');
    recordCertificationEvidence(root, verified);
    assert.deepEqual(certificationEvidenceStatus(root), {
      schemaVersion: 1,
      claimState: 'unverified',
      receiptCount: 1,
      byKind: { 'simulated-persona': 1, 'real-project': 0 },
      byOutcome: { pass: 1, fail: 0, blocked: 0 },
      eligibleForHumanCertificationReview: 0,
      certified: false,
      boundary: 'AICG does not automatically promote receipts or simulated personas to certified status.',
    });
    assert.equal(exportCertificationEvidence(root).receipts[0].sourceCodeIncluded, false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('receipt input must stay repository-local and cannot traverse a symlink', () => {
  const root = fixture();
  const outside = fixture();
  try {
    fs.writeFileSync(path.join(outside, 'receipt.json'), JSON.stringify(receipt()));
    fs.symlinkSync(outside, path.join(root, 'linked'));
    assert.throws(() => readCertificationReceiptInput(root, 'linked/receipt.json'), /symbolic link/);
    assert.throws(() => readCertificationReceiptInput(root, '../receipt.json'), /safe repository-relative/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('certification ledger status and export reject linked files and linked ancestors', () => {
  const outside = fixture();
  const linkedFileRoot = fixture();
  const linkedAncestorRoot = fixture();
  try {
    const outsideLedger = path.join(outside, 'certification-evidence.json');
    fs.writeFileSync(outsideLedger, JSON.stringify({ schemaVersion: 1, claimState: 'unverified', receipts: [] }));

    fs.mkdirSync(path.join(linkedFileRoot, 'docs', 'ai'), { recursive: true });
    fs.symlinkSync(outsideLedger, path.join(linkedFileRoot, 'docs', 'ai', 'certification-evidence.json'));
    assert.throws(() => certificationEvidenceStatus(linkedFileRoot), /symbolic link/);
    assert.throws(() => exportCertificationEvidence(linkedFileRoot), /symbolic link/);

    fs.mkdirSync(path.join(outside, 'ai'), { recursive: true });
    fs.writeFileSync(path.join(outside, 'ai', 'certification-evidence.json'), JSON.stringify({ schemaVersion: 1, claimState: 'unverified', receipts: [] }));
    fs.symlinkSync(outside, path.join(linkedAncestorRoot, 'docs'));
    assert.throws(() => certificationEvidenceStatus(linkedAncestorRoot), /symbolic link/);
    assert.throws(() => exportCertificationEvidence(linkedAncestorRoot), /symbolic link/);
  } finally {
    fs.rmSync(outside, { recursive: true, force: true });
    fs.rmSync(linkedFileRoot, { recursive: true, force: true });
    fs.rmSync(linkedAncestorRoot, { recursive: true, force: true });
  }
});

test('real-project evidence needs independent reviewers before it is eligible for human review', () => {
  const candidate = validateCertificationReceipt(receipt({ id: 'real-project-one', evidenceKind: 'real-project' }));
  assert.equal(candidate.qualification, 'candidate-evidence');
  const eligible = validateCertificationReceipt(receipt({
    id: 'real-project-two',
    evidenceKind: 'real-project',
    reviewers: [
      { role: 'quality-reviewer', independent: true },
      { role: 'governance-architect', independent: true },
    ],
  }));
  assert.equal(eligible.qualification, 'eligible-for-human-certification-review');
});

test('privacy and candidate binding are mandatory', () => {
  assert.throws(() => validateCertificationReceipt(receipt({ anonymized: false })), /anonymized=true/);
  assert.throws(() => validateCertificationReceipt(receipt({ candidateFingerprint: 'stale' })), /SHA-256/);
  assert.throws(() => validateCertificationReceipt(receipt({ sourceCodeIncluded: true })), /sourceCodeIncluded=false/);
});

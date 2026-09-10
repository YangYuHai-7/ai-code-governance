import path from 'node:path';
import { lstatSafe, readJson, writeAtomicFile } from '../../adapters/filesystem/files.mjs';
import { assertNoLinkAncestor } from '../../adapters/filesystem/repository-state.mjs';
import { stableJson } from '../../shared/hashing.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/paths.mjs';
import { usageError } from '../../kernel/errors/usage-error.mjs';

export const CERTIFICATION_EVIDENCE_PATH = 'docs/ai/certification-evidence.json';

const ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;
const HASH = /^[a-f0-9]{64}$/;
const COMMIT = /^[a-f0-9]{40}$/;
const PROJECT_MODES = new Set(['greenfield', 'brownfield', 'monorepo', 'repository-family']);
const OPERATING_SYSTEMS = new Set(['macos', 'windows', 'linux']);
const EVIDENCE_KINDS = new Set(['simulated-persona', 'real-project']);
const OUTCOMES = new Set(['pass', 'fail', 'blocked']);
const ACK_KINDS = new Set(['none', 'expected-manual-decision', 'false-positive', 'manual-override']);

function sortedUnique(values) {
  return [...new Set(values)].sort((left, right) => left.localeCompare(right));
}

function stringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw usageError(`${label} must be an array of non-empty strings.`);
  }
  return sortedUnique(value.map((item) => item.trim()));
}

function validateReviewers(reviewers) {
  if (!Array.isArray(reviewers)) throw usageError('reviewers must be an array.');
  return reviewers.map((reviewer) => {
    if (!reviewer || typeof reviewer !== 'object' || !ID.test(reviewer.role ?? '') || typeof reviewer.independent !== 'boolean') {
      throw usageError('Each reviewer must contain a kebab-case role and an independent boolean.');
    }
    return { role: reviewer.role, independent: reviewer.independent };
  }).sort((left, right) => left.role.localeCompare(right.role));
}

function validateAcknowledgements(acknowledgements) {
  if (!Array.isArray(acknowledgements)) throw usageError('acknowledgements must be an array.');
  return acknowledgements.map((ack) => {
    if (!ack || typeof ack !== 'object' || !ACK_KINDS.has(ack.kind) || typeof ack.reason !== 'string' || !ack.reason.trim()) {
      throw usageError(`Each acknowledgement needs kind (${[...ACK_KINDS].join(', ')}) and a reason.`);
    }
    return { kind: ack.kind, reason: ack.reason.trim().slice(0, 500) };
  });
}

export function validateCertificationReceipt(receipt) {
  if (!receipt || typeof receipt !== 'object' || Array.isArray(receipt)) throw usageError('Certification evidence must be a JSON object.');
  if (receipt.schemaVersion !== 1) throw usageError('Certification evidence schemaVersion must be 1.');
  if (!ID.test(receipt.id ?? '')) throw usageError('Certification evidence id must be kebab-case.');
  if (!EVIDENCE_KINDS.has(receipt.evidenceKind)) throw usageError(`evidenceKind must be one of: ${[...EVIDENCE_KINDS].join(', ')}.`);
  if (!VERSION.test(receipt.toolVersion ?? '')) throw usageError('toolVersion must be SemVer.');
  if (!HASH.test(receipt.candidateFingerprint ?? '')) throw usageError('candidateFingerprint must be a SHA-256 digest.');
  if (receipt.sourceCommit !== undefined && !COMMIT.test(receipt.sourceCommit)) throw usageError('sourceCommit must be a full Git commit hash when provided.');
  if (!ID.test(receipt.packId ?? '')) throw usageError('packId must be kebab-case.');
  if (!PROJECT_MODES.has(receipt.projectMode)) throw usageError(`projectMode must be one of: ${[...PROJECT_MODES].join(', ')}.`);
  if (!OPERATING_SYSTEMS.has(receipt.os)) throw usageError(`os must be one of: ${[...OPERATING_SYSTEMS].join(', ')}.`);
  if (!ID.test(receipt.agent ?? '')) throw usageError('agent must be a kebab-case identifier.');
  if (!Number.isInteger(receipt.durationMs) || receipt.durationMs < 0 || receipt.durationMs > 86_400_000) throw usageError('durationMs must be an integer between 0 and 86400000.');
  if (!OUTCOMES.has(receipt.outcome)) throw usageError(`outcome must be one of: ${[...OUTCOMES].join(', ')}.`);
  if (receipt.anonymized !== true || receipt.sourceCodeIncluded !== false) {
    throw usageError('Evidence must declare anonymized=true and sourceCodeIncluded=false.');
  }
  const verification = stringArray(receipt.verification, 'verification');
  if (verification.length === 0) throw usageError('verification must name at least one executed check.');
  const findings = stringArray(receipt.findings ?? [], 'findings');
  const experience = receipt.experience;
  if (!experience || typeof experience !== 'object') throw usageError('experience metrics are required.');
  for (const name of ['installation', 'clarity', 'nextStep', 'recovery', 'confidence']) {
    if (!Number.isInteger(experience[name]) || experience[name] < 1 || experience[name] > 5) throw usageError(`experience.${name} must be an integer from 1 to 5.`);
  }
  const reviewers = validateReviewers(receipt.reviewers ?? []);
  const acknowledgements = validateAcknowledgements(receipt.acknowledgements ?? []);
  const qualification = receipt.evidenceKind === 'simulated-persona'
    ? 'simulation-only'
    : receipt.outcome === 'pass' && reviewers.filter((reviewer) => reviewer.independent).length >= 2
      ? 'eligible-for-human-certification-review'
      : 'candidate-evidence';
  return {
    schemaVersion: 1,
    id: receipt.id,
    evidenceKind: receipt.evidenceKind,
    toolVersion: receipt.toolVersion,
    candidateFingerprint: receipt.candidateFingerprint,
    ...(receipt.sourceCommit ? { sourceCommit: receipt.sourceCommit } : {}),
    packId: receipt.packId,
    projectMode: receipt.projectMode,
    os: receipt.os,
    agent: receipt.agent,
    durationMs: receipt.durationMs,
    outcome: receipt.outcome,
    anonymized: true,
    sourceCodeIncluded: false,
    verification,
    findings,
    experience: {
      installation: experience.installation,
      clarity: experience.clarity,
      nextStep: experience.nextStep,
      recovery: experience.recovery,
      confidence: experience.confidence,
    },
    reviewers,
    acknowledgements,
    qualification,
    claimBoundary: 'This receipt is operator-provided evidence. AICG requires a candidate fingerprint and validates its format, but does not prove that the digest identifies the installed artifact, reviewer identity, production use, or customer outcomes.',
  };
}

export function readCertificationLedger(root) {
  assertNoLinkAncestor(root, CERTIFICATION_EVIDENCE_PATH);
  const absolute = path.join(root, CERTIFICATION_EVIDENCE_PATH);
  const stat = lstatSafe(absolute);
  if (!stat) return { schemaVersion: 1, claimState: 'unverified', receipts: [] };
  if (!stat.isFile() || stat.isSymbolicLink()) throw usageError(`${CERTIFICATION_EVIDENCE_PATH} must be a regular file.`);
  const ledger = readJson(absolute);
  if (ledger.schemaVersion !== 1 || !Array.isArray(ledger.receipts)) throw usageError('Certification evidence ledger must contain schemaVersion 1 and receipts.');
  const receipts = ledger.receipts.map(validateCertificationReceipt);
  const ids = new Set();
  for (const receipt of receipts) {
    if (ids.has(receipt.id)) throw usageError(`Duplicate certification evidence id: ${receipt.id}`);
    ids.add(receipt.id);
  }
  return { schemaVersion: 1, claimState: 'unverified', receipts };
}

export function readCertificationReceiptInput(root, relativePath) {
  if (!isSafeRelative(relativePath)) throw usageError('Evidence --config must be a safe repository-relative path.');
  const normalized = normalizeRelative(relativePath);
  assertNoLinkAncestor(root, normalized);
  const absolute = path.join(root, normalized);
  const stat = lstatSafe(absolute);
  if (!stat?.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024) throw usageError('Evidence --config must be a regular JSON file no larger than 32 KiB.');
  const input = readJson(absolute);
  return validateCertificationReceipt(input.receipt ?? input);
}

export function recordCertificationEvidence(root, receipt) {
  assertNoLinkAncestor(root, CERTIFICATION_EVIDENCE_PATH);
  const ledger = readCertificationLedger(root);
  if (ledger.receipts.some((item) => item.id === receipt.id)) throw usageError(`Certification evidence id already exists: ${receipt.id}`);
  const next = {
    schemaVersion: 1,
    claimState: 'unverified',
    receipts: [...ledger.receipts, receipt].sort((left, right) => left.id.localeCompare(right.id)),
    boundary: 'Receipts are evidence inputs, not automatic certification. Simulated personas never count as real projects or independent human approval.',
  };
  writeAtomicFile(path.join(root, CERTIFICATION_EVIDENCE_PATH), stableJson(next));
  return next;
}

export function certificationEvidenceStatus(root) {
  const ledger = readCertificationLedger(root);
  const byKind = Object.fromEntries([...EVIDENCE_KINDS].map((kind) => [kind, ledger.receipts.filter((receipt) => receipt.evidenceKind === kind).length]));
  const byOutcome = Object.fromEntries([...OUTCOMES].map((outcome) => [outcome, ledger.receipts.filter((receipt) => receipt.outcome === outcome).length]));
  const eligible = ledger.receipts.filter((receipt) => receipt.qualification === 'eligible-for-human-certification-review').length;
  return {
    schemaVersion: 1,
    claimState: 'unverified',
    receiptCount: ledger.receipts.length,
    byKind,
    byOutcome,
    eligibleForHumanCertificationReview: eligible,
    certified: false,
    boundary: 'AICG does not automatically promote receipts or simulated personas to certified status.',
  };
}

export function exportCertificationEvidence(root) {
  const ledger = readCertificationLedger(root);
  return {
    schemaVersion: 1,
    exportedClaimState: 'unverified',
    receipts: ledger.receipts,
    boundary: 'This export is anonymized structured evidence for human review; it is not a certification claim.',
  };
}

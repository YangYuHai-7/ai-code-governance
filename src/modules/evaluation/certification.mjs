import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest } from '../../shared/index.mjs';
import { validateGoldenPathPack } from '../stack-packs/index.mjs';
import { EVALUATION_LEVELS, validateGoldenPathEvaluation } from './contracts.mjs';

export const GOLDEN_PATH_CERTIFICATION_VERSION = 1;
const CERTIFICATION_STATUSES = Object.freeze(['certified', 'incomplete', 'blocked']);
const BLOCKING_CODES = Object.freeze(['held-out-overlap', 'stale-pack', 'stale-repository', 'duplicate-run']);
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_LEVEL = 'E3-agent-executable';

function fail(path, message) { throw usageError(`${path}: ${message}`); }
function object(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object'); return value; }

function validateRecord(entry, path) {
  object(entry, path);
  const allowed = ['id', 'caseId', 'caseClass', 'runId', 'platform', 'qualifiedHuman', 'caseDigests', 'negativeProbes', 'receipt'];
  for (const key of Object.keys(entry)) if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown field');
  for (const key of allowed) if (!Object.hasOwn(entry, key)) fail(`${path}.${key}`, 'required field is missing');
  if (!ID.test(entry.id)) fail(`${path}.id`, 'invalid id');
  if (!ID.test(entry.caseId)) fail(`${path}.caseId`, 'invalid case id');
  if (!['held-out', 'reference'].includes(entry.caseClass)) fail(`${path}.caseClass`, 'unsupported case class');
  if (!ID.test(entry.runId)) fail(`${path}.runId`, 'invalid run id');
  if (typeof entry.platform !== 'string' || entry.platform.length === 0) fail(`${path}.platform`, 'invalid platform');
  if (typeof entry.qualifiedHuman !== 'boolean') fail(`${path}.qualifiedHuman`, 'expected a boolean');
  object(entry.caseDigests, `${path}.caseDigests`);
  for (const key of ['requirement', 'repository']) if (!DIGEST.test(entry.caseDigests[key] ?? '')) fail(`${path}.caseDigests.${key}`, 'expected a canonical digest');
  if (!Array.isArray(entry.negativeProbes)) fail(`${path}.negativeProbes`, 'expected an array');
  entry.negativeProbes.forEach((probe, index) => {
    const probePath = `${path}.negativeProbes[${index}]`;
    object(probe, probePath);
    if (!ID.test(probe.id ?? '')) fail(`${probePath}.id`, 'invalid probe id');
    if (typeof probe.status !== 'string') fail(`${probePath}.status`, 'invalid probe status');
  });
  object(entry.receipt, `${path}.receipt`);
  const receiptFields = ['level', 'verdict', 'digests', 'evaluatedAt'];
  for (const key of Object.keys(entry.receipt)) if (!receiptFields.includes(key)) fail(`${path}.receipt.${key}`, 'unknown field');
  for (const key of receiptFields) if (!Object.hasOwn(entry.receipt, key)) fail(`${path}.receipt.${key}`, 'required field is missing');
  if (!EVALUATION_LEVELS.includes(entry.receipt.level)) fail(`${path}.receipt.level`, 'unsupported level');
  if (!['passed', 'failed', 'blocked', 'incomplete'].includes(entry.receipt.verdict)) fail(`${path}.receipt.verdict`, 'unsupported verdict');
  object(entry.receipt.digests, `${path}.receipt.digests`);
  for (const key of ['pack', 'repository']) if (!DIGEST.test(entry.receipt.digests[key] ?? '')) fail(`${path}.receipt.digests.${key}`, 'expected a canonical digest');
  if (typeof entry.receipt.evaluatedAt !== 'string' || Number.isNaN(Date.parse(entry.receipt.evaluatedAt))) fail(`${path}.receipt.evaluatedAt`, 'expected an ISO date-time');
  return entry;
}

export function evaluateGoldenPathCertification(input) {
  object(input, 'goldenPathCertificationInput');
  const pack = validateGoldenPathPack(input.pack);
  const referenceDigests = object(input.referenceDigests, 'referenceDigests');
  for (const key of ['pack', 'requirement', 'repository', 'environment']) if (!DIGEST.test(referenceDigests[key] ?? '')) fail(`referenceDigests.${key}`, 'expected a canonical digest');
  const platformPolicy = { claimed: input.platformPolicy?.claimed ?? [], informational: input.platformPolicy?.informational ?? [] };
  const thresholdPolicy = {
    minimumHeldOutCases: input.thresholdPolicy?.minimumHeldOutCases ?? 0,
    requireQualifiedHuman: input.thresholdPolicy?.requireQualifiedHuman !== false,
    requireNegativeProbes: input.thresholdPolicy?.requireNegativeProbes !== false,
    maxAgeDays: input.thresholdPolicy?.maxAgeDays ?? null,
  };
  if (!Array.isArray(input.evaluationReceipts)) fail('evaluationReceipts', 'expected an array');
  const records = input.evaluationReceipts.map((entry, index) => validateRecord(entry, `evaluationReceipts[${index}]`));
  const now = input.now ?? new Date().toISOString();
  const gaps = [];
  const add = (code, detail) => gaps.push({ code, detail });

  const runIds = new Set();
  for (const record of records) {
    if (runIds.has(record.runId)) add('duplicate-run', `run ${record.runId} appears more than once; each case needs an independent run`);
    runIds.add(record.runId);
    if (record.receipt.digests.pack !== referenceDigests.pack) add('stale-pack', `${record.caseId} was produced against a different Pack digest`);
    if (record.receipt.digests.repository !== referenceDigests.repository) add('stale-repository', `${record.caseId} was produced against a different repository digest`);
    if (record.caseClass === 'held-out' && (record.caseDigests.requirement === referenceDigests.requirement || record.caseDigests.repository === referenceDigests.repository)) {
      add('held-out-overlap', `${record.caseId} reuses reference fixture digests and is not held out`);
    }
    for (const probe of record.negativeProbes) if (probe.status !== 'passed') add(`negative-probe-failed:${probe.id}`, `negative probe ${probe.id} failed in ${record.caseId}`);
    if (thresholdPolicy.maxAgeDays !== null) {
      const ageDays = (Date.parse(now) - Date.parse(record.receipt.evaluatedAt)) / 86_400_000;
      if (Number.isFinite(ageDays) && ageDays > thresholdPolicy.maxAgeDays) add(`stale-evidence:${record.caseId}`, `evidence is older than ${thresholdPolicy.maxAgeDays} days`);
    }
  }

  const byCase = new Map();
  for (const record of records) {
    const list = byCase.get(record.caseId) ?? [];
    list.push(record);
    byCase.set(record.caseId, list);
  }
  for (const [caseId, list] of byCase) {
    const sorted = [...list].sort((left, right) => Date.parse(right.receipt.evaluatedAt) - Date.parse(left.receipt.evaluatedAt));
    const newest = sorted[0];
    if (newest.receipt.verdict !== 'passed' && sorted.some((entry) => entry.receipt.verdict === 'passed')) {
      add(`regression:${caseId}`, `${caseId} regressed after an earlier passing run`);
    }
  }

  const passing = records.filter((record) => record.receipt.verdict === 'passed');
  if (!passing.some((record) => record.receipt.level === 'E3-agent-executable')) add('missing-e3', 'no current E3 agent-executable receipt exists');
  const heldOut = passing.filter((record) => record.caseClass === 'held-out');
  if (heldOut.length === 0) add('missing-held-out-case', 'no held-out case has passed');
  const independentCases = new Set(heldOut.map((record) => `${record.caseId}`));
  if (independentCases.size < thresholdPolicy.minimumHeldOutCases) add('insufficient-held-out-cases', `${independentCases.size} independent held-out cases passed; ${thresholdPolicy.minimumHeldOutCases} are required`);
  if (thresholdPolicy.requireQualifiedHuman && !passing.some((record) => record.qualifiedHuman === true)) add('missing-qualified-human', 'no qualified human acceptance is recorded; AI review is not qualified-human evidence');
  if (thresholdPolicy.requireNegativeProbes && records.every((record) => record.negativeProbes.length === 0)) add('missing-negative-probes', 'no negative probe result is recorded');

  const claimed = Array.isArray(platformPolicy.claimed) ? platformPolicy.claimed : [];
  for (const platform of claimed) {
    const platformRecords = records.filter((record) => record.platform === platform);
    const newest = [...platformRecords].sort((left, right) => Date.parse(right.receipt.evaluatedAt) - Date.parse(left.receipt.evaluatedAt))[0];
    if (!newest) add(`platform-missing:${platform}`, `platform ${platform} is claimed but has no evaluation receipt`);
    else if (newest.receipt.verdict !== 'passed') add(`platform-failed:${platform}`, `platform ${platform} is claimed but its newest receipt did not pass`);
  }

  const levels = passing.map((record) => record.receipt.level);
  const evidenceLevel = gaps.length === 0 ? 'E4-golden-path-certified'
    : levels.includes(MAX_LEVEL) ? MAX_LEVEL
      : EVALUATION_LEVELS.filter((level) => levels.includes(level)).at(-1) ?? 'E0-generated';
  const blocked = gaps.some((gap) => BLOCKING_CODES.includes(gap.code) || gap.code.startsWith('platform-failed:') || gap.code.startsWith('regression:'));
  const status = gaps.length === 0 ? 'certified' : blocked ? 'blocked' : 'incomplete';
  return validateGoldenPathCertification({
    schemaVersion: GOLDEN_PATH_CERTIFICATION_VERSION,
    status, evidenceLevel,
    matrix: {
      entries: records.map((record) => ({ caseId: record.caseId, platform: record.platform, runId: record.runId, level: record.receipt.level, verdict: record.receipt.verdict, evaluatedAt: record.receipt.evaluatedAt })),
    },
    thresholds: thresholdPolicy,
    gaps,
    sourceDigests: { ...referenceDigests, policy: canonicalValueDigest({ platformPolicy, thresholdPolicy, packId: pack.id }) },
    evaluatedAt: now,
  });
}

export function validateGoldenPathCertification(value) {
  const allowed = ['schemaVersion', 'status', 'evidenceLevel', 'matrix', 'thresholds', 'gaps', 'sourceDigests', 'evaluatedAt'];
  object(value, 'goldenPathCertification');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`goldenPathCertification.${key}`, 'unknown field');
  for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`goldenPathCertification.${key}`, 'required field is missing');
  if (value.schemaVersion !== GOLDEN_PATH_CERTIFICATION_VERSION) fail('goldenPathCertification.schemaVersion', `unsupported version ${value.schemaVersion}`);
  if (!CERTIFICATION_STATUSES.includes(value.status)) fail('goldenPathCertification.status', 'unsupported status');
  if (![...EVALUATION_LEVELS, 'E4-golden-path-certified'].includes(value.evidenceLevel)) fail('goldenPathCertification.evidenceLevel', 'unsupported level');
  object(value.matrix, 'goldenPathCertification.matrix');
  if (!Array.isArray(value.matrix.entries)) fail('goldenPathCertification.matrix.entries', 'expected an array');
  value.matrix.entries.forEach((entry, index) => {
    const path = `goldenPathCertification.matrix.entries[${index}]`;
    for (const key of ['caseId', 'platform', 'runId', 'level', 'verdict', 'evaluatedAt']) if (typeof entry?.[key] !== 'string' || entry[key].length === 0) fail(`${path}.${key}`, 'expected a string');
  });
  object(value.thresholds, 'goldenPathCertification.thresholds');
  if (!Number.isSafeInteger(value.thresholds.minimumHeldOutCases) || value.thresholds.minimumHeldOutCases < 0) fail('goldenPathCertification.thresholds.minimumHeldOutCases', 'expected a non-negative integer');
  for (const key of ['requireQualifiedHuman', 'requireNegativeProbes']) if (typeof value.thresholds[key] !== 'boolean') fail(`goldenPathCertification.thresholds.${key}`, 'expected a boolean');
  if (value.thresholds.maxAgeDays !== null && (!Number.isSafeInteger(value.thresholds.maxAgeDays) || value.thresholds.maxAgeDays < 1)) fail('goldenPathCertification.thresholds.maxAgeDays', 'expected null or a positive integer');
  if (!Array.isArray(value.gaps)) fail('goldenPathCertification.gaps', 'expected an array');
  value.gaps.forEach((gap, index) => {
    const path = `goldenPathCertification.gaps[${index}]`;
    object(gap, path);
    if (typeof gap.code !== 'string' || gap.code.length === 0) fail(`${path}.code`, 'expected a gap code');
    if (typeof gap.detail !== 'string' || gap.detail.length === 0) fail(`${path}.detail`, 'expected a gap detail');
  });
  object(value.sourceDigests, 'goldenPathCertification.sourceDigests');
  for (const key of ['pack', 'requirement', 'repository', 'environment', 'policy']) if (!DIGEST.test(value.sourceDigests[key] ?? '')) fail(`goldenPathCertification.sourceDigests.${key}`, 'expected a canonical digest');
  if (typeof value.evaluatedAt !== 'string' || Number.isNaN(Date.parse(value.evaluatedAt))) fail('goldenPathCertification.evaluatedAt', 'expected an ISO date-time');
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}
// Receipts decide platform support: an informational platform is recorded but never verified, and a
// missing receipt stays unverified instead of being rounded up to support.
export function platformEvidence(records = [], platformPolicy = {}) {
  const claimed = Array.isArray(platformPolicy.claimed) ? platformPolicy.claimed : [];
  const informational = (platformPolicy.informational ?? []).map((entry) => (typeof entry === 'string' ? entry : entry?.platform)).filter(Boolean);
  const platforms = [...new Set([...claimed, ...informational])].sort();
  const entries = platforms.map((platform) => {
    const list = (records ?? []).filter((entry) => entry.platform === platform);
    const newest = [...list].sort((left, right) => Date.parse(right.receipt.evaluatedAt) - Date.parse(left.receipt.evaluatedAt))[0];
    if (!newest) return Object.freeze({ platform, status: 'missing', verified: false });
    if (informational.includes(platform)) return Object.freeze({ platform, status: newest.receipt.verdict === 'passed' ? 'informational-passed' : 'informational-failed', verified: false });
    const passed = newest.receipt.verdict === 'passed';
    return Object.freeze({ platform, status: passed ? 'verified' : 'failed', verified: passed });
  });
  return Object.freeze({ entries: Object.freeze(entries), verified: Object.freeze(entries.filter((entry) => entry.verified).map((entry) => entry.platform)) });
}
// Publication is evidence-derived: E4 authorizes Milestone 3 but never performs product-form work,
// and anything below E4 leaves the roadmap explicitly evidence-incomplete with exact gaps.
export function publicationDecision(certification) {
  const current = validateGoldenPathCertification(certification);
  const certified = current.status === 'certified' && current.evidenceLevel === 'E4-golden-path-certified';
  return Object.freeze({
    milestone2: certified ? 'complete' : 'evidence-incomplete',
    milestone3: certified ? 'authorized' : 'blocked',
    performsPhaseB: false,
    gaps: Object.freeze(certified ? [] : current.gaps.map((gap) => Object.freeze({ code: gap.code, detail: gap.detail }))),
  });
}

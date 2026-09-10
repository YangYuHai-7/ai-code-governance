import path from 'node:path';
import { CONFIG_PATH, LOCAL_OUTPUT_PREFIXES } from '../../constants.mjs';
import { assertNoLinkAncestor, lstatSafe, readJson, readText } from '../../adapters/filesystem/index.mjs';
import { sha256, stableJson } from '../../shared/index.mjs';
import { BUSINESS_RISK_EVIDENCE_PATH, validateConfig } from '../governance/index.mjs';

export const RISK_EVIDENCE_PATH = BUSINESS_RISK_EVIDENCE_PATH;

const RISK_PROBES = Object.freeze({
  authentication: ['body-actor-identity'],
  authorization: ['body-actor-identity'],
  payment: ['canceled-invoice-settlement'],
  'sensitive-data': ['webhook-secret-missing', 'vault-default-token'],
  'external-side-effect': ['webhook-secret-missing', 'multi-instance-lost-update'],
  'multi-tenancy': ['inactive-membership'],
  'data-consistency': ['multi-instance-lost-update'],
  'public-api': ['body-actor-identity'],
});

const EVIDENCE_LEVELS = new Set(['simulation-only', 'project-local-unverified']);
const APPLICABLE_STATUSES = new Set(['passed', 'blocked', 'unverified']);
const FINGERPRINT_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts', '.json', '.html', '.htm']);

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function requiredRiskProbeIds(config) {
  return [...new Set((config.confirmedRiskSignals ?? []).flatMap((signal) => RISK_PROBES[signal] ?? []))]
    .sort((left, right) => left.localeCompare(right));
}

export function riskEvidenceFingerprint(scan, config) {
  const sources = scan.files
    .filter((file) => (
      file.type === 'file'
      && file.contentScannable !== false
      && !file.relative.startsWith('docs/ai/')
      && !file.relative.startsWith('.ai-governance/')
      && !LOCAL_OUTPUT_PREFIXES.some((prefix) => file.relative.startsWith(prefix))
      && FINGERPRINT_EXTENSIONS.has(path.extname(file.relative).toLowerCase())
    ))
    .sort((left, right) => left.relative.localeCompare(right.relative))
    .map((file) => {
      try {
        return { path: file.relative, sha256: sha256(readText(file.absolute)) };
      } catch {
        return { path: file.relative, sha256: null };
      }
    });
  return sha256(stableJson({
    domainConstraints: config.domainConstraints ?? [],
    confirmedRiskSignals: config.confirmedRiskSignals ?? [],
    sources,
  }));
}

function base(status, expected, fingerprint, issues = [], covered = 0) {
  return {
    status,
    path: RISK_EVIDENCE_PATH,
    required: expected.length,
    covered,
    expectedRiskIds: expected,
    sourceFingerprint: fingerprint,
    issues,
  };
}

export function evaluateRiskEvidence(scan) {
  let config;
  try {
    config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
  } catch (error) {
    return base('invalid', [], null, [`Cannot read current risk configuration: ${error.message}`]);
  }
  const expected = requiredRiskProbeIds(config);
  const fingerprint = riskEvidenceFingerprint(scan, config);
  if (expected.length === 0) return base('not-applicable', expected, fingerprint);
  const absolute = path.join(scan.root, RISK_EVIDENCE_PATH);
  const stat = lstatSafe(absolute);
  if (!stat) return base('missing', expected, fingerprint, [`${RISK_EVIDENCE_PATH}: missing owner-confirmed negative and recovery evidence.`]);
  let receipt;
  try {
    assertNoLinkAncestor(scan.root, RISK_EVIDENCE_PATH);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('must be a regular repository-local file.');
    receipt = readJson(absolute);
  } catch (error) {
    return base('invalid', expected, fingerprint, [`${RISK_EVIDENCE_PATH}: ${error.message}`]);
  }
  const issues = [];
  if (receipt.schemaVersion !== 1) issues.push('schemaVersion must be 1.');
  if (receipt.owner !== 'product-owner' || receipt.source !== 'owner-confirmed') {
    issues.push('owner and source must be product-owner and owner-confirmed.');
  }
  if (!Array.isArray(receipt.risks)) issues.push('risks must be an array.');
  if (issues.length > 0) return base('invalid', expected, fingerprint, issues);
  const expectedSet = new Set(expected);
  const seen = new Set();
  let covered = 0;
  let incomplete = false;
  for (const record of receipt.risks) {
    const id = record?.riskId;
    if (!nonEmptyString(id) || !expectedSet.has(id)) {
      issues.push(`Unknown or missing riskId ${id ?? 'missing'}.`);
      continue;
    }
    if (seen.has(id)) issues.push(`duplicate riskId ${id}.`);
    seen.add(id);
    if (!['applicable', 'not-applicable'].includes(record.applicability)) issues.push(`${id}: applicability must be applicable or not-applicable.`);
    if (!nonEmptyString(record.reason)) issues.push(`${id}: reason is required for owner-confirmed applicability.`);
    if (record.sourceFingerprint !== fingerprint) issues.push(`${id}: sourceFingerprint does not match current source and risk configuration.`);
    if (!EVIDENCE_LEVELS.has(record.evidenceLevel)) issues.push(`${id}: evidenceLevel cannot be certified and must be simulation-only or project-local-unverified.`);
    if (record.applicability === 'not-applicable') {
      if (record.status !== undefined && record.status !== 'not-applicable') issues.push(`${id}: not-applicable records may only use not-applicable status.`);
      covered += 1;
      continue;
    }
    if (!APPLICABLE_STATUSES.has(record.status)) issues.push(`${id}: applicable status must be passed, blocked, or unverified.`);
    for (const field of ['entrypoint', 'negativeDiagnostic', 'recoveryEvidence']) {
      if (!nonEmptyString(record[field])) issues.push(`${id}: ${field} is required for applicable risk evidence.`);
    }
    if (record.status !== 'passed') incomplete = true;
    else covered += 1;
  }
  for (const id of expected) {
    if (!seen.has(id)) issues.push(`${id}: missing owner-confirmed applicability and evidence record.`);
  }
  if (issues.length > 0) return base('invalid', expected, fingerprint, issues, covered);
  if (incomplete) return base('incomplete', expected, fingerprint, [], covered);
  return base('recorded-unverified', expected, fingerprint, [], covered);
}

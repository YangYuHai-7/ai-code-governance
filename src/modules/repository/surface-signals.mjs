import path from 'node:path';
import { GENERATED_MARKER, PACKAGE_ROOT } from '../../constants.mjs';
import { readJson, readText } from '../../adapters/filesystem/index.mjs';

const SIGNAL_KINDS = ['browser-ui', 'node-http', 'file-persistence'];
const REQUIRED_FIELDS = ['id', 'kind', 'source', 'confidence', 'evidenceLevel', 'gaps'];
const PROFILE_IDS = ['http-contract', 'dom-smoke', 'browser-smoke', 'file-recovery'];
const SOURCE_EXTENSIONS = new Set(['.html', '.htm', '.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts']);
const GOVERNANCE_PREFIXES = ['docs/ai/', '.ai-governance/', '.agents/', '.claude/', '.cursor/'];

export const SURFACE_VERIFICATION_PATH = 'docs/ai/surface-verification.json';
export const SURFACE_EVIDENCE_MARKER_PREFIX = 'AICG_SURFACE_EVIDENCE ';

const VERIFICATION_PROFILES = Object.freeze([
  { id: 'http-contract', signalIds: ['surface-node-http'], environment: 'node', acceptedScriptPrefixes: ['test:http', 'verify:http', 'test:contract', 'verify:contract'] },
  { id: 'dom-smoke', signalIds: ['surface-browser-ui'], environment: 'node-dom', acceptedScriptPrefixes: ['test:dom', 'verify:dom'] },
  { id: 'browser-smoke', signalIds: ['surface-browser-ui'], environment: 'browser', acceptedScriptPrefixes: ['test:browser', 'verify:browser', 'test:e2e', 'verify:e2e'] },
  { id: 'file-recovery', signalIds: ['surface-file-persistence'], environment: 'node', acceptedScriptPrefixes: ['test:recovery', 'verify:recovery', 'test:persistence', 'verify:persistence'] },
]);

export function surfaceVerificationProfiles() {
  return {
    schemaVersion: 1,
    generatedMarker: GENERATED_MARKER,
    profiles: VERIFICATION_PROFILES.map((profile) => ({ ...profile })),
    statuses: ['passed', 'blocked', 'unverified', 'not-applicable'],
    declarationPath: SURFACE_VERIFICATION_PATH,
    markerContract: {
      prefix: SURFACE_EVIDENCE_MARKER_PREFIX,
      schemaVersion: 1,
      requiredFields: ['storyId', 'signalId', 'profileId', 'entrypoint', 'outcome'],
      requiredOutcome: 'passed',
      binding: 'Every field must exactly match the selected declared story. A zero exit without one exact marker is not surface evidence.',
    },
    claimBoundary: 'Profiles identify safe project-owned verification entrypoints. They do not make a detected surface supported or execute undeclared commands.',
  };
}

export function validateSurfaceVerificationContract(contract) {
  if (!contract || contract.schemaVersion !== 1) throw new Error('Surface verification contract schemaVersion must be 1.');
  if (!Array.isArray(contract.signalKinds) || SIGNAL_KINDS.some((kind) => !contract.signalKinds.includes(kind))) {
    throw new Error(`Surface verification contract signalKinds must include: ${SIGNAL_KINDS.join(', ')}.`);
  }
  if (!Array.isArray(contract.requiredSignalFields) || REQUIRED_FIELDS.some((field) => !contract.requiredSignalFields.includes(field))) {
    throw new Error(`Surface verification contract requiredSignalFields must include: ${REQUIRED_FIELDS.join(', ')}.`);
  }
  if (!Array.isArray(contract.confidenceLevels) || !['high', 'medium', 'low'].every((level) => contract.confidenceLevels.includes(level))) {
    throw new Error('Surface verification contract confidenceLevels must include high, medium, and low.');
  }
  if (!Array.isArray(contract.evidenceLevels) || contract.evidenceLevels.length !== 1 || contract.evidenceLevels[0] !== 'detected-unverified') {
    throw new Error('Surface verification contract evidenceLevels must contain only detected-unverified.');
  }
  if (!Array.isArray(contract.verificationProfiles) || PROFILE_IDS.some((profile) => !contract.verificationProfiles.includes(profile))) {
    throw new Error(`Surface verification contract verificationProfiles must include: ${PROFILE_IDS.join(', ')}.`);
  }
  return true;
}

export function loadSurfaceVerificationContract() {
  const contract = readJson(path.join(PACKAGE_ROOT, 'assets/contracts/surface-verification-contract.json'));
  validateSurfaceVerificationContract(contract);
  return contract;
}

function candidateFiles(scan) {
  return scan.files.filter((file) => (
    file.type === 'file'
    && file.contentScannable !== false
    && SOURCE_EXTENSIONS.has(path.extname(file.relative).toLowerCase())
    && !GOVERNANCE_PREFIXES.some((prefix) => file.relative.startsWith(prefix))
  ));
}

function contentEvidence(files, matcher) {
  const paths = [];
  for (const file of files) {
    let content;
    try {
      content = readText(file.absolute);
    } catch {
      continue;
    }
    if (matcher(content, file.relative)) paths.push(file.relative);
  }
  return paths.sort((left, right) => left.localeCompare(right)).slice(0, 12);
}

function signal(kind, paths, confidence, suggestedVerificationProfile, gaps) {
  return {
    id: `surface-${kind}`,
    kind,
    source: { type: 'static-repository-evidence', paths },
    confidence,
    evidenceLevel: 'detected-unverified',
    gaps,
    suggestedVerificationProfile,
  };
}

export function detectSurfaceSignals(scan) {
  loadSurfaceVerificationContract();
  const files = candidateFiles(scan);
  const browserPaths = contentEvidence(files, (content, relative) => (
    /\.html?$/i.test(relative)
    || /\b(?:document|window|localStorage|sessionStorage)\s*[.[]/.test(content)
    || /\b(?:createElement|querySelector|getElementById)\s*\(/.test(content)
  ));
  const httpPaths = contentEvidence(files, (content) => (
    /(?:from\s*|require\s*\(\s*)['"](?:node:)?https?['"]/.test(content)
    || /\bcreateServer\s*\(/.test(content)
  ));
  const filePaths = contentEvidence(files, (content) => (
    /(?:from\s*|require\s*\(\s*)['"](?:node:)?fs(?:\/promises)?['"]/.test(content)
  ));
  const signals = [];
  if (browserPaths.length > 0) signals.push(signal('browser-ui', browserPaths, 'high', 'browser-smoke', [
    'DOM interaction and user-story reachability have not been executed.',
    'Browser compatibility and accessibility remain unverified.',
  ]));
  if (httpPaths.length > 0) signals.push(signal('node-http', httpPaths, 'high', 'http-contract', [
    'Listening behavior, routes, authentication, and request limits have not been exercised.',
  ]));
  if (filePaths.length > 0) signals.push(signal('file-persistence', filePaths, 'medium', 'file-recovery', [
    'Durability, locking, concurrent writers, crash recovery, and multi-instance behavior remain unverified.',
  ]));
  return signals;
}

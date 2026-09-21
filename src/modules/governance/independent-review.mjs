import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { commandExists, runCommand } from '../../adapters/process/index.mjs';
import { assertNoLinkAncestor } from '../../adapters/filesystem/repository-state.mjs';
import { writeAtomicFile } from '../../adapters/filesystem/files.mjs';

const REPORT_PATH = 'reports/aicg/latest-independent-review.json';
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.next', 'dist', 'build', 'coverage']);
const DIMENSIONS = ['completeness', 'stackAlignment', 'architecture', 'agentRouting', 'evidence'];
const MAX_FILES = 20_000;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function digest(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
function digestFile(file) {
  const hash = crypto.createHash('sha256');
  const descriptor = fs.openSync(file, 'r');
  const buffer = Buffer.allocUnsafe(64 * 1024);
  try {
    for (let count; (count = fs.readSync(descriptor, buffer, 0, buffer.length, null)) > 0;) hash.update(buffer.subarray(0, count));
  } finally { fs.closeSync(descriptor); }
  return hash.digest('hex');
}
function regularFile(root, relative) {
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).some((part) => !part || part === '.' || part === '..')) throw new Error(`Unsafe review path: ${relative}`);
  assertNoLinkAncestor(root, relative);
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_FILE_BYTES) throw new Error(`Review input is not a bounded regular file: ${relative}`);
  return fs.readFileSync(absolute);
}

export function governedArtifactSnapshot(root) {
  const manifest = JSON.parse(regularFile(root, '.ai-governance/manifest.json').toString('utf8'));
  if (!Array.isArray(manifest.files) || !manifest.files.length) throw new Error('Governance manifest has no files to review.');
  const paths = [...new Set(['.ai-governance/manifest.json', '.ai-governance/config.json', ...manifest.files.map((entry) => entry.path)])].sort();
  const entries = paths.map((relative) => ({ path: relative, sha256: digest(regularFile(root, relative)) }));
  return { root: fs.realpathSync(root), files: entries, digest: digest(JSON.stringify(entries)) };
}

// Snapshot all repository-local files outside generated reports, including existing dirty files.
function workspaceSnapshot(root) {
  const entries = [];
  function walk(dir, relative = '') {
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      const name = relative ? `${relative}/${item.name}` : item.name;
      if (name === 'reports/aicg' || (item.isDirectory() && SKIP_DIRECTORIES.has(item.name))) continue;
      if (item.isSymbolicLink()) { entries.push({ path: name, type: 'link', target: fs.readlinkSync(path.join(dir, item.name)) }); continue; }
      if (item.isDirectory()) { walk(path.join(dir, item.name), name); continue; }
      if (!item.isFile()) continue;
      entries.push({ path: name, type: 'file', sha256: digestFile(path.join(dir, item.name)) });
      if (entries.length > MAX_FILES) throw new Error('Review workspace exceeds file inventory limit.');
    }
  }
  walk(root);
  return new Map(entries.map((entry) => [entry.path, JSON.stringify(entry)]));
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])].filter((name) => before.get(name) !== after.get(name)).sort();
}

function reviewRoles(lifecycle, selectedRoles) {
  const defaults = lifecycle === 'existing'
    ? ['software-architect', 'stack-specialist', 'business-analyst', 'quality-engineer']
    : ['software-architect', 'stack-specialist', 'quality-engineer'];
  const roles = selectedRoles ?? defaults;
  if (!Array.isArray(roles) || !roles.length || roles.some((role) => typeof role !== 'string' || !/^[a-z][a-z0-9-]{1,48}$/.test(role))) throw new Error('Review roles must be nonempty role IDs.');
  return [...new Set(roles)];
}

function reviewPrompt(snapshot, roles, lifecycle) {
  return `You are a NEW independent coding-agent reviewer. Act as these review roles: ${roles.join(', ')}. Review governance artifacts in this repository for a ${lifecycle} project. The artifact inventory and binding digest are ${JSON.stringify({ digest: snapshot.digest, files: snapshot.files })}. Read the actual artifacts and relevant project evidence. Evaluate completeness, exact technology-stack alignment, module boundaries and extension points, agent role and task-size routing, and evidence/test/approval gates. For an existing project, check that business Memory and per-project development docs and Skills cite actual code; do not invent business or legal conclusions. Do not modify any file. Return only JSON matching the supplied schema. Scores are 0-100; cite paths in each finding. A coding agent is not a qualified human reviewer: leave human/professional review gaps explicit. A successful process exit alone is not acceptance.`;
}

const outputSchema = {
  type: 'object', additionalProperties: false,
  required: ['decision', 'scores', 'findings', 'gaps', 'summary'],
  properties: {
    decision: { type: 'string', enum: ['accept', 'revise', 'unverified'] },
    scores: { type: 'object', additionalProperties: false, required: DIMENSIONS, properties: Object.fromEntries(DIMENSIONS.map((key) => [key, { type: 'integer', minimum: 0, maximum: 100 }])) },
    findings: { type: 'array', items: { type: 'object', additionalProperties: false, required: ['severity', 'path', 'message'], properties: { severity: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] }, path: { type: 'string' }, message: { type: 'string' } } } },
    gaps: { type: 'array', items: { type: 'string' } },
    summary: { type: 'string' },
  },
};

function validateOutput(value) {
  if (!value || !['accept', 'revise', 'unverified'].includes(value.decision) || !value.scores || !Array.isArray(value.findings) || !Array.isArray(value.gaps) || typeof value.summary !== 'string') return false;
  if (DIMENSIONS.some((key) => !Number.isInteger(value.scores[key]) || value.scores[key] < 0 || value.scores[key] > 100)) return false;
  return value.findings.every((item) => ['critical', 'high', 'medium', 'low'].includes(item.severity) && typeof item.path === 'string' && typeof item.message === 'string') && value.gaps.every((item) => typeof item === 'string');
}

function writeReport(root, report) {
  assertNoLinkAncestor(root, REPORT_PATH);
  writeAtomicFile(path.join(root, REPORT_PATH), `${JSON.stringify(report, null, 2)}\n`, 0o600);
  return REPORT_PATH;
}

/** Run a fresh independent, read-only Codex review. The caller decides whether to accept or apply revisions. */
export function runIndependentReview(target, options = {}) {
  const root = fs.realpathSync(target);
  const snapshot = governedArtifactSnapshot(root);
  const before = workspaceSnapshot(root);
  const roles = reviewRoles(options.lifecycle ?? 'greenfield', options.roles);
  const selected = options.selectedAgents ?? ['codex'];
  const isAvailable = options.commandExists ?? commandExists;
  const report = {
    schemaVersion: 1, generatedAt: new Date().toISOString(), target: root,
    artifactDigest: snapshot.digest, artifactCount: snapshot.files.length, artifacts: snapshot.files,
    roles, agentId: null, process: { status: 'not-launched', exitCode: null },
    review: null, status: 'pending-unverified', unexpectedChanges: [],
    boundaries: ['Agent role simulation is not qualified human or professional review.', 'Process success does not prove review acceptance.'],
  };
  // Codex has a verified noninteractive read-only invocation. Other agents stay pending until a safe adapter is verified.
  if (!selected.includes('codex') || !isAvailable('codex')) {
    report.reason = 'No selected, available Agent with a verified read-only review adapter.';
    report.reportPath = writeReport(root, report);
    return report;
  }
  report.agentId = 'codex';
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-independent-review-'));
  const schemaPath = path.join(temporary, 'schema.json');
  const outputPath = path.join(temporary, 'answer.json');
  try {
    fs.writeFileSync(schemaPath, JSON.stringify(outputSchema));
    const args = ['exec', '--sandbox', 'read-only', '--ephemeral', '--skip-git-repo-check', '--output-schema', schemaPath, '--output-last-message', outputPath, '-C', root, reviewPrompt(snapshot, roles, options.lifecycle ?? 'greenfield')];
    const runner = options.runCommand ?? runCommand;
    let result;
    try { result = runner('codex', args, { cwd: root, encoding: 'utf8', timeout: options.timeoutMs ?? 300_000, maxBuffer: 4 * 1024 * 1024 }); }
    catch (error) { result = { status: null, error }; }
    report.process = { status: result.error || result.status !== 0 ? 'failed' : 'completed', exitCode: result.status ?? null, error: result.error?.message ?? null };
    const after = workspaceSnapshot(root);
    report.unexpectedChanges = changedPaths(before, after);
    if (report.unexpectedChanges.length) {
      report.status = 'unsafe-changes';
      report.reason = 'The reviewer changed repository files; review acceptance is rejected. Changes were preserved for inspection.';
    } else if (report.process.status !== 'completed') {
      report.reason = 'Reviewer process did not complete successfully.';
    } else {
      let parsed;
      try { parsed = JSON.parse(fs.readFileSync(outputPath, 'utf8')); } catch { /* Missing or malformed output remains unverified. */ }
      if (!validateOutput(parsed)) report.reason = 'Reviewer output is missing or invalid.';
      else {
        report.review = parsed;
        const scoreLow = DIMENSIONS.some((key) => parsed.scores[key] < (options.minimumScore ?? 80));
        const severe = parsed.findings.some((item) => ['critical', 'high'].includes(item.severity));
        report.status = parsed.decision === 'accept' && !scoreLow && !severe ? 'agent-accepted' : 'needs-revision';
        report.reason = report.status === 'agent-accepted' ? 'Independent Agent review met the configured threshold.' : 'Reviewer requested revision or score/finding threshold failed.';
      }
    }
    let currentDigest;
    try { currentDigest = governedArtifactSnapshot(root).digest; } catch { currentDigest = null; }
    if (currentDigest !== snapshot.digest) {
      report.status = 'unsafe-changes';
      report.reason = 'Governed artifacts changed during review; the result is stale.';
    }
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
  report.reportPath = writeReport(root, report);
  return report;
}

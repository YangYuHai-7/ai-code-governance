import { scanProject } from '../repository/index.mjs';
import { loadProjectMemory, readMemoryFile } from '../memory/index.mjs';
import { sha256 } from '../../shared/index.mjs';
import { validateWorkUnit, QA_CATEGORIES, HASH } from './schema.mjs';
import { workUnitCoverage, selectWorkUnitRoles } from './planner.mjs';
import { readBoundedRepositoryFile } from '../../adapters/filesystem/index.mjs';

export const QA_MARKER_PREFIX = 'AICG_QA_RESULT ';
export function parseWorkUnitResults(stdout) {
  const results = [];
  for (const line of String(stdout ?? '').split(/\r?\n/)) if (line.startsWith(QA_MARKER_PREFIX)) {
    if (line.length > 8192 || results.length >= 1000) return { results: [], error: 'QA marker budget exceeded.' };
    try {
      const entry = JSON.parse(line.slice(QA_MARKER_PREFIX.length));
      if (!entry || entry.schemaVersion !== 1 || typeof entry.workUnitId !== 'string' || typeof entry.caseId !== 'string' || !['passed', 'failed', 'blocked', 'not-applicable'].includes(entry.status)
        || Object.keys(entry).some((key) => !['schemaVersion', 'workUnitId', 'caseId', 'status', 'reason'].includes(key))) throw new Error();
      results.push(entry);
    } catch { return { results: [], error: 'Malformed QA marker.' }; }
  }
  return { results, error: null };
}

export function checkWorkUnit(root, unit, { scan = null, config = {}, changedPaths = [], behaviorPaths = changedPaths, taskApproval = null, memory = null, verification = null, completion = true } = {}) {
  const issues = [];
  const result = () => ({ ok: issues.length === 0, status: issues.length ? 'blocked' : completion ? 'complete' : 'structurally-valid', declaredStatus: unit?.status ?? null, id: unit?.id ?? null, issues, caseResults: [], actionsPerformed: [] });
  try { validateWorkUnit(unit); } catch (error) { issues.push(error.message); return result(); }
  scan ??= scanProject(root, { probeEnvironment: false });
  const paths = unit.scope.flatMap((group) => group.paths);
  for (const relative of behaviorPaths) if (!paths.includes(relative)) issues.push(`work-unit scope omits changed behavior: ${relative}`);
  for (const reference of unit.references) try { if (sha256(readMemoryFile(root, reference.path, 1024 * 1024)) !== reference.sha256) issues.push(`work-unit reference digest mismatch: ${reference.id}`); } catch (error) { issues.push(`work-unit reference: ${error.message}`); }
  const { entries, facts, gaps } = workUnitCoverage(scan, paths);
  if (scan.scanBudget?.complete !== true) issues.push('work-unit coverage incomplete: repository scan budget was exhausted.');
  const cases = new Map(unit.testCases.map((entry) => [entry.id, entry]));
  for (const category of ['success', 'failure']) if (!unit.testCases.some((entry) => entry.category === category && entry.required)) issues.push(`work-unit requires initial ${category} case`);
  for (const entry of unit.testCases) try {
    if (!/(?:^|\/)(?:tests?|__tests__)(?:\/|$)|\.(?:test|spec)\.|(?:^|\/)test_[^/]+|_test\.[^/]+$/.test(entry.testPath)) throw new Error('Unit-test mapping must name a test file, not implementation code.');
    readMemoryFile(root, entry.testPath, 1024 * 1024);
  } catch (error) { issues.push(`work-unit test: ${error.message}`); }
  for (const entry of entries) {
    const coverage = unit.coverage.find((item) => item.entityId === entry.id);
    if (!coverage || coverage.gap || !coverage.testCaseIds.length || coverage.testCaseIds.some((id) => cases.get(id)?.kind !== 'unit' || !cases.get(id)?.required)) issues.push(`work-unit missing unit-test coverage or testability gap: ${entry.id}`);
  }
  for (const coverage of unit.coverage) if (!entries.some((entry) => entry.id === coverage.entityId)) issues.push(`work-unit coverage uses unknown canonical entity: ${coverage.entityId}`);
  for (const entry of [...(unit.manualCoverage ?? []), ...(unit.testabilityGaps ?? [])]) {
    try { if (sha256(readBoundedRepositoryFile(root, entry.path).bytes) !== entry.sourceSha256) issues.push(`work-unit manual coverage source digest mismatch: ${entry.path}`); } catch (error) { issues.push(`work-unit manual coverage source: ${error.message}`); }
    if (entry.referenceIds.some((id) => !unit.references.some((reference) => reference.id === id))) issues.push(`work-unit manual coverage needs bound evidence references: ${entry.path}`);
    for (const surface of entry.entries ?? []) if (surface.testCaseIds.some((id) => cases.get(id)?.kind !== 'unit' || !cases.get(id)?.required)) issues.push(`work-unit manual coverage requires required unit-test cases: ${entry.path}`);
    if (entry.noPublicSurface && entries.some((known) => (known.implementationPath ?? known.path) === entry.path)) issues.push(`work-unit manual no-public-surface contradicts canonical coverage: ${entry.path}`);
  }
  for (const gap of gaps) if (!unit.manualCoverage?.some((entry) => entry.path === gap.path)) issues.push(`work-unit coverage unverified: ${gap.path}: ${gap.reason}; provide a source-bound manual inventory.`);
  for (const gap of unit.testabilityGaps ?? []) issues.push(`work-unit unresolved testability gap: ${gap.path}: ${gap.reason}`);
  const coverageEvidence = { coverageGaps: gaps, manualCoverage: unit.manualCoverage ?? [], coverageBoundary: 'Manual inventories are operator-declared and approval-bound; they do not establish static scan completeness.' };
  for (const category of QA_CATEGORIES) {
    const applicability = unit.qa.applicability.find((entry) => entry.category === category);
    if (!applicability) issues.push(`work-unit missing QA applicability: ${category}`);
    else if (applicability.status === 'applicable' && !unit.testCases.some((entry) => entry.category === category && entry.required && unit.qa.additions.includes(entry.id))) issues.push(`work-unit missing applicable QA addition: ${category}`);
  }
  for (const id of unit.qa.additions) if (!QA_CATEGORIES.includes(cases.get(id)?.category)) issues.push(`work-unit unknown QA addition: ${id}`);
  const roles = selectWorkUnitRoles(config, unit);
  for (const id of unit.roles.selected) if (!roles.selected.includes(id)) issues.push(`work-unit role is not approved for this scope: ${id}`);
  if (unit.memory.decision === 'no-memory-impact' && behaviorPaths.length) issues.push('work-unit no-memory-impact cannot waive production behavior changes.');
  if (unit.memory.decision === 'update') {
    for (const relative of behaviorPaths) if (!unit.memory.paths.includes(relative)) issues.push(`work-unit memory impact omits: ${relative}`);
    let current;
    try { current = loadProjectMemory(root); } catch (error) { issues.push(error.message); }
    const owners = current?.modules ?? facts.modules;
    for (const owner of owners.filter((entry) => entry.owns.some((relative) => behaviorPaths.includes(relative)))) if (!unit.memory.updatedOwners.includes(owner.id)) issues.push(`work-unit memory owner not updated: ${owner.id}`);
  }
  if (!completion) return { ...result(), roles, ...coverageEvidence };
  if (!['verified', 'memory-synced', 'complete'].includes(unit.status)) issues.push('work-unit must reach verified and synchronized memory before completion.');
  if (!taskApproval?.ok || unit.approvalPlanHash !== taskApproval.plan?.planHash) issues.push('work-unit approval does not bind the current plan.');
  if (!memory || memory.issues?.length || memory.status === 'disabled' && behaviorPaths.length) issues.push('work-unit requires synchronized project memory.');
  if (verification?.status !== 'passed' || verification.command !== unit.verification.command || !HASH.test(verification.outputDigest ?? '')
    || verification.inputEvidence?.status !== 'unchanged' || !HASH.test(verification.inputEvidence?.beforeFingerprint ?? '') || verification.inputEvidence.beforeFingerprint !== verification.inputEvidence.afterFingerprint) issues.push('work-unit requires one successful verification with unchanged inputs and output digest.');
  if (verification?.qaError) issues.push(verification.qaError);
  const results = verification?.qaResults ?? [];
  const seen = new Set();
  for (const entry of results) {
    if (!entry || entry.schemaVersion !== 1 || !['passed', 'failed', 'blocked', 'not-applicable'].includes(entry.status)
      || Object.keys(entry).some((key) => !['schemaVersion', 'workUnitId', 'caseId', 'status', 'reason'].includes(key))) { issues.push('work-unit QA result is malformed.'); continue; }
    if (entry.workUnitId !== unit.id || !cases.has(entry.caseId) || seen.has(entry.caseId)) { issues.push('work-unit QA has unknown, duplicate or foreign case IDs.'); continue; }
    seen.add(entry.caseId);
    const expected = cases.get(entry.caseId);
    if (expected.required && entry.status !== 'passed') issues.push(`work-unit required QA case ${entry.caseId} is ${entry.status}`);
    if (entry.status === 'not-applicable' && (typeof entry.reason !== 'string' || !entry.reason.trim() || !unit.qa.applicability.some((item) => item.category === expected.category && item.status === 'not-applicable'))) issues.push(`work-unit QA not-applicable needs approved reason: ${entry.caseId}`);
  }
  for (const entry of unit.testCases) if (!seen.has(entry.id)) issues.push(`work-unit missing QA result: ${entry.id}`);
  return { ...result(), roles, ...coverageEvidence, caseResults: results.filter(Boolean).map((entry) => ({ ...entry, command: verification.command, outputDigest: verification.outputDigest })), verification: verification ? { command: verification.command, status: verification.status, outputDigest: verification.outputDigest, inputEvidence: verification.inputEvidence } : null };
}

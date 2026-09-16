import { readMemoryFile } from '../memory/index.mjs';
import { isSafeRelative, normalizeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { validateProjectProfessionalBoundary } from '../agent-team/index.mjs';

export const WORK_UNIT_LIMIT = 256 * 1024;
export const QA_CATEGORIES = ['abnormal', 'boundary', 'extreme', 'risk'];
export const WORK_UNIT_STATES = ['draft', 'planned', 'approved', 'implementing', 'qa-ready', 'verified', 'memory-synced', 'complete'];
export const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/;
export function fields(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw usageError(`Invalid work-unit ${label} fields.`);
}
function text(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value)) throw usageError(`Invalid work-unit ${label}.`);
}
function array(value, label, limit = 1000) {
  if (!Array.isArray(value) || value.length > limit) throw usageError(`Invalid bounded work-unit ${label}.`);
}
function id(value) { if (typeof value !== 'string' || !ID.test(value)) throw usageError('Invalid work-unit ID.'); }
export function workUnitPath(value) {
  if (typeof value !== 'string' || value.length > 4096 || !isSafeRelative(value) || normalizeRelative(value) !== value || value.split('/').some((part) => part.toLowerCase() === '.git')) throw usageError('work-unit paths must be safe repository-relative paths outside .git.');
  return value;
}
function strings(value, label, check = text) {
  array(value, label);
  for (const entry of value) check(entry, label);
  if (new Set(value).size !== value.length) throw usageError(`Duplicate work-unit ${label}.`);
}
export function validateWorkUnit(value) {
  fields(value, ['schemaVersion', 'id', 'intent', 'taskLevel', 'reviewMode', 'status', 'requirements', 'design', 'scope', 'risks', 'professionalBoundaries', 'roles', 'plan', 'testCases', 'coverage', 'qa', 'verification', 'memory', 'references', 'approvalPlanHash'], 'document');
  if (Buffer.byteLength(stableJson(value)) > WORK_UNIT_LIMIT || value.schemaVersion !== 1) throw usageError('Invalid bounded work-unit schema.');
  id(value.id); text(value.intent, 'intent');
  if (!['L2', 'L3'].includes(value.taskLevel) || !['single', 'quick-review', 'independent-pk', 'high-consequence-pk'].includes(value.reviewMode) || !WORK_UNIT_STATES.includes(value.status)) throw usageError('Invalid work-unit lifecycle route.');
  fields(value.requirements, ['summary', 'acceptanceCriteria'], 'requirements'); text(value.requirements.summary, 'requirements summary'); strings(value.requirements.acceptanceCriteria, 'acceptance criteria');
  if (!value.requirements.acceptanceCriteria.length) throw usageError('Work-unit acceptance criteria are required.');
  if (value.design !== null) text(value.design, 'design');
  if (value.taskLevel === 'L3' && !value.design) throw usageError('L3 work units require design.');
  array(value.scope, 'scope', 32);
  const paths = new Set(), groups = new Set();
  for (const group of value.scope) {
    fields(group, ['id', 'paths'], 'scope group'); id(group.id); strings(group.paths, 'scope paths', workUnitPath);
    if (groups.has(group.id) || !group.paths.length) throw usageError('Work-unit groups must be unique and nonempty.');
    groups.add(group.id);
    for (const relative of group.paths) { if (paths.has(relative)) throw usageError('Work-unit scope paths must have one group.'); paths.add(relative); }
  }
  if (!paths.size) throw usageError('Work-unit scope must not be empty.');
  strings(value.risks, 'risk signals', id);
  array(value.professionalBoundaries, 'professional boundaries', 16);
  const boundaryIds = new Set();
  for (const boundary of value.professionalBoundaries) {
    fields(boundary, ['id', 'humanReviewRequired', 'qualification', 'jurisdiction', 'decisionAuthority', 'reason'], 'professional boundary');
    const { id: boundaryId, ...body } = boundary; id(boundaryId);
    if (boundaryIds.has(boundaryId)) throw usageError('Duplicate work-unit professional boundary.');
    boundaryIds.add(boundaryId); validateProjectProfessionalBoundary({ domainNeedId: boundaryId, ...body });
  }
  fields(value.roles, ['selected', 'recommendations'], 'roles'); strings(value.roles.selected, 'selected roles', id); strings(value.roles.recommendations, 'role recommendations', id);
  strings(value.plan, 'plan'); if (!value.plan.length) throw usageError('Work-unit implementation plan is required.');
  array(value.testCases, 'test cases');
  const ids = new Set();
  for (const entry of value.testCases) {
    fields(entry, ['id', 'category', 'kind', 'required', 'description', 'testPath'], 'test case'); id(entry.id); text(entry.description, 'case description'); workUnitPath(entry.testPath);
    if (ids.has(entry.id) || !['success', 'failure', ...QA_CATEGORIES].includes(entry.category) || !['unit', 'integration'].includes(entry.kind) || typeof entry.required !== 'boolean') throw usageError('Invalid or duplicate work-unit test case.');
    ids.add(entry.id);
  }
  array(value.coverage, 'coverage'); const covered = new Set();
  for (const entry of value.coverage) {
    fields(entry, ['entityId', 'testCaseIds', 'gap'], 'coverage'); id(entry.entityId); strings(entry.testCaseIds, 'coverage case IDs', id);
    if (covered.has(entry.entityId)) throw usageError('Duplicate work-unit coverage.'); covered.add(entry.entityId);
    if (entry.gap !== null) text(entry.gap, 'testability gap');
  }
  fields(value.qa, ['additions', 'applicability', 'results'], 'QA'); strings(value.qa.additions, 'QA additions', id); array(value.qa.applicability, 'QA applicability', 4); array(value.qa.results, 'QA results');
  const categories = new Set();
  for (const entry of value.qa.applicability) {
    fields(entry, ['category', 'status', 'reason'], 'QA applicability'); text(entry.reason, 'QA applicability reason');
    if (!QA_CATEGORIES.includes(entry.category) || categories.has(entry.category) || !['applicable', 'not-applicable'].includes(entry.status)) throw usageError('Invalid or duplicate QA applicability.'); categories.add(entry.category);
  }
  fields(value.verification, ['command', 'evidence'], 'verification'); text(value.verification.command, 'verification command');
  fields(value.memory, ['decision', 'reason', 'paths', 'updatedOwners'], 'memory');
  if (!['update', 'no-memory-impact'].includes(value.memory.decision)) throw usageError('Invalid work-unit memory decision.');
  text(value.memory.reason, 'memory reason'); strings(value.memory.paths, 'memory paths', workUnitPath); strings(value.memory.updatedOwners, 'memory owners', id);
  array(value.references, 'references', 64); const refs = new Set();
  for (const entry of value.references) { fields(entry, ['id', 'path', 'sha256'], 'reference'); id(entry.id); workUnitPath(entry.path); if (refs.has(entry.id) || !HASH.test(entry.sha256 ?? '')) throw usageError('Invalid work-unit reference digest or ID.'); refs.add(entry.id); }
  if (!value.references.length || !HASH.test(value.approvalPlanHash ?? '')) throw usageError('Work-unit approval hash and reference digests are required.');
  return value;
}
export function readWorkUnit(root, relative) {
  workUnitPath(relative);
  if (!relative.endsWith('.json')) throw usageError('work-unit must reference a JSON document.');
  return validateWorkUnit(JSON.parse(readMemoryFile(root, relative, WORK_UNIT_LIMIT)));
}
// Runtime state and execution results cannot hash themselves. Every planning
// decision, including QA additions and no-memory-impact, stays approval-bound.
export function workUnitPlanProjection(unit) {
  const { status, approvalPlanHash, ...plan } = validateWorkUnit(unit);
  return { ...plan, qa: { applicability: unit.qa.applicability, additions: unit.qa.additions }, verification: { command: unit.verification.command } };
}
export function workUnitPlanDigest(unit) { return sha256(stableJson(workUnitPlanProjection(unit))); }

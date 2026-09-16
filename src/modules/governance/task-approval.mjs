import fs from 'node:fs';
import path from 'node:path';
import { assertNoLinkAncestor } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, normalizeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { classifyReviewMode, minimumTaskLevelFromPaths, REVIEW_MODES, validateReviewMode, validateTaskLevel } from './task-routing.mjs';
import { matchSimpleGlob } from '../../shared/index.mjs';
import { TOOL_NAME, SUPPORTED_CONFIRMED_RISK_SIGNALS } from '../../constants.mjs';
import { validateApprovedProjectAgentTeam, validateProjectProfessionalBoundary } from '../agent-team/index.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/;
const BASE = { L0: [], L1: [], L2: ['requirements', 'plan'], L3: ['requirements', 'design', 'plan'] };
const REVIEW = { single: [], 'quick-review': ['implementation', 'targeted-review'], 'independent-pk': ['proposal-1', 'proposal-2', 'referee'], 'high-consequence-pk': ['proposal-1', 'proposal-2', 'proposal-3', 'referee'] };
const REVIEW_FIELDS = ['localReview', 'behaviorChange', 'publicContract', 'multiModule', 'irreversible', 'governance', 'release', 'confirmedRisk', 'multiSurface', 'migration', 'externalAction', 'professionalRisk'];

function object(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !keys.includes(key))) throw usageError(`Invalid ${label} fields; evidence contains references and digests, not copied bodies.`);
}

function safePath(value) {
  if (typeof value !== 'string' || !isSafeRelative(value) || normalizeRelative(value).split('/').some((part) => part.toLowerCase() === '.git')) throw usageError('Approval paths must be safe repository-relative paths outside .git.');
  return normalizeRelative(value);
}

function boundaries(values) {
  if (!Array.isArray(values) || values.length > 16) throw usageError('professionalBoundaries must be a bounded array.');
  const ids = new Set();
  return values.map((value) => {
    object(value, ['id', 'humanReviewRequired', 'qualification', 'jurisdiction', 'decisionAuthority', 'reason'], 'professional boundary');
    if (typeof value.id !== 'string' || !ID.test(value.id) || ids.has(value.id) || value.humanReviewRequired !== true || value.decisionAuthority !== 'human-only') throw usageError('Professional boundaries must retain distinct IDs and human-only review.');
    ids.add(value.id);
    for (const key of ['qualification', 'jurisdiction', 'reason']) if (typeof value[key] !== 'string' || !value[key].trim() || value[key].length > 2000) throw usageError(`Professional boundary ${key} is required.`);
    const { id, ...fields } = value;
    validateProjectProfessionalBoundary({ domainNeedId: id, ...fields });
    return { id: value.id, humanReviewRequired: true, qualification: value.qualification, jurisdiction: value.jurisdiction, decisionAuthority: 'human-only', reason: value.reason };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

export function buildTaskApprovalPlan({ taskLevel, reviewMode, plannedPaths, changeDigest, requiredApprovals = [], professionalBoundaries = [], approvalReceipt = null, confirmedRiskSignals = [] }) {
  validateTaskLevel(taskLevel);
  validateReviewMode(reviewMode);
  if (!taskLevel || !reviewMode) throw usageError('Approval plans require explicit taskLevel and reviewMode.');
  if (!Array.isArray(plannedPaths) || plannedPaths.length > 10000) throw usageError('plannedPaths must be a bounded path array.');
  if (typeof changeDigest !== 'string' || !HASH.test(changeDigest)) throw usageError('changeDigest must bind the current change content with SHA256.');
  if (!Array.isArray(requiredApprovals) || requiredApprovals.length > 64) throw usageError('requiredApprovals must contain at most 64 entries before normalization.');
  if (requiredApprovals.some((id) => typeof id !== 'string' || !ID.test(id))) throw usageError('requiredApprovals must contain approval IDs.');
  const professional = boundaries(professionalBoundaries);
  if (!Array.isArray(confirmedRiskSignals) || confirmedRiskSignals.length > 16 || confirmedRiskSignals.some((signal) => !SUPPORTED_CONFIRMED_RISK_SIGNALS.includes(signal))) throw usageError('Invalid task-local confirmed risk signals.');
  const mergedApprovals = [...new Set([...BASE[taskLevel], ...REVIEW[reviewMode], ...requiredApprovals, ...professional.map((item) => `human:${item.id}`)])].sort();
  if (mergedApprovals.length > 64) throw usageError('Merged requiredApprovals must contain at most 64 entries.');
  const plan = {
    schemaVersion: 1, taskLevel, reviewMode,
    plannedPaths: [...new Set(plannedPaths.map(safePath))].sort(),
    changeDigest,
    requiredApprovals: mergedApprovals,
    professionalBoundaries: professional,
    approvalReceiptDigest: approvalReceipt === null ? null : sha256(stableJson(approvalReceipt)),
    confirmedRiskSignals: [...new Set(confirmedRiskSignals)].sort(),
  };
  return { ...plan, planHash: sha256(stableJson(plan)) };
}

export function readBoundedTaskFile(root, relative, limit) {
  const safe = safePath(relative);
  assertNoLinkAncestor(root, safe);
  const absolute = path.join(root, safe);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.size > limit) throw usageError('Approval evidence must be a bounded regular file.');
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || current.size > limit) throw usageError('Approval evidence changed while reading.');
    const bytes = Buffer.alloc(limit + 1);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    if (length > limit) throw usageError('Approval evidence exceeds its size budget.');
    return bytes.subarray(0, length);
  } finally { fs.closeSync(fd); }
}

function readEvidence(root, relative) {
  const evidence = JSON.parse(readBoundedTaskFile(root, relative, 65536).toString('utf8'));
  object(evidence, ['schemaVersion', 'planHash', 'reviewEvidence', 'professionalBoundaries', 'approvals'], 'approval evidence');
  if (evidence.schemaVersion !== 1 || !HASH.test(evidence.planHash) || !Array.isArray(evidence.approvals) || evidence.approvals.length > 64) throw usageError('Malformed approval evidence.');
  object(evidence.reviewEvidence, REVIEW_FIELDS, 'review evidence');
  classifyReviewMode(evidence.reviewEvidence);
  boundaries(evidence.professionalBoundaries);
  const ids = new Set();
  for (const record of evidence.approvals) {
    object(record, ['id', 'reference', 'sha256', 'source', 'participantId', 'qualification', 'jurisdiction', 'responsibleHuman'], 'approval reference');
    if (typeof record.id !== 'string' || !ID.test(record.id) || ids.has(record.id) || !HASH.test(record.sha256) || record.source !== 'operator-declared') throw usageError('Approval references require distinct IDs, digests and operator-declared provenance.');
    ids.add(record.id);
    if (sha256(readBoundedTaskFile(root, record.reference, 1024 * 1024)) !== record.sha256) throw usageError('Approval reference digest mismatch.');
  }
  return evidence;
}

export function evaluateTaskApproval(root, { taskLevel, reviewMode = null, plannedPaths, changeDigest, requiredApprovals = [], professionalBoundaries = [], reviewEvidence = {}, approvalEvidence = null, approve = null, professionalGap = null, confirmedRiskSignals = [] }) {
  validateReviewMode(reviewMode);
  const result = { ok: false, status: 'missing-evidence', evidenceLevel: 'operator-declared', identityVerified: false, review: null, plan: null, gaps: [] };
  const fail = (status, gap) => ({ ...result, status, gaps: [gap] });
  let evidence;
  try { evidence = approvalEvidence === null ? null : readEvidence(root, approvalEvidence); }
  catch { return fail('invalid-evidence', 'Approval evidence or referenced files are malformed, unsafe, unreadable, oversized, or digest-mismatched.'); }
  const declaredBoundaries = boundaries(evidence?.professionalBoundaries ?? []);
  const knownBoundaries = boundaries(professionalBoundaries);
  const mergedBoundaries = new Map(declaredBoundaries.map((item) => [item.id, item]));
  for (const boundary of knownBoundaries) {
    if (mergedBoundaries.has(boundary.id) && stableJson(mergedBoundaries.get(boundary.id)) !== stableJson(boundary)) return fail('professional-review-gap', 'Evidence cannot redefine a confirmed human-review boundary.');
    mergedBoundaries.set(boundary.id, boundary);
  }
  const professional = boundaries([...mergedBoundaries.values()]);
  // Independent caller evidence and path-derived facts can only raise the minimum.
  const declaredReview = classifyReviewMode({ ...evidence?.reviewEvidence, plannedPaths });
  const currentReview = classifyReviewMode({ ...reviewEvidence, plannedPaths });
  const boundaryReview = classifyReviewMode(professional.length ? { professionalRisk: 'human-review-boundary' } : {});
  const minimum = [declaredReview, currentReview, boundaryReview].sort((a, b) => REVIEW_MODES.indexOf(b.mode) - REVIEW_MODES.indexOf(a.mode))[0];
  const effectiveMode = reviewMode ?? minimum.mode;
  const rank = REVIEW_MODES.indexOf(effectiveMode);
  result.review = { mode: effectiveMode, minimumMode: minimum.mode, triggers: [...declaredReview.triggers, ...currentReview.triggers, ...boundaryReview.triggers], requiredRoleCount: [1, 2, 3, 4][rank], independenceRequired: rank >= 1 };
  if (!Array.isArray(requiredApprovals) || requiredApprovals.length > 64) throw usageError('requiredApprovals must contain at most 64 entries before merging.');
  const extraApprovals = [...requiredApprovals];
  if (reviewEvidence.externalAction || evidence?.reviewEvidence.externalAction) extraApprovals.push('external-action');
  const approvalReceipt = evidence ? {
    schemaVersion: evidence.schemaVersion,
    reviewEvidence: evidence.reviewEvidence,
    professionalBoundaries: declaredBoundaries,
    approvals: evidence.approvals.map((record) => ({ ...record, reference: safePath(record.reference) })).sort((a, b) => a.id.localeCompare(b.id)),
  } : null;
  result.plan = buildTaskApprovalPlan({ taskLevel, reviewMode: effectiveMode, plannedPaths, changeDigest, requiredApprovals: extraApprovals, professionalBoundaries: professional, approvalReceipt, confirmedRiskSignals });
  if (professionalGap) return fail('professional-review-gap', professionalGap);
  if (REVIEW_MODES.indexOf(effectiveMode) < REVIEW_MODES.indexOf(minimum.mode)) return fail('review-upgrade-required', `Review mode requires at least ${minimum.mode}.`);
  if (!evidence && result.plan.requiredApprovals.length === 0 && approve === null) return { ...result, ok: true, status: 'not-required' };
  if (!evidence) return fail('missing-evidence', 'Provide a repository-relative approval JSON file containing reference digests.');
  if (evidence.planHash !== result.plan.planHash) return fail('stale-plan', 'Approval evidence does not bind the current task level, review mode, paths and professional boundaries.');
  if (approve !== result.plan.planHash) return fail('approval-required', 'Explicit --approve must match the current planHash.');
  const records = new Map(evidence.approvals.map((item) => [item.id, item]));
  if (result.plan.requiredApprovals.some((id) => !records.has(id))) return fail('missing-approval', 'One or more required approval references are missing.');
  const reviewers = REVIEW[effectiveMode].map((id) => records.get(id));
  if (reviewers.some((record) => typeof record.participantId !== 'string' || !ID.test(record.participantId)) || new Set(reviewers.map((record) => record.participantId)).size !== reviewers.length) return fail('independence-gap', 'Required review participants must have distinct operator-declared IDs; identity is not verified.');
  if (rank >= 1 && (new Set(reviewers.map((record) => safePath(record.reference))).size !== reviewers.length || new Set(reviewers.map((record) => record.sha256)).size !== reviewers.length)) return fail('independence-gap', 'Implementation/review participants and independent proposals require distinct reference paths and content digests.');
  if ((evidence.reviewEvidence.professionalRisk || reviewEvidence.professionalRisk) && professional.length === 0) return fail('professional-review-gap', 'Confirmed professional risk requires a human-review boundary with qualification and jurisdiction.');
  for (const boundary of professional) {
    const record = records.get(`human:${boundary.id}`);
    const resolved = (value) => typeof value === 'string' && value.trim() && !/(?:open-gap|unknown|unconfirmed|tbd)/i.test(value);
    if (!resolved(boundary.qualification) || !resolved(boundary.jurisdiction) || record.qualification !== boundary.qualification || record.jurisdiction !== boundary.jurisdiction || !resolved(record.responsibleHuman)) return fail('professional-review-gap', 'Qualified human review, jurisdiction and responsible person remain an operator-declared requirement.');
  }
  return { ...result, ok: true, status: 'approved' };
}

// Managed project decisions, not the completion operator, own professional scope.
// The shared project-team validator owns all persisted role and boundary semantics.
export function trustedProfessionalTaskContext(root, config, plannedPaths) {
  const relative = 'docs/ai/agent-team.json';
  const result = { professionalBoundaries: [], professionalGap: null };
  const scopeNeedsMapping = ['L2', 'L3'].includes(minimumTaskLevelFromPaths(plannedPaths)) || plannedPaths.includes(relative);
  try {
    assertNoLinkAncestor(root, relative);
    if (!fs.existsSync(path.join(root, relative))) return result;
    const bytes = readBoundedTaskFile(root, relative, 65536);
    const manifest = JSON.parse(readBoundedTaskFile(root, '.ai-governance/manifest.json', 1024 * 1024));
    const entries = manifest.files?.filter((entry) => entry?.path === relative);
    if (manifest.schemaVersion !== 1 || manifest.generatedBy !== TOOL_NAME || entries?.length !== 1 || entries[0].ownership !== 'full' || entries[0].sha256 !== sha256(bytes)) throw usageError('Project role roster is not bound to a current managed manifest.');
    const roster = JSON.parse(bytes);
    const { roles, ...team } = roster;
    validateApprovedProjectAgentTeam(team);
    if (stableJson(roles) !== stableJson(team.roleProposals)) throw usageError('Project roster projection conflicts with its approved team.');
    const known = new Map();
    for (const role of roster.roles) {
      const raw = role.professionalBoundaries ?? [];
      const normalized = boundaries(raw.map((boundary) => {
        if (!boundary || typeof boundary !== 'object') throw usageError('Invalid professional boundary.');
        const { domainNeedId, ...fields } = boundary;
        return { ...fields, id: domainNeedId ?? fields.id };
      }));
      if (normalized.length === 0) continue;
      const activation = role.activation;
      if (!activation || !Array.isArray(activation.signals) || activation.signals.length === 0 || activation.signals.length > 16 || activation.signals.some((id) => !SUPPORTED_CONFIRMED_RISK_SIGNALS.includes(id)) || !Array.isArray(activation.paths) || activation.paths.length === 0 || activation.paths.length > 32 || activation.paths.some((value) => typeof value !== 'string' || value.length > 256 || !isSafeRelative(value))) {
        if (scopeNeedsMapping) result.professionalGap = 'Approved professional scope lacks an explicit risk-signal/path mapping; record owner-confirmed applicability before completion.';
        continue;
      }
      // Explicit owner-confirmed scope applies even to otherwise ordinary documents.
      if (!plannedPaths.some((value) => activation.paths.some((pattern) => matchSimpleGlob(value, pattern)))) continue;
      if (!activation.signals.some((signal) => config.confirmedRiskSignals?.includes(signal))) {
        result.professionalGap = 'Changed professional scope needs its mapped owner-confirmed risk signal; operator omission cannot waive applicability.';
        continue;
      }
      for (const boundary of normalized) {
        if (known.has(boundary.id) && stableJson(known.get(boundary.id)) !== stableJson(boundary)) throw usageError('Conflicting professional boundaries.');
        known.set(boundary.id, boundary);
      }
    }
    result.professionalBoundaries = [...known.values()];
    return result;
  } catch {
    return { ...result, professionalGap: 'Cannot safely verify the managed, approved project professional scope and boundaries.' };
  }
}

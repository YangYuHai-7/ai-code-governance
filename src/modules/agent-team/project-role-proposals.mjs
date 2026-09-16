import path from 'node:path';
import { PACKAGE_ROOT } from '../../constants.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';

const PROFESSIONAL_BOUNDARIES_PATH = 'assets/policies/professional-domain-boundaries.json';
const MAX_IDENTIFIER_BYTES = 128;
const ROLE_ID = /^(?=.{1,128}$)[a-z0-9]+(?:-[a-z0-9]+)*$/;
const EVIDENCE_ID = /^(?=.{1,128}$)[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
const SAFE_TEXT = /^[^\x00-\x1f\x7f]{1,1000}$/;
const PROJECT_MODES = new Set(['greenfield', 'brownfield']);
const EVIDENCE_KINDS = new Set(['repository-fact', 'user-confirmed-domain', 'user-confirmed-project']);
const MAX_RECOMMENDATIONS = 5;
const MAX_EVIDENCE = 32;
const MAX_DOMAIN_NEEDS = 16;
const MAX_APPROVED_ROLES = 32;
const MAX_CAPABILITIES_PER_ROLE = 16;
const MAX_RESPONSIBILITIES_PER_ROLE = 16;
const MAX_OUT_OF_SCOPE_PER_ROLE = 16;
const MAX_DOMAIN_NEEDS_PER_ROLE = 8;
const MAX_EVIDENCE_PER_ROLE = 16;
const MAX_SKILLS_PER_ROLE = 16;
const MAX_INDEPENDENCE_RELATIONS_PER_ROLE = 16;
const REQUIRED_PROFESSIONAL_QUALIFICATIONS = new Map([
  ['contract-law', 'licensed-lawyer'],
  ['medical-care', 'licensed-clinician'],
  ['financial-services', 'licensed-financial-professional'],
  ['food-safety', 'qualified-food-safety-professional'],
]);

function sortedStrings(values) {
  return [...values].sort((left, right) => left.localeCompare(right));
}

function requiredId(value, field) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_IDENTIFIER_BYTES || !ROLE_ID.test(value)) throw usageError(`${field} must be a lowercase kebab-case identifier of at most ${MAX_IDENTIFIER_BYTES} characters and bytes.`);
  return value;
}

function requiredEvidenceId(value, field) {
  if (typeof value !== 'string' || Buffer.byteLength(value, 'utf8') > MAX_IDENTIFIER_BYTES || !EVIDENCE_ID.test(value)) throw usageError(`${field} must be a stable lowercase evidence identifier of at most ${MAX_IDENTIFIER_BYTES} characters and bytes.`);
  return value;
}

function requiredText(value, field) {
  if (typeof value !== 'string' || !SAFE_TEXT.test(value) || !value.trim()) throw usageError(`${field} must be printable text of at most 1000 characters.`);
  return value.trim();
}

function boundedArray(value, field, { allowEmpty = true, max } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) throw usageError(`${field} must be ${allowEmpty ? 'an array' : 'a non-empty array'}.`);
  if (value.length > max) throw usageError(`${field} must contain at most ${max} entries.`);
  return value;
}

function idArray(value, field, { allowEmpty = true, max = MAX_CAPABILITIES_PER_ROLE } = {}) {
  boundedArray(value, field, { allowEmpty, max });
  const ids = value.map((entry) => requiredId(entry, field));
  if (new Set(ids).size !== ids.length) throw usageError(`${field} must not contain duplicate identifiers.`);
  return sortedStrings(ids);
}

function evidenceIdArray(value, field, { allowEmpty = true, max = MAX_EVIDENCE_PER_ROLE } = {}) {
  boundedArray(value, field, { allowEmpty, max });
  const ids = value.map((entry) => requiredEvidenceId(entry, field));
  if (new Set(ids).size !== ids.length) throw usageError(`${field} must not contain duplicate identifiers.`);
  return sortedStrings(ids);
}

function textArray(value, field, max) {
  boundedArray(value, field, { allowEmpty: false, max });
  return value.map((entry) => requiredText(entry, field));
}

function object(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw usageError(`${field} must be an object.`);
  return value;
}

function exactKeys(value, field, allowed, required = allowed) {
  const keys = Object.keys(value);
  if (keys.some((key) => !allowed.has(key))) throw usageError(`${field} contains an unsupported field.`);
  if ([...required].some((key) => !Object.hasOwn(value, key))) throw usageError(`${field} is missing a required field.`);
}

function normalizeEvidence(evidence) {
  boundedArray(evidence, 'evidence', { allowEmpty: false, max: MAX_EVIDENCE });
  const byId = new Map();
  for (const [index, raw] of evidence.entries()) {
    const item = object(raw, `evidence[${index}]`);
    exactKeys(item, `evidence[${index}]`, new Set(['id', 'kind']), ['id', 'kind']);
    const id = requiredEvidenceId(item.id, `evidence[${index}].id`);
    if (!EVIDENCE_KINDS.has(item.kind)) throw usageError(`evidence[${index}].kind is not supported.`);
    if (byId.has(id)) throw usageError(`evidence contains duplicate id: ${id}.`);
    byId.set(id, { id, kind: item.kind });
  }
  return byId;
}

function normalizeDomainNeeds(domainNeeds, evidenceById) {
  boundedArray(domainNeeds, 'confirmedDomainNeeds', { max: MAX_DOMAIN_NEEDS });
  const byId = new Map();
  for (const [index, raw] of domainNeeds.entries()) {
    const item = object(raw, `confirmedDomainNeeds[${index}]`);
    exactKeys(item, `confirmedDomainNeeds[${index}]`, new Set(['id', 'label', 'evidenceIds', 'jurisdiction']), ['id', 'label', 'evidenceIds']);
    const id = requiredId(item.id, `confirmedDomainNeeds[${index}].id`);
    if (byId.has(id)) throw usageError(`confirmedDomainNeeds contains duplicate id: ${id}.`);
    const evidenceIds = evidenceIdArray(item.evidenceIds, `confirmedDomainNeeds[${index}].evidenceIds`, { allowEmpty: false });
    for (const evidenceId of evidenceIds) {
      if (evidenceById.get(evidenceId)?.kind !== 'user-confirmed-domain') {
        throw usageError(`confirmedDomainNeeds.${id} must cite user-confirmed-domain evidence.`);
      }
    }
    const jurisdiction = item.jurisdiction === undefined ? null : requiredText(item.jurisdiction, `confirmedDomainNeeds[${index}].jurisdiction`);
    byId.set(id, { id, label: requiredText(item.label, `confirmedDomainNeeds[${index}].label`), evidenceIds, jurisdiction });
  }
  return byId;
}

function normalizeApprovedRoles(value) {
  if (value === undefined) return [];
  boundedArray(value, 'approvedRoles', { max: MAX_APPROVED_ROLES });
  const ids = new Set();
  const capabilities = new Set();
  const roles = value.map((raw, index) => {
    const role = object(raw, `approvedRoles[${index}]`);
    exactKeys(role, `approvedRoles[${index}]`, new Set(['id', 'capabilities']), ['id', 'capabilities']);
    const id = requiredId(role.id, `approvedRoles[${index}].id`);
    if (ids.has(id)) throw usageError(`approvedRoles contains duplicate id: ${id}.`);
    ids.add(id);
    const normalizedCapabilities = idArray(role.capabilities, `approvedRoles[${index}].capabilities`, { allowEmpty: false, max: MAX_CAPABILITIES_PER_ROLE });
    for (const capability of normalizedCapabilities) {
      if (capabilities.has(capability)) throw usageError(`approvedRoles assigns capability ${capability} more than once.`);
      capabilities.add(capability);
    }
    return { id, capabilities: normalizedCapabilities };
  });
  return roles.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeRoleNeeds(roleNeeds, domainsById, evidenceById, approvedRoles, maxRecommendations) {
  if (!Array.isArray(roleNeeds)) throw usageError('roleNeeds must be an array.');
  if (roleNeeds.length > maxRecommendations) throw usageError(`roleNeeds exceeds the maximum of ${maxRecommendations} recommendations.`);
  const approvedIds = new Set(approvedRoles.map((role) => role.id));
  const approvedCapabilities = new Set(approvedRoles.flatMap((role) => role.capabilities));
  const ids = new Set();
  const capabilities = new Set(approvedCapabilities);
  const roles = roleNeeds.map((raw, index) => {
    const role = object(raw, `roleNeeds[${index}]`);
    exactKeys(role, `roleNeeds[${index}]`, new Set([
      'id', 'title', 'capabilities', 'responsibilities', 'outOfScope', 'domainNeedIds', 'evidenceIds', 'skillIds', 'mustRemainIndependentFrom',
    ]));
    const id = requiredId(role.id, `roleNeeds[${index}].id`);
    if (ids.has(id) || approvedIds.has(id)) throw usageError(`roleNeeds contains a duplicate or already approved role id: ${id}.`);
    ids.add(id);
    const normalizedCapabilities = idArray(role.capabilities, `roleNeeds[${index}].capabilities`, { allowEmpty: false, max: MAX_CAPABILITIES_PER_ROLE });
    for (const capability of normalizedCapabilities) {
      if (capabilities.has(capability)) throw usageError(`roleNeeds assigns capability ${capability} more than once.`);
      capabilities.add(capability);
    }
    const domainNeedIds = idArray(role.domainNeedIds, `roleNeeds[${index}].domainNeedIds`, { max: MAX_DOMAIN_NEEDS_PER_ROLE });
    for (const domainNeedId of domainNeedIds) {
      if (!domainsById.has(domainNeedId)) throw usageError(`roleNeeds.${id} references an unconfirmed domain need: ${domainNeedId}.`);
    }
    const evidenceIds = evidenceIdArray(role.evidenceIds, `roleNeeds[${index}].evidenceIds`, { allowEmpty: false, max: MAX_EVIDENCE_PER_ROLE });
    for (const evidenceId of evidenceIds) {
      if (!evidenceById.has(evidenceId)) throw usageError(`roleNeeds.${id} references unknown evidence: ${evidenceId}.`);
    }
    return {
      id,
      title: requiredText(role.title, `roleNeeds[${index}].title`),
      capabilities: normalizedCapabilities,
      responsibilities: textArray(role.responsibilities, `roleNeeds[${index}].responsibilities`, MAX_RESPONSIBILITIES_PER_ROLE),
      outOfScope: textArray(role.outOfScope, `roleNeeds[${index}].outOfScope`, MAX_OUT_OF_SCOPE_PER_ROLE),
      domainNeedIds,
      evidenceIds,
      skillIds: idArray(role.skillIds, `roleNeeds[${index}].skillIds`, { max: MAX_SKILLS_PER_ROLE }),
      mustRemainIndependentFrom: idArray(role.mustRemainIndependentFrom, `roleNeeds[${index}].mustRemainIndependentFrom`, { max: MAX_INDEPENDENCE_RELATIONS_PER_ROLE }),
    };
  });
  const knownRoleIds = new Set([...approvedIds, ...ids]);
  for (const role of roles) {
    for (const relatedId of role.mustRemainIndependentFrom) {
      if (relatedId === role.id || !knownRoleIds.has(relatedId)) throw usageError(`roleNeeds.${role.id} references an unknown or self independent role: ${relatedId}.`);
    }
    if (role.domainNeedIds.length === 0 && !role.evidenceIds.some((evidenceId) => evidenceById.get(evidenceId)?.kind === 'user-confirmed-project')) {
      throw usageError(`roleNeeds.${role.id} without domain needs must cite user-confirmed-project evidence.`);
    }
    if (role.domainNeedIds.length > 0 && !role.evidenceIds.some((evidenceId) => evidenceById.get(evidenceId)?.kind === 'user-confirmed-domain')) {
      throw usageError(`roleNeeds.${role.id} with domain needs must cite user-confirmed-domain evidence.`);
    }
  }
  return roles.sort((left, right) => left.id.localeCompare(right.id));
}

export function validateProfessionalDomainBoundaryPolicy(policy) {
  if (!policy || policy.schemaVersion !== 1 || policy.policyType !== 'professional-domain-boundaries' || !Array.isArray(policy.boundaries)) {
    throw usageError('Professional domain boundary policy is invalid.');
  }
  const byDomainNeedId = new Map();
  for (const [index, raw] of policy.boundaries.entries()) {
    const boundary = object(raw, `professional boundary ${index}`);
    exactKeys(boundary, `professional boundary ${index}`, new Set([
      'domainNeedId', 'humanReviewRequired', 'qualification', 'jurisdictionRequired', 'decisionAuthority', 'reason',
    ]));
    const domainNeedId = requiredId(boundary.domainNeedId, `professional boundary ${index}.domainNeedId`);
    if (byDomainNeedId.has(domainNeedId)) throw usageError(`Professional domain boundary policy duplicates ${domainNeedId}.`);
    if (boundary.humanReviewRequired !== true || boundary.jurisdictionRequired !== true || boundary.decisionAuthority !== 'human-only') {
      throw usageError(`Professional domain boundary ${domainNeedId} must retain required human review and human-only authority.`);
    }
    const qualification = requiredId(boundary.qualification, `professional boundary ${index}.qualification`);
    const requiredQualification = REQUIRED_PROFESSIONAL_QUALIFICATIONS.get(domainNeedId);
    if (requiredQualification && qualification !== requiredQualification) {
      throw usageError(`Professional domain boundary ${domainNeedId} must retain required qualification ${requiredQualification}.`);
    }
    byDomainNeedId.set(domainNeedId, {
      humanReviewRequired: true,
      qualification,
      jurisdictionRequired: true,
      decisionAuthority: 'human-only',
      reason: requiredText(boundary.reason, `professional boundary ${index}.reason`),
    });
  }
  for (const domainNeedId of REQUIRED_PROFESSIONAL_QUALIFICATIONS.keys()) {
    if (!byDomainNeedId.has(domainNeedId)) throw usageError(`Professional domain boundary policy is missing required domain rule: ${domainNeedId}.`);
  }
  return byDomainNeedId;
}

function loadPolicy(policyPath = path.join(PACKAGE_ROOT, PROFESSIONAL_BOUNDARIES_PATH)) {
  return validateProfessionalDomainBoundaryPolicy(readJson(policyPath));
}

function normalizeOptions(options) {
  if (options === undefined) return { maxRecommendations: MAX_RECOMMENDATIONS };
  const value = object(options, 'options');
  exactKeys(value, 'options', new Set(['maxRecommendations']));
  const maxRecommendations = value.maxRecommendations ?? MAX_RECOMMENDATIONS;
  if (!Number.isInteger(maxRecommendations) || maxRecommendations < 1 || maxRecommendations > MAX_RECOMMENDATIONS) {
    throw usageError(`options.maxRecommendations must be an integer from 1 to ${MAX_RECOMMENDATIONS}.`);
  }
  return { maxRecommendations };
}

function boundaryForDomain(domain, policy) {
  const rule = policy.get(domain.id);
  if (!rule) return null;
  return {
    domainNeedId: domain.id,
    humanReviewRequired: true,
    qualification: rule.qualification,
    jurisdiction: domain.jurisdiction ?? 'user-confirmed-or-open-gap',
    decisionAuthority: 'human-only',
    reason: rule.reason,
  };
}

function gapsForBoundary(boundary) {
  const gaps = [{
    id: `human-review.${boundary.domainNeedId}`,
    kind: 'qualified-human-review-required',
    domainNeedId: boundary.domainNeedId,
    qualification: boundary.qualification,
    decisionAuthority: 'human-only',
  }];
  if (boundary.jurisdiction === 'user-confirmed-or-open-gap') {
    gaps.push({
      id: `jurisdiction.${boundary.domainNeedId}`,
      kind: 'user-confirmed-jurisdiction-required',
      domainNeedId: boundary.domainNeedId,
    });
  }
  return gaps;
}

export function proposeProjectAgentTeam(input, options) {
  const request = object(input, 'input');
  exactKeys(request, 'input', new Set(['projectMode', 'evidence', 'confirmedDomainNeeds', 'roleNeeds', 'approvedRoles']), [
    'projectMode', 'evidence', 'confirmedDomainNeeds', 'roleNeeds',
  ]);
  if (!PROJECT_MODES.has(request.projectMode)) throw usageError('projectMode must be greenfield or brownfield.');
  const normalizedOptions = normalizeOptions(options);
  const evidenceById = normalizeEvidence(request.evidence);
  const domainsById = normalizeDomainNeeds(request.confirmedDomainNeeds, evidenceById);
  const approvedRoles = normalizeApprovedRoles(request.approvedRoles);
  const roleNeeds = normalizeRoleNeeds(request.roleNeeds, domainsById, evidenceById, approvedRoles, normalizedOptions.maxRecommendations);
  const policy = loadPolicy();
  const professionalBoundaries = [...domainsById.values()]
    .map((domain) => boundaryForDomain(domain, policy))
    .filter(Boolean)
    .sort((left, right) => left.domainNeedId.localeCompare(right.domainNeedId));
  const boundariesByDomain = new Map(professionalBoundaries.map((boundary) => [boundary.domainNeedId, boundary]));
  const roleProposals = roleNeeds.map((role) => {
    const roleProfessionalBoundaries = role.domainNeedIds
      .map((domainNeedId) => boundariesByDomain.get(domainNeedId))
      .filter(Boolean);
    return {
      ...role,
      status: 'recommended',
      origin: 'dynamic-project-role',
      ...(roleProfessionalBoundaries.length > 0 ? { professionalBoundaries: roleProfessionalBoundaries } : {}),
      ...(roleProfessionalBoundaries.length === 1 ? { professionalBoundary: roleProfessionalBoundaries[0] } : {}),
    };
  });
  const gaps = professionalBoundaries
    .flatMap((boundary) => gapsForBoundary(boundary))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    teamType: 'project-ai-agent-team',
    status: 'recommendation',
    projectMode: request.projectMode,
    roleProposals,
    professionalBoundaries,
    gaps,
    actionsPerformed: [],
  };
}

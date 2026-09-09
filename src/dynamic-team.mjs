import path from 'node:path';
import { PACKAGE_ROOT } from './constants.mjs';
import { readJson, usageError } from './utils.mjs';

const PRODUCT_TEAM_PATH = 'assets/aicg-product-team.json';
const SAFE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SAFE_TEXT = /^[^\x00-\x1f\x7f]{1,1000}$/;
const PHASES = new Set(['core', 'specialist', 'specialist-pool', 'scale', 'dynamic']);
const REQUIRED_ROLE_IDS = new Set([
  'product-owner',
  'principal-governance-architect',
  'cli-cross-platform-engineer',
  'agent-integration-engineer',
  'applied-ai-knowledge-engineer',
  'adversarial-evaluation-release-engineer',
  'developer-experience-solutions-engineer',
  'product-security-engineer',
  'product-designer',
  'full-stack-control-plane-engineer',
  'platform-sre',
  'enterprise-security-compliance-lead',
  'developer-relations',
  'sales-customer-success',
  'technology-stack-certification-specialist',
]);

function uniqueSortedStrings(value, field, { allowEmpty = true } = {}) {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0) || value.some((item) => typeof item !== 'string' || !SAFE_ID.test(item))) {
    throw usageError(`${field} must contain ${allowEmpty ? 'only ' : 'one or more '}lowercase kebab-case identifiers.`);
  }
  if (new Set(value).size !== value.length) throw usageError(`${field} must not contain duplicates.`);
  return [...value].sort((left, right) => left.localeCompare(right));
}

function textArray(value, field) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== 'string' || !SAFE_TEXT.test(item))) {
    throw usageError(`${field} must contain one or more printable strings.`);
  }
  return [...value];
}

function validateRole(role, field, { dynamic = false } = {}) {
  if (!role || typeof role !== 'object' || Array.isArray(role) || !SAFE_ID.test(role.id ?? '')) throw usageError(`${field} contains an invalid role id.`);
  if (typeof role.title !== 'string' || !SAFE_TEXT.test(role.title)) throw usageError(`${field}.${role.id}.title must be printable text.`);
  if (!PHASES.has(role.phase)) throw usageError(`${field}.${role.id}.phase is invalid.`);
  const normalized = {
    id: role.id,
    title: role.title,
    phase: role.phase,
    responsibilities: textArray(role.responsibilities, `${field}.${role.id}.responsibilities`),
    outOfScope: textArray(role.outOfScope, `${field}.${role.id}.outOfScope`),
    capabilities: uniqueSortedStrings(role.capabilities, `${field}.${role.id}.capabilities`, { allowEmpty: false }),
    requiredCompanionRoleIds: uniqueSortedStrings(role.requiredCompanionRoleIds ?? [], `${field}.${role.id}.requiredCompanionRoleIds`),
    mustRemainIndependentFrom: uniqueSortedStrings(role.mustRemainIndependentFrom ?? [], `${field}.${role.id}.mustRemainIndependentFrom`),
  };
  if (!dynamic) return normalized;
  if (role.phase !== 'dynamic') throw usageError(`${field}.${role.id}.phase must be dynamic.`);
  if (!role.approval || role.approval.status !== 'approved' || role.approval.approvedBy !== 'product-owner' || typeof role.approval.evidence !== 'string' || !SAFE_TEXT.test(role.approval.evidence)) {
    throw usageError(`${field}.${role.id} needs explicit product-owner approval evidence.`);
  }
  return {
    ...normalized,
    approval: {
      status: 'approved',
      approvedBy: 'product-owner',
      evidence: role.approval.evidence,
    },
  };
}

function validateRoleGraph(roles, field) {
  const ids = new Set();
  const capabilityOwners = new Map();
  for (const role of roles) {
    if (ids.has(role.id)) throw usageError(`${field} contains duplicate role id: ${role.id}.`);
    ids.add(role.id);
    for (const capability of role.capabilities) {
      if (capabilityOwners.has(capability)) throw usageError(`${field} assigns capability ${capability} to more than one role.`);
      capabilityOwners.set(capability, role.id);
    }
  }
  for (const role of roles) {
    for (const relatedId of [...role.requiredCompanionRoleIds, ...role.mustRemainIndependentFrom]) {
      if (!ids.has(relatedId) || relatedId === role.id) throw usageError(`${field}.${role.id} references an unknown or self role: ${relatedId}.`);
    }
  }
  return { ids, capabilityOwners };
}

export function validateAicgProductTeamRegistry(registry) {
  const policy = registry?.membershipPolicy;
  if (!registry || registry.schemaVersion !== 1 || registry.teamId !== 'aicg-product-team' || registry.teamName !== 'AICG Product Team' || !Array.isArray(registry.roles)) {
    throw usageError('AICG product team registry must declare schemaVersion 1, its stable team id, name, and roles.');
  }
  if (!policy || policy.membershipStatus !== 'approved-available' || policy.activationMode !== 'on-demand' || policy.assignmentStrategy !== 'minimum-sufficient-set' || policy.newRolePolicy !== 'propose-then-product-owner-approve' || policy.unapprovedRolesMayActivate !== false || policy.implementationMaySelfApprove !== false) {
    throw usageError('AICG product team registry must enforce on-demand assignment and explicit role approval.');
  }
  const roles = registry.roles.map((role) => validateRole(role, 'roles'));
  const { ids } = validateRoleGraph(roles, 'roles');
  for (const id of REQUIRED_ROLE_IDS) if (!ids.has(id)) throw usageError(`AICG product team registry is missing required role: ${id}.`);
  return { ...registry, roles };
}

export function loadAicgProductTeamRegistry(registryPath = path.join(PACKAGE_ROOT, PRODUCT_TEAM_PATH)) {
  return validateAicgProductTeamRegistry(readJson(registryPath));
}

function validateProposedRole(role, field) {
  const normalized = validateRole({ ...role, phase: 'dynamic' }, field);
  return normalized;
}

export function normalizeDynamicTeamContext(context = {}) {
  const requiredCapabilities = uniqueSortedStrings(context.requiredCapabilities ?? [], 'requiredCapabilities');
  if (!Array.isArray(context.proposedAdditionalRoles ?? [])) throw usageError('proposedAdditionalRoles must be an array.');
  if (!Array.isArray(context.approvedAdditionalRoles ?? [])) throw usageError('approvedAdditionalRoles must be an array.');
  const proposedAdditionalRoles = (context.proposedAdditionalRoles ?? []).map((role) => validateProposedRole(role, 'proposedAdditionalRoles'));
  const approvedAdditionalRoles = (context.approvedAdditionalRoles ?? []).map((role) => validateRole(role, 'approvedAdditionalRoles', { dynamic: true }));
  const proposedIds = new Set(proposedAdditionalRoles.map((role) => role.id));
  if (proposedIds.size !== proposedAdditionalRoles.length) throw usageError('proposedAdditionalRoles must not contain duplicate role ids.');
  const approvedIds = new Set(approvedAdditionalRoles.map((role) => role.id));
  if (approvedIds.size !== approvedAdditionalRoles.length) throw usageError('approvedAdditionalRoles must not contain duplicate role ids.');
  for (const id of proposedIds) if (approvedIds.has(id)) throw usageError(`Role ${id} cannot be both proposed and approved.`);
  return { requiredCapabilities, proposedAdditionalRoles, approvedAdditionalRoles };
}

function activatedRoleIds(initialRoleIds, rolesById) {
  const active = new Set(initialRoleIds);
  const queue = [...active];
  while (queue.length > 0) {
    const role = rolesById.get(queue.shift());
    for (const companionId of role?.requiredCompanionRoleIds ?? []) {
      if (active.has(companionId)) continue;
      active.add(companionId);
      queue.push(companionId);
    }
  }
  return active;
}

function publicRole(role, source, matchedCapabilities = []) {
  return {
    id: role.id,
    title: role.title,
    phase: role.phase,
    membershipStatus: 'approved-available',
    activationMode: 'on-demand',
    source,
    responsibilities: role.responsibilities,
    outOfScope: role.outOfScope,
    capabilities: role.capabilities,
    requiredCompanionRoleIds: role.requiredCompanionRoleIds,
    mustRemainIndependentFrom: role.mustRemainIndependentFrom,
    ...(matchedCapabilities.length > 0 ? { matchedCapabilities } : {}),
    ...(role.approval ? { approval: { status: 'approved', approvedBy: 'product-owner', evidence: 'provided-not-returned' } } : {}),
  };
}

export function dynamicTeamPlan(context = {}, registry = loadAicgProductTeamRegistry()) {
  const normalizedRegistry = validateAicgProductTeamRegistry(registry);
  const normalizedContext = normalizeDynamicTeamContext(context);
  const builtInRoles = normalizedRegistry.roles;
  const approvedRoles = normalizedContext.approvedAdditionalRoles;
  const allRoles = [...builtInRoles, ...approvedRoles];
  const { capabilityOwners } = validateRoleGraph(allRoles, 'availableRoles');
  const rolesById = new Map(allRoles.map((role) => [role.id, role]));
  const requestedRoleIds = [];
  const uncoveredCapabilities = [];
  for (const capability of normalizedContext.requiredCapabilities) {
    const owner = capabilityOwners.get(capability);
    if (owner) requestedRoleIds.push(owner);
    else uncoveredCapabilities.push(capability);
  }
  const activeIds = activatedRoleIds(requestedRoleIds, rolesById);
  const activeRoles = [...activeIds]
    .sort((left, right) => left.localeCompare(right))
    .map((id) => {
      const role = rolesById.get(id);
      const matchedCapabilities = normalizedContext.requiredCapabilities.filter((capability) => capabilityOwners.get(capability) === id);
      return publicRole(role, approvedRoles.some((candidate) => candidate.id === id) ? 'project-approved-extension' : 'built-in-registry', matchedCapabilities);
    });
  const proposals = normalizedContext.proposedAdditionalRoles
    .filter((role) => role.capabilities.some((capability) => uncoveredCapabilities.includes(capability)))
    .map((role) => ({
      id: role.id,
      title: role.title,
      status: 'needs-product-owner-approval',
      responsibilities: role.responsibilities,
      outOfScope: role.outOfScope,
      capabilities: role.capabilities,
      activationTrigger: 'Add this role only after the Product Owner explicitly approves the role definition and approval evidence is recorded.',
    }));
  const proposedCapabilities = new Set(proposals.flatMap((proposal) => proposal.capabilities));
  for (const capability of uncoveredCapabilities) {
    if (!proposedCapabilities.has(capability)) {
      proposals.push({
        id: null,
        title: null,
        status: 'needs-role-proposal',
        capabilities: [capability],
        activationTrigger: 'Define a bounded role and ask the Product Owner for approval before adding or activating it.',
      });
    }
  }
  const requiredSeparations = [];
  for (const role of activeRoles) {
    for (const relatedId of role.mustRemainIndependentFrom) {
      if (!activeIds.has(relatedId)) continue;
      const roles = [role.id, relatedId].sort((left, right) => left.localeCompare(right));
      if (!requiredSeparations.some((entry) => entry.roles[0] === roles[0] && entry.roles[1] === roles[1])) {
        requiredSeparations.push({ roles, reason: 'The implementation or design owner must not be the sole approver for this work.' });
      }
    }
  }
  requiredSeparations.sort((left, right) => left.roles.join(':').localeCompare(right.roles.join(':')));
  const availableRoles = allRoles
    .map((role) => publicRole(role, approvedRoles.some((candidate) => candidate.id === role.id) ? 'project-approved-extension' : 'built-in-registry'))
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    schemaVersion: 1,
    teamId: normalizedRegistry.teamId,
    membershipPolicy: normalizedRegistry.membershipPolicy,
    status: uncoveredCapabilities.length > 0
      ? 'needs-role-approval'
      : normalizedContext.requiredCapabilities.length > 0
        ? 'ready'
        : 'no-requirement-provided',
    availableRoles,
    assignment: {
      strategy: 'minimum-sufficient-set',
      requiredCapabilities: normalizedContext.requiredCapabilities,
      activeRoles,
      inactiveRoleIds: availableRoles.map((role) => role.id).filter((id) => !activeIds.has(id)),
      requiredSeparations,
    },
    uncoveredCapabilities,
    roleProposals: proposals.sort((left, right) => `${left.id ?? ''}:${left.capabilities.join(':')}`.localeCompare(`${right.id ?? ''}:${right.capabilities.join(':')}`)),
    nextAction: uncoveredCapabilities.length > 0
      ? 'Ask the Product Owner to approve a concrete proposed role. Do not add, activate, or persist the role before approval.'
      : 'Use only assignment.activeRoles for this requirement; keep every other available member inactive.',
    actionsPerformed: [],
  };
}

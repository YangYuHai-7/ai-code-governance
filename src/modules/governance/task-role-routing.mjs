import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/index.mjs';
import { minimumTaskLevelFromPaths } from './task-routing.mjs';

const LEVELS = ['L0', 'L1', 'L1.5', 'L2', 'L3'];
const ROLE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const CAPABILITIES = {
  frontend: new Set(['frontend-engineering', 'frontend-development', 'frontend-delivery', 'client-ui-implementation', 'ui-implementation', 'frontend-bug-fixing']),
  backend: new Set(['backend-engineering', 'backend-development', 'backend-api-and-data', 'api-implementation', 'service-implementation']),
  businessAnalysis: new Set(['business-analysis', 'business-domain-analysis', 'requirements-analysis', 'requirements-facilitation', 'contract-business-analysis']),
};
const ROLE_IDS = {
  frontend: /^(?:frontend|web-frontend|client-ui)(?:-|$)/,
  backend: /^(?:backend|api|server)(?:-|$)/,
  businessAnalysis: /^(?:business-analyst|ba|requirements-analyst)(?:-|$)/,
};
const TASK_SIGNALS = {
  frontend: /(?:前端|页面|界面|组件|交互|浏览器|frontend|front-end|web ui|component|responsive|css)/i,
  backend: /(?:后端|服务端|接口|数据库|backend|back-end|server|api|database|service)/i,
  businessAnalysis: /(?:业务分析|业务需求|需求分析|业务规则|业务流程|business analysis|business requirement|requirements analysis|acceptance criteria)/i,
  legalContract: /(?:合同|法律条款|法务|法律审查|legal contract|contract law|contract clause|commercial agreement|legal review)/i,
};
const PATH_SIGNALS = {
  frontend: /(?:^|\/)(?:frontend|web|client|ui|components?|pages?|views?)(?:\/|$)|\.(?:vue|svelte|tsx|jsx|css|scss|less)$/i,
  backend: /(?:^|\/)(?:backend|server|api|services?|controllers?|repositories?)(?:\/|$)/i,
};

function normalizePaths(paths) {
  if (!Array.isArray(paths) || paths.length > 128) throw usageError('changedPaths must be an array of at most 128 paths.');
  return paths.map((value) => {
    if (typeof value !== 'string' || value.length > 512 || !isSafeRelative(value)) throw usageError('changedPaths must contain safe repository-relative paths of at most 512 characters.');
    return normalizeRelative(value);
  });
}

function normalizeRoles(roles) {
  if (!Array.isArray(roles) || roles.length > 64) throw usageError('availableRoles must be an array of at most 64 roles.');
  const ids = new Set();
  return roles.map((role) => {
    if (!role || typeof role !== 'object' || Array.isArray(role) || typeof role.id !== 'string' || !ROLE_ID.test(role.id) || role.id.length > 128) {
      throw usageError('availableRoles contains an invalid role.');
    }
    if (ids.has(role.id)) throw usageError(`availableRoles contains duplicate role ${role.id}.`);
    ids.add(role.id);
    if (!Array.isArray(role.capabilities) || role.capabilities.length > 32 || role.capabilities.some((item) => typeof item !== 'string' || item.length > 128 || !ROLE_ID.test(item))) {
      throw usageError(`availableRoles.${role.id}.capabilities is invalid.`);
    }
    // Project Agent roles need recorded owner approval; validated internal team roles
    // carry their approval in membershipStatus instead.
    const projectApproved = role.status === 'approved-available'
      && role.approval?.source === 'user'
      && typeof role.approval.evidenceId === 'string'
      && role.approval.evidenceId.length > 0;
    const approvedAvailable = projectApproved || role.membershipStatus === 'approved-available';
    return { id: role.id, capabilities: role.capabilities, approvedAvailable };
  });
}

function signalsFor(taskText, paths) {
  const result = [];
  for (const category of ['frontend', 'backend', 'businessAnalysis', 'legalContract']) {
    if (TASK_SIGNALS[category].test(taskText)) result.push({ category, source: 'task-text' });
  }
  for (const category of ['frontend', 'backend']) {
    for (const relative of paths.filter((value) => PATH_SIGNALS[category].test(value))) {
      result.push({ category, source: 'changed-path', value: relative });
    }
  }
  if (result.some((entry) => entry.category === 'legalContract') && !result.some((entry) => entry.category === 'businessAnalysis')) {
    result.push({ category: 'businessAnalysis', source: 'legal-contract-context' });
  }
  return result;
}

function matchingRole(roles, category) {
  const matches = roles.filter((role) => role.approvedAvailable && (
    role.capabilities.some((capability) => CAPABILITIES[category].has(capability)) || ROLE_IDS[category].test(role.id)
  ));
  matches.sort((left, right) => {
    const leftExact = left.capabilities.some((capability) => CAPABILITIES[category].has(capability));
    const rightExact = right.capabilities.some((capability) => CAPABILITIES[category].has(capability));
    return Number(rightExact) - Number(leftExact) || left.id.localeCompare(right.id);
  });
  return matches[0] ?? null;
}

/** Returns bounded advice only. The caller must separately approve and launch any Agent. */
export function recommendTaskRoles({ taskText, changedPaths = [], route, availableRoles = [], taskKind = 'feature', bugfix } = {}) {
  if (typeof taskText !== 'string' || taskText.length > 4000 || !taskText.trim()) throw usageError('taskText must be non-empty text of at most 4000 characters.');
  const paths = normalizePaths(changedPaths);
  if (!route || !LEVELS.includes(route.level)) throw usageError('route.level must be one of ' + LEVELS.join(', ') + '.');
  if (route.reasonCodes !== undefined && (!Array.isArray(route.reasonCodes) || route.reasonCodes.length > 16 || route.reasonCodes.some((code) => typeof code !== 'string' || code.length > 128))) {
    throw usageError('route.reasonCodes must be an array of at most 16 short strings.');
  }
  const roles = normalizeRoles(availableRoles);
  const minimumLevel = paths.length ? minimumTaskLevelFromPaths(paths, {}, { taskKind, bugfix }) : 'L0';
  const effectiveLevel = LEVELS[Math.max(LEVELS.indexOf(route.level), LEVELS.indexOf(minimumLevel))];
  const signals = signalsFor(taskText, paths);
  const requestedCategories = ['frontend', 'backend', 'businessAnalysis'].filter((category) => signals.some((signal) => signal.category === category));
  const recommendedRoles = [];
  const missingRoleCapabilities = [];
  for (const category of requestedCategories) {
    const role = matchingRole(roles, category);
    if (!role) {
      missingRoleCapabilities.push({ category, status: 'approval-or-availability-required' });
      continue;
    }
    const existing = recommendedRoles.find((entry) => entry.roleId === role.id);
    if (existing) existing.categories.push(category);
    else recommendedRoles.push({ roleId: role.id, categories: [category], status: 'recommended-not-activated' });
  }
  const humanReviewRequirements = signals.some((signal) => signal.category === 'legalContract')
    ? [{ domain: 'contract-law', qualification: 'licensed-lawyer', status: 'required-unassigned', decisionAuthority: 'qualified-human-only', jurisdiction: 'must-be-confirmed' }]
    : [];
  return {
    schemaVersion: 1,
    status: missingRoleCapabilities.length ? 'role-gap' : humanReviewRequirements.length ? 'human-review-required' : 'recommendation',
    routeEvidence: { declaredLevel: route.level, minimumPathLevel: minimumLevel, effectiveLevel, reasonCodes: Array.isArray(route.reasonCodes) ? [...route.reasonCodes] : [] },
    signals,
    recommendedRoles,
    missingRoleCapabilities,
    humanReviewRequirements,
    boundary: 'This is routing advice only. No Agent or human was assigned, launched, or verified. Legal conclusions require qualified human review.',
    actionsPerformed: [],
  };
}

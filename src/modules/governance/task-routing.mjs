import { usageError } from '../../kernel/index.mjs';
import { SUPPORTED_CONFIRMED_RISK_SIGNALS } from '../../constants.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/index.mjs';

const ORDER = ['L0', 'L1', 'L2', 'L3'];
const DIMENSIONS = {
  mutation: {
    none: 'L0',
    'governance-only': 'L1',
    'non-production': 'L1',
    'product-behavior': 'L2',
    'external-action': 'L3',
  },
  scope: {
    'single-file': 'L0',
    'single-module': 'L1',
    'multi-module': 'L2',
    'multi-surface': 'L3',
  },
  risk: {
    low: 'L0',
    business: 'L2',
    'high-consequence': 'L3',
  },
  clarity: {
    clear: null,
    'locally-ambiguous': null,
    exploratory: null,
  },
};

const PROFILE = { L0: 'ordinary', L1: 'ordinary', L2: 'behavior_change', L3: 'behavior_change' };
const VERIFICATION_CLASS = { L0: 'read-only', L1: 'targeted', L2: 'behavior', L3: 'integrated' };
const BASE_APPROVALS = {
  L0: [],
  L1: [],
  L2: ['requirements', 'plan'],
  L3: ['requirements', 'design', 'plan'],
};

const PATH_RULES = [
  {
    id: 'migration',
    level: 'L3',
    patterns: ['**/migration/**', '**/migrations/**', '**/*.migration.*'],
    matches: (relative) => /(^|\/)migrations?(\/|$)|\.migration\./.test(relative),
  },
  {
    id: 'security-and-money',
    level: 'L3',
    patterns: ['**/authentication/**', '**/authorization/**', '**/permissions/**', '**/payments/**', '**/tenants/**'],
    matches: (relative) => /(^|\/)(auth(?:entication|orization)?|permissions?|payments?|billing|tenants?|multi-tenancy)(\/|\.|-|_|$)/.test(relative),
  },
  {
    id: 'architecture-and-external-automation',
    level: 'L3',
    patterns: ['docs/ai/architecture-profile.json', 'docs/ai/module-graph.json', '**/deploy/**', '**/release-workflow.*', '**/*.tf'],
    matches: (relative) => /^(docs\/ai\/(architecture-profile|module-graph)\.json|\.github\/workflows\/(deploy|release)[^/]*\.(?:ya?ml)|(?:scripts?\/)?(?:deploy|publish)(?:\/|\.|-|_|$)|infra\/)|\.tf(?:vars)?$/.test(relative),
  },
  {
    id: 'dependency',
    level: 'L2',
    patterns: ['package.json', '**/package.json', '**/*lock*', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', '**/*.gradle'],
    matches: (relative) => /(^|\/)(package\.json|package-lock\.json|npm-shrinkwrap\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|deno\.lock|pyproject\.toml|poetry\.lock|requirements(?:-[^/]+)?\.txt|pipfile(?:\.lock)?|go\.(?:mod|sum)|cargo\.(?:toml|lock)|gemfile(?:\.lock)?|composer\.(?:json|lock)|pom\.xml|gradle\.lockfile|build\.gradle(?:\.kts)?|podfile(?:\.lock)?|package\.(?:swift|resolved))$/.test(relative),
  },
  {
    id: 'public-contract',
    level: 'L2',
    patterns: ['api/**', 'contracts/**', 'schemas/**', '**/schema.*', '**/openapi.*', '**/*.proto'],
    matches: (relative) => /(^|\/)(api|contracts?|schemas?)(\/|$)|(^|\/)(schema|openapi|asyncapi)(?:\.|\/)|\.(?:schema\.[^/]+|proto|graphql|gql)$/.test(relative),
  },
  {
    id: 'production-source',
    level: 'L2',
    patterns: ['src/**', 'app/**', 'lib/**', 'server/**', 'client/**', 'apps/**', 'packages/**', 'backend/**', 'frontend/**', 'cmd/**', 'internal/**', 'pkg/**'],
    matches: (relative) => /^(src|app|lib|server|client|apps|packages|backend|frontend|cmd|internal|pkg|services|modules|crates|ios|android|mobile|desktop)\//.test(relative),
  },
];

const SURFACE_SEGMENTS = [
  ['web', /(^|\/)(web|frontend|client|ui)(\/|$)/],
  ['api', /(^|\/)(api|backend|server)(\/|$)/],
  ['ios', /(^|\/)ios(\/|$)/],
  ['android', /(^|\/)android(\/|$)/],
  ['mobile', /(^|\/)mobile(\/|$)/],
  ['desktop', /(^|\/)(desktop|electron)(\/|$)/],
];

function routeLevel(input, field) {
  const value = input?.[field];
  if (!Object.hasOwn(DIMENSIONS[field], value)) {
    throw usageError(`task route ${field} must be one of: ${Object.keys(DIMENSIONS[field]).join(', ')}.`);
  }
  return DIMENSIONS[field][value];
}

function maxLevel(...levels) {
  return ORDER[Math.max(...levels.map((value) => ORDER.indexOf(value)))];
}

function approvals(level, input) {
  const result = [];
  if (input.clarity === 'locally-ambiguous') result.push('clarification');
  if (input.clarity === 'exploratory') result.push('discovery');
  result.push(...BASE_APPROVALS[level]);
  if (input.mutation === 'external-action') result.push('external-action');
  return result;
}

function overlays(input) {
  const result = [];
  if (input.clarity === 'locally-ambiguous') result.push('clarification');
  if (input.clarity === 'exploratory') result.push('discovery');
  if (input.risk === 'high-consequence') result.push('high-consequence');
  if (input.mutation === 'external-action') result.push('external-action');
  return result;
}

export function classifyTaskRoute(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw usageError('task route input must be an object.');
  const levels = ['mutation', 'scope', 'risk'].map((field) => routeLevel(input, field));
  routeLevel(input, 'clarity');
  const level = maxLevel(...levels);
  return {
    level,
    profile: PROFILE[level],
    requiredApprovals: approvals(level, input),
    verificationClass: VERIFICATION_CLASS[level],
    overlays: overlays(input),
    reasonCodes: ['mutation', 'scope', 'risk', 'clarity'].map((field) => `${field}:${input[field]}`),
  };
}

function normalizedChangedPaths(paths) {
  if (!Array.isArray(paths)) throw usageError('changed paths must be an array of safe repository-relative paths.');
  return paths.map((value) => {
    if (typeof value !== 'string' || !isSafeRelative(value)) throw usageError('changed paths must contain only safe repository-relative paths.');
    return normalizeRelative(value).toLowerCase();
  });
}

function confirmedRiskLevel(config) {
  const signals = config?.confirmedRiskSignals ?? [];
  if (!Array.isArray(signals) || signals.some((value) => !SUPPORTED_CONFIRMED_RISK_SIGNALS.includes(value))) {
    throw usageError(`config.confirmedRiskSignals may contain only: ${SUPPORTED_CONFIRMED_RISK_SIGNALS.join(', ')}.`);
  }
  if (signals.includes('external-side-effect')) return 'L3';
  return signals.length > 0 ? 'L2' : 'L0';
}

function changedSurfaces(paths) {
  const surfaces = new Set();
  for (const relative of paths) {
    const surface = SURFACE_SEGMENTS.find(([, pattern]) => pattern.test(relative));
    if (surface) surfaces.add(surface[0]);
  }
  return surfaces;
}

export function minimumTaskLevelFromPaths(paths, config = {}) {
  const normalized = normalizedChangedPaths(paths);
  const levels = [confirmedRiskLevel(config)];
  for (const relative of normalized) {
    levels.push(PATH_RULES.find((rule) => rule.matches(relative))?.level ?? 'L1');
  }
  if (changedSurfaces(normalized).size > 1) levels.push('L3');
  return maxLevel(...levels);
}

function localized(config, english, chinese) {
  if (config.artifactLanguage === 'zh-CN') return chinese;
  if (config.artifactLanguage === 'bilingual') return `${english} / ${chinese}`;
  return english;
}

export function taskRoutingPolicy(config) {
  const descriptions = {
    L0: localized(config, 'Read-only explanation, review, discovery, or status work. No writes.', '只读解释、评审、发现或状态工作，不执行写入。'),
    L1: localized(config, 'A small, reversible, low-risk change that does not alter product behavior or public contracts.', '小型、可逆、低风险修改，不改变产品行为或公共契约。'),
    L2: localized(config, 'A business or medium-impact behavior change requiring confirmed requirements and an approved plan.', '业务或中等影响的行为变更，需要确认需求并批准计划。'),
    L3: localized(config, 'A cross-surface, architectural, migration, external, or high-consequence change requiring design and plan approval.', '跨端、架构、迁移、外部操作或高后果变更，需要批准设计与计划。'),
  };
  return {
    schemaVersion: 1,
    input: Object.fromEntries(Object.entries(DIMENSIONS).map(([field, values]) => [field, Object.keys(values)])),
    output: ['level', 'profile', 'requiredApprovals', 'verificationClass', 'overlays', 'reasonCodes'],
    levels: ORDER.map((id) => ({
      id,
      profile: PROFILE[id],
      requiredApprovals: [...BASE_APPROVALS[id]],
      verificationClass: VERIFICATION_CLASS[id],
      description: descriptions[id],
    })),
    escalation: {
      levelMerge: 'maximum-of-mutation-scope-risk',
      clarityEffect: 'adds-gates-only',
      externalAction: 'L3-with-separate-approval',
      deliveryRule: 'declared-level-must-not-be-lower-than-path-minimum',
      description: localized(config, 'New evidence may only raise the route; it never grants an external action.', '新证据只能升级任务等级，且永不自动授权外部操作。'),
    },
    pathRules: PATH_RULES.map(({ id, level, patterns }) => ({
      id,
      level,
      patterns,
      description: localized(config, `Changed paths matching ${id} require at least ${level}.`, `匹配 ${id} 的变更路径至少需要 ${level}。`),
    })),
  };
}

export function taskRoutingSummary(config) {
  if (config.governanceDepth === 'minimal') {
    return localized(
      config,
      'Task routing: L0 is read-only and performs no writes. L1 may execute a small low-risk change without plan approval. Escalate product behavior, public contracts, dependencies, migrations, security-sensitive, multi-surface, or external actions to L2/L3 before editing.',
      '任务路由：L0 仅限只读且不写入。L1 可直接执行小型低风险修改，无需批准计划。涉及产品行为、公共契约、依赖、迁移、安全敏感、跨端或外部操作时，编辑前升级至 L2/L3。',
    );
  }
  return localized(
    config,
    'Classify the task with `docs/ai/task-routing-policy.json` before editing and upgrade when new evidence crosses a stronger boundary.',
    '编辑前使用 `docs/ai/task-routing-policy.json` 对任务分级；新证据跨越更强边界时必须升级。',
  );
}

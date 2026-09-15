import { usageError } from '../../kernel/index.mjs';
import { SUPPORTED_CONFIRMED_RISK_SIGNALS } from '../../constants.mjs';
import { isSafeRelative, matchSimpleGlob, normalizeRelative } from '../../shared/index.mjs';

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
    id: 'architecture-and-external-automation',
    level: 'L3',
    patterns: [
      'docs/ai/architecture-profile.json',
      'docs/ai/module-graph.json',
      '.github/workflows/deploy*.yml',
      '.github/workflows/deploy*.yaml',
      '.github/workflows/release*.yml',
      '.github/workflows/release*.yaml',
      'deploy/**',
      '**/deploy/**',
      'publish/**',
      '**/publish/**',
      'infra/**',
      '**/infra/**',
      '*.tf',
      '**/*.tf',
      '*.tfvars',
      '**/*.tfvars',
    ],
    examples: ['services/foo/deploy/run.sh', 'infra/network.tf'],
  },
  {
    id: 'migration-artifact',
    level: 'L3',
    patterns: [
      'migration/*.sql', 'migration/**/*.sql', 'migrations/*.sql', 'migrations/**/*.sql',
      'migration/*.js', 'migration/**/*.js', 'migrations/*.js', 'migrations/**/*.js',
      'migration/*.ts', 'migration/**/*.ts', 'migrations/*.ts', 'migrations/**/*.ts',
      'migration/*.py', 'migration/**/*.py', 'migrations/*.py', 'migrations/**/*.py',
      'migration/*.rb', 'migration/**/*.rb', 'migrations/*.rb', 'migrations/**/*.rb',
      'migration/*.go', 'migration/**/*.go', 'migrations/*.go', 'migrations/**/*.go',
      '*.migration.*', '**/*.migration.*',
    ],
    examples: ['db/migrations/20260915-add-account.sql'],
  },
  {
    id: 'security-fixture',
    level: 'L3',
    patterns: [
      'fixtures/risk-evidence/**', 'fixtures/security/**',
      'fixtures/auth/**', 'fixtures/authentication/**', 'fixtures/authorization/**',
      'fixtures/permission/**', 'fixtures/permissions/**',
      'fixtures/payment/**', 'fixtures/payments/**', 'fixtures/billing/**',
      'fixtures/tenant/**', 'fixtures/tenants/**', 'fixtures/multi-tenancy/**',
    ],
    examples: ['test/fixtures/risk-evidence/authorization-policy.json'],
  },
  {
    id: 'dependency',
    level: 'L2',
    patterns: [
      'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock', 'bun.lockb', 'deno.lock',
      'uv.lock', 'pyproject.toml', 'poetry.lock', 'requirements.txt', 'requirements-*.txt', 'pipfile', 'pipfile.lock',
      'manage.py',
      'go.mod', 'go.sum', 'go.work', 'go.work.sum', 'cargo.toml', 'cargo.lock',
      'gemfile', 'gemfile.lock', 'composer.json', 'composer.lock', 'symfony.lock',
      'artisan',
      'pom.xml', 'gradle.lockfile', 'build.gradle', 'build.gradle.kts', 'settings.gradle', 'settings.gradle.kts',
      'angular.json', 'svelte.config.js', 'svelte.config.ts',
      'global.json', 'directory.packages.props', 'packages.lock.json', '*.sln', '*.slnx', '*.csproj',
      'androidmanifest.xml', '*.xcodeproj/**', '*.xcworkspace/**', 'package.swift', 'package.resolved', 'podfile', 'podfile.lock',
      'capacitor.config.ts', 'capacitor.config.json', 'config.xml', 'pubspec.yaml', 'pubspec.lock',
      'src-tauri/tauri.conf.json', 'cmakelists.txt', 'meson.build', 'makefile', 'platformio.ini', 'conanfile.py', 'vcpkg.json',
    ],
    examples: ['uv.lock', 'packages.lock.json', 'Example.xcodeproj/project.pbxproj'],
  },
  {
    id: 'public-contract-artifact',
    level: 'L2',
    patterns: [
      'openapi.*', '**/openapi.*', 'asyncapi.*', '**/asyncapi.*', 'schema.*', '**/schema.*', '*.schema.*', '**/*.schema.*',
      '*.proto', '**/*.proto', '*.graphql', '**/*.graphql', '*.gql', '**/*.gql', '*.prisma', '**/*.prisma',
      'contract/*.json', 'contract/**/*.json', 'contracts/*.json', 'contracts/**/*.json',
      'contract/*.yaml', 'contract/**/*.yaml', 'contracts/*.yaml', 'contracts/**/*.yaml',
      'contract/*.yml', 'contract/**/*.yml', 'contracts/*.yml', 'contracts/**/*.yml',
      'schema/*.json', 'schema/**/*.json', 'schemas/*.json', 'schemas/**/*.json',
      'schema/*.yaml', 'schema/**/*.yaml', 'schemas/*.yaml', 'schemas/**/*.yaml',
      'schema/*.yml', 'schema/**/*.yml', 'schemas/*.yml', 'schemas/**/*.yml',
    ],
    examples: ['test/fixtures/contracts/openapi.yaml', 'prisma/schema.prisma'],
  },
  {
    id: 'ordinary-documentation-or-test',
    level: 'L1',
    patterns: [
      'docs/*.md', 'docs/**/*.md', 'docs/*.mdx', 'docs/**/*.mdx', 'docs/*.txt', 'docs/**/*.txt',
      'docs/*.rst', 'docs/**/*.rst', 'docs/*.adoc', 'docs/**/*.adoc',
      'readme*', 'changelog*', 'contributing*', 'license*',
      'test/**', 'tests/**', '__tests__/**', '*.test.*', '**/*.test.*', '*.spec.*', '**/*.spec.*', 'test_*.*', '*_test.*',
    ],
    examples: ['docs/payments/guide.md', 'docs/api/guide.md', 'src/__tests__/widget.test.mjs'],
  },
  {
    id: 'security-and-money',
    level: 'L3',
    patterns: [
      'auth/**', 'authentication/**', 'authorization/**', 'permission/**', 'permissions/**',
      'payment/**', 'payments/**', 'billing/**', 'tenant/**', 'tenants/**', 'multi-tenancy/**',
      '*authentication*', '*authorization*', '*permission*', '*payment*', '*billing*', '*tenant*',
    ],
    examples: ['src/authorization/policy.mjs', 'src/payments/settle.mjs'],
  },
  {
    id: 'public-contract',
    level: 'L2',
    patterns: ['api/**', 'contract/**', 'contracts/**', 'schema/**', 'schemas/**'],
    examples: ['api/handlers/account.mjs', 'contracts/public-api.yaml'],
  },
  {
    id: 'production-source',
    level: 'L2',
    patterns: ['src/**', 'app/**', 'lib/**', 'server/**', 'client/**', 'apps/**', 'packages/**', 'backend/**', 'frontend/**', 'cmd/**', 'internal/**', 'pkg/**', 'services/**', 'modules/**', 'crates/**', 'ios/**', 'android/**', 'mobile/**', 'desktop/**'],
    examples: ['src/widget.mjs', 'backend/orders/service.go'],
  },
];

const SURFACE_RULES = [
  { id: 'web', patterns: ['web/**', 'frontend/**', 'client/**', 'ui/**'], examples: ['apps/web/editor.mjs'] },
  { id: 'api', patterns: ['api/**', 'backend/**', 'server/**'], examples: ['apps/api/editor.mjs'] },
  { id: 'ios', patterns: ['ios/**'], examples: ['apps/ios/editor.swift'] },
  { id: 'android', patterns: ['android/**'], examples: ['apps/android/Editor.kt'] },
  { id: 'mobile', patterns: ['mobile/**'], examples: ['apps/mobile/editor.dart'] },
  { id: 'desktop', patterns: ['desktop/**', 'electron/**'], examples: ['apps/desktop/editor.mjs'] },
];

function routeLevel(input, field) {
  const value = input?.[field];
  if (typeof value !== 'string' || !Object.hasOwn(DIMENSIONS[field], value)) {
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

function matchesPatterns(relative, patterns) {
  return patterns.some((pattern) => matchSimpleGlob(relative, pattern));
}

function changedSurfaces(paths) {
  const surfaces = new Set();
  for (const relative of paths) {
    const surface = SURFACE_RULES.find((rule) => matchesPatterns(relative, rule.patterns));
    if (surface) surfaces.add(surface.id);
  }
  return surfaces;
}

export function minimumTaskLevelFromPaths(paths, config = {}) {
  const normalized = normalizedChangedPaths(paths);
  const levels = [confirmedRiskLevel(config)];
  const surfaceCandidates = [];
  for (const relative of normalized) {
    const rule = PATH_RULES.find((candidate) => matchesPatterns(relative, candidate.patterns));
    levels.push(rule?.level ?? 'L1');
    if (rule?.id !== 'ordinary-documentation-or-test') surfaceCandidates.push(relative);
  }
  if (changedSurfaces(surfaceCandidates).size > 1) levels.push('L3');
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
      surfaceGroups: SURFACE_RULES.map(({ id, patterns, examples }) => ({ id, patterns: [...patterns], examples: [...examples] })),
      multiSurfaceExamples: [['apps/web/editor.mjs', 'apps/api/editor.mjs']],
      description: localized(config, 'New evidence may only raise the route; it never grants an external action.', '新证据只能升级任务等级，且永不自动授权外部操作。'),
    },
    pathRules: PATH_RULES.map(({ id, level, patterns, examples }) => ({
      id,
      level,
      patterns: [...patterns],
      examples: [...examples],
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

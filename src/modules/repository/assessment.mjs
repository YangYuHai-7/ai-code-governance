import { sha256, stableJson } from '../../utils.mjs';

const GOVERNANCE_PREFIXES = [
  'AGENTS.md',
  'CLAUDE.md',
  '.cursor/',
  '.claude/',
  '.agents/',
  'docs/ai/',
  '.ai-governance/',
];

const PROJECT_MANIFESTS = new Set([
  'package.json',
  'pom.xml',
  'build.gradle',
  'build.gradle.kts',
  'pyproject.toml',
  'go.mod',
  'composer.json',
  'Cargo.toml',
]);

export const EXISTING_CODE_STRATEGIES = ['keep-existing', 'new-code-standard', 'staged-migration'];
export const INITIALIZATION_LIFECYCLES = ['greenfield', 'existing'];
export const INITIALIZATION_SOURCES = ['config', 'interactive', 'yes-greenfield', 'chat-plan', 'existing-governance'];
const INITIALIZATION_SOURCE_SET = new Set(INITIALIZATION_SOURCES);

const SOURCE_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.py', '.go', '.java', '.kt', '.kts', '.rb', '.php', '.rs', '.cs', '.swift',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp', '.m', '.mm', '.sql', '.sh', '.bash', '.zsh', '.fish', '.tf', '.hcl', '.scala',
  '.dart', '.ex', '.exs', '.r', '.lua', '.pl', '.s', '.asm', '.vue', '.svelte', '.astro',
]);

const IMPLEMENTATION_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts', '.vue', '.svelte', '.astro', '.py', '.go', '.java', '.kt', '.kts', '.rb', '.php',
  '.rs', '.cs', '.swift', '.c', '.cc', '.cpp', '.cxx', '.m', '.mm', '.scala', '.dart', '.ex', '.exs', '.r', '.lua', '.pl', '.s', '.asm',
]);

const NON_IMPLEMENTATION_PREFIXES = [
  'scripts/', 'script/', 'tools/', 'tooling/', '.github/', 'migrations/', 'migration/', 'db/migrate/', 'database/migrations/',
  'drizzle/', 'prisma/migrations/', 'infra/', 'infrastructure/', 'terraform/',
];

const GREENFIELD_SAFE_PATHS = [
  /^(?:README(?:\.[^/]+)?|LICENSE(?:\.[^/]+)?|NOTICE(?:\.[^/]+)?|CHANGELOG(?:\.[^/]+)?|CONTRIBUTING(?:\.[^/]+)?)$/i,
  /^(?:\.gitignore|\.gitattributes|\.editorconfig|\.npmrc|\.node-version|\.tool-versions)$/,
  /^docs\/(?!ai\/).+\.(?:md|mdx|rst|txt)$/i,
];

function isGovernancePath(relative) {
  return GOVERNANCE_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(prefix));
}

function normalizedExtension(relative) {
  return relative.slice(relative.lastIndexOf('.')).toLowerCase();
}

function isBuildConfiguration(relative) {
  return /^(?:vite|next|webpack|rollup|eslint|prettier|tailwind|postcss|jest|vitest|drizzle|prisma)\.config\.[^/]+$/i.test(relative.split('/').at(-1));
}

export function isImplementationSourcePath(relative) {
  const normalized = relative.replaceAll('\\', '/');
  const basename = normalized.split('/').at(-1);
  if (PROJECT_MANIFESTS.has(basename) || isGovernancePath(normalized) || isBuildConfiguration(normalized)) return false;
  if (NON_IMPLEMENTATION_PREFIXES.some((prefix) => normalized.toLowerCase().startsWith(prefix))) return false;
  if (normalized.toLowerCase().split('/').some((segment) => segment === 'migration' || segment === 'migrations')) return false;
  return IMPLEMENTATION_EXTENSIONS.has(normalizedExtension(normalized));
}

export function projectSourcePaths(scan) {
  return scan.files
    .filter((file) => file.type === 'file' && isImplementationSourcePath(file.relative))
    .map((file) => file.relative)
    .sort((left, right) => left.localeCompare(right));
}

export function projectSourceLinks(scan) {
  return scan.files
    .filter((file) => file.type === 'link' && isImplementationSourcePath(file.relative))
    .map((file) => file.relative)
    .sort((left, right) => left.localeCompare(right));
}

function sourceEvidence(files) {
  return files
    .filter((file) => {
      const basename = file.relative.split('/').at(-1);
      const extension = normalizedExtension(file.relative);
      if (PROJECT_MANIFESTS.has(basename)) return false;
      if (isBuildConfiguration(file.relative)) return false;
      return SOURCE_EXTENSIONS.has(extension);
    })
    .map((file) => file.relative)
    .sort((left, right) => left.localeCompare(right))
    .slice(0, 8);
}

function evidencePaths(files, matcher) {
  return files.filter((file) => matcher(file.relative)).map((file) => file.relative).slice(0, 8);
}

function unexplainedProductPaths(files) {
  return files
    .map((file) => file.relative)
    .filter((relative) => !GREENFIELD_SAFE_PATHS.some((pattern) => pattern.test(relative)))
    .slice(0, 8);
}

export function classifyProject(scan) {
  const productFiles = scan.files.filter((file) => file.type === 'file' && !isGovernancePath(file.relative));
  const manifests = productFiles.filter((file) => PROJECT_MANIFESTS.has(file.relative.split('/').at(-1))).map((file) => file.relative).slice(0, 8);
  const sources = sourceEvidence(productFiles);
  const tests = evidencePaths(productFiles, (relative) => /(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/.test(relative));
  const migrations = evidencePaths(productFiles, (relative) => /(^|\/)(?:migrations?|db\/migrate)(\/|$)/.test(relative));
  const substantiveEvidence = [...sources, ...tests, ...migrations];
  const unexplainedPaths = unexplainedProductPaths(productFiles);
  const lifecycle = substantiveEvidence.length > 0 ? 'existing' : manifests.length > 0 || unexplainedPaths.length > 0 ? 'ambiguous' : 'greenfield';
  const topology = scan.projectMode === 'monorepo' ? 'monorepo' : 'single-repo';
  const confidence = lifecycle === 'ambiguous' ? 'low' : 'high';
  const kind = lifecycle === 'existing'
    ? topology === 'monorepo' ? 'existing-monorepo' : 'existing-application'
    : lifecycle === 'ambiguous' ? 'ambiguous-skeleton'
      : 'greenfield-empty';

  const governanceState = scan.existingGovernance.includes('.ai-governance/config.json')
    ? 'managed'
    : scan.existingGovernance.length > 0 ? 'partial' : 'absent';
  const preservesExistingCode = lifecycle !== 'greenfield';
  return {
    schemaVersion: 1,
    codebase: {
      kind,
      projectMode: scan.projectMode,
      lifecycle: {
        value: lifecycle,
        confidence,
        ruleId: lifecycle === 'existing' ? 'lifecycle-substantive-code-v1' : lifecycle === 'ambiguous' ? 'lifecycle-manifest-only-v1' : 'lifecycle-no-substantive-evidence-v1',
      },
      topology: {
        value: topology,
        confidence: topology === 'monorepo' ? 'high' : 'medium',
        ruleId: topology === 'monorepo' ? 'topology-workspace-v1' : 'topology-single-repo-v1',
      },
      evidence: {
        manifests,
        sourceFiles: sources,
        testFiles: tests,
        migrationFiles: migrations,
        unexplainedPaths,
        productFileCount: productFiles.length,
      },
    },
    governance: {
      state: governanceState,
      detectedPaths: [...scan.existingGovernance],
    },
    implementationBoundary: preservesExistingCode
      ? 'preserve-existing-code-until-an-explicit-migration-strategy-is-approved'
      : 'new-code-must-follow-the-approved-project-architecture-profile',
    requiredDecisions: lifecycle === 'ambiguous'
      ? [{
          id: 'project-lifecycle-confirmation',
          question: 'The repository has manifests or unexplained product files but no substantive source, test, or migration evidence. Confirm whether it is a new scaffold or an existing project.',
          options: ['greenfield-bootstrap', 'existing-project-governance'],
        }]
      : preservesExistingCode
      ? [{
          id: 'existing-code-strategy',
          question: 'Choose whether to keep existing code unchanged, apply the standard only to new code, or approve a staged migration.',
          options: ['keep-existing', 'new-code-standard', 'staged-migration'],
        }]
      : [],
  };
}

function initializationBoundary(initialization, assessment) {
  if (initialization?.lifecycle === 'greenfield') {
    return 'new-code-must-follow-the-approved-project-architecture-profile';
  }
  switch (initialization?.existingCodeStrategy) {
    case 'keep-existing':
      return 'preserve-existing-code-and-avoid-architecture-or-behavior-changes-without-a-separately-approved-request';
    case 'new-code-standard':
      return 'preserve-existing-code-and-apply-the-approved-project-architecture-profile-only-to-new-code';
    case 'staged-migration':
      return 'preserve-existing-code-until-a-separately-approved-staged-migration-plan-and-verification-contract-exist';
    default:
      return assessment.implementationBoundary;
  }
}

function pendingInitializationDecisions(assessment, initialization) {
  if (!initialization?.lifecycle) return assessment.requiredDecisions;
  if (initialization.lifecycle === 'existing' && !initialization.existingCodeStrategy) {
    return [{
      id: 'existing-code-strategy',
      question: 'Choose whether to keep existing code unchanged, apply the standard only to new code, or approve a staged migration.',
      options: EXISTING_CODE_STRATEGIES,
    }];
  }
  return [];
}

export function resolveInitializationDecision(scan, config, { source = null, allowGreenfieldDefault = false, allowRecordedGreenfield = false } = {}) {
  const assessment = classifyProject(scan);
  const supplied = config.initialization ?? {};
  const lifecycle = supplied.lifecycle ?? null;
  const existingCodeStrategy = supplied.existingCodeStrategy ?? null;
  const configuredSource = source ?? supplied.source ?? null;

  if (lifecycle !== null && !INITIALIZATION_LIFECYCLES.includes(lifecycle)) {
    throw new Error('initialization.lifecycle must be greenfield or existing.');
  }
  if (existingCodeStrategy !== null && !EXISTING_CODE_STRATEGIES.includes(existingCodeStrategy)) {
    throw new Error(`initialization.existingCodeStrategy must be one of: ${EXISTING_CODE_STRATEGIES.join(', ')}.`);
  }
  if (lifecycle === 'greenfield' && existingCodeStrategy !== null) {
    throw new Error('initialization.existingCodeStrategy must be null when initialization.lifecycle is greenfield.');
  }
  if (assessment.codebase.lifecycle.value === 'existing' && lifecycle === 'greenfield' && !allowRecordedGreenfield) {
    throw new Error('Repository evidence shows existing source, test, or migration files. Confirm initialization.lifecycle as existing and choose initialization.existingCodeStrategy.');
  }

  const resolvedLifecycle = lifecycle ?? (assessment.codebase.lifecycle.value === 'greenfield' && allowGreenfieldDefault ? 'greenfield' : null);
  if (!resolvedLifecycle) {
    if (assessment.codebase.lifecycle.value === 'ambiguous') {
      throw new Error('Repository lifecycle is ambiguous. Set initialization.lifecycle to greenfield or existing before initialization.');
    }
    throw new Error('Repository contains existing implementation evidence. Set initialization.lifecycle to existing and choose initialization.existingCodeStrategy before initialization.');
  }
  if (resolvedLifecycle === 'existing' && !existingCodeStrategy) {
    throw new Error(`Existing-project initialization requires initialization.existingCodeStrategy: ${EXISTING_CODE_STRATEGIES.join(', ')}.`);
  }

  const resolvedSource = configuredSource ?? (allowGreenfieldDefault ? 'yes-greenfield' : null);
  if (!resolvedSource || !INITIALIZATION_SOURCE_SET.has(resolvedSource)) {
    throw new Error('Initialization decision source must be recorded by the CLI.');
  }
  return {
    lifecycle: resolvedLifecycle,
    existingCodeStrategy: resolvedLifecycle === 'existing' ? existingCodeStrategy : null,
    source: resolvedSource,
  };
}

export function buildDecisionLedger(scan, config = null) {
  const assessment = classifyProject(scan);
  const initialClassification = config?.initialClassification ?? {
    codebase: assessment.codebase,
    implementationBoundary: assessment.implementationBoundary,
    requiredDecisions: assessment.requiredDecisions,
  };
  const configured = Boolean(config);
  const baselineAssessment = {
    ...assessment,
    codebase: initialClassification.codebase,
    implementationBoundary: initialClassification.implementationBoundary,
    requiredDecisions: initialClassification.requiredDecisions ?? assessment.requiredDecisions,
  };
  const initialization = config?.initialization ?? null;
  const implementationBoundary = initializationBoundary(initialization, baselineAssessment);
  const pendingDecisions = pendingInitializationDecisions(baselineAssessment, initialization);
  const lifecycleStatus = initialization?.lifecycle
    ? 'confirmed'
    : initialClassification.codebase.lifecycle.value === 'greenfield' ? 'inferred' : 'pending';
  const strategyStatus = initialization?.lifecycle === 'existing' && initialization.existingCodeStrategy
    ? 'confirmed'
    : initialClassification.codebase.lifecycle.value === 'greenfield' || initialization?.lifecycle === 'greenfield' ? 'not-applicable' : 'pending';
  const base = {
    schemaVersion: 1,
    project: {
      name: scan.projectName,
      initialClassification,
    },
    evidence: {
      gitRootDetected: Boolean(scan.gitRoot),
      stacks: scan.stacks.map((stack) => ({ id: stack.id, paths: stack.paths })),
      installedAgents: scan.agents.filter((agent) => agent.installed).map((agent) => agent.id),
    },
    decisions: [
      {
        id: 'agent-selection',
        value: config?.clients ?? null,
        source: configured ? 'governance-config' : 'needs-user-input',
        status: configured ? 'recorded' : 'pending',
      },
      {
        id: 'technology-stack-selection',
        value: config?.stacks ?? scan.stacks.map((stack) => stack.id),
        source: configured ? 'governance-config' : 'repository-evidence',
        status: configured ? 'recorded' : 'inferred',
      },
      {
        id: 'governance-depth',
        value: config?.governanceDepth ?? null,
        source: configured ? 'governance-config' : 'needs-user-input',
        status: configured ? 'recorded' : 'pending',
      },
      {
        id: 'project-lifecycle',
        value: initialization?.lifecycle ?? null,
        source: initialization?.source ?? 'repository-evidence',
        status: lifecycleStatus,
      },
      {
        id: 'existing-code-strategy',
        value: initialization?.existingCodeStrategy ?? null,
        source: initialization?.source ?? 'needs-user-input',
        status: strategyStatus,
      },
      {
        id: 'implementation-boundary',
        value: implementationBoundary,
        source: initialization?.source ?? 'project-classification-safety-default',
        status: pendingDecisions.length === 0 ? 'applied' : 'requires-user-confirmation',
      },
      {
        id: 'architecture-profile',
        value: config?.architecture
          ? {
              profileId: config.architecture.profileId,
              profileVersion: config.architecture.profileVersion,
              mode: config.architecture.mode,
              status: config.architecture.status,
              topologyBinding: config.architecture.topologyBinding ?? null,
              appliesTo: config.architecture.scope?.appliesTo ?? null,
            }
          : null,
        source: config?.architecture?.source ?? 'needs-initialization-decision',
        status: config?.architecture ? 'recorded' : 'legacy-unconfigured',
      },
    ],
    pendingDecisions,
  };
  return {
    ...base,
    generationBinding: {
      decisionDigest: sha256(stableJson(base)),
    },
  };
}

export function assessmentSummary(scan) {
  const assessment = classifyProject(scan);
  return {
    target: scan.root,
    classification: assessment,
    decisionLedger: buildDecisionLedger(scan),
  };
}

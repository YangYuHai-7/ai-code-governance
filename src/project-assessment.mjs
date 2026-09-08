import { sha256, stableJson } from './utils.mjs';

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

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.py', '.go', '.java', '.kt', '.kts', '.rb', '.php', '.rs', '.cs', '.swift']);

function isGovernancePath(relative) {
  return GOVERNANCE_PREFIXES.some((prefix) => relative === prefix || relative.startsWith(prefix));
}

function sourceEvidence(files) {
  return files
    .filter((file) => {
      const basename = file.relative.split('/').at(-1);
      const extension = file.relative.slice(file.relative.lastIndexOf('.'));
      if (PROJECT_MANIFESTS.has(basename)) return false;
      if (/^(?:vite|next|webpack|rollup|eslint|prettier|tailwind|postcss|jest|vitest)\.config\.[^/]+$/.test(basename)) return false;
      return SOURCE_EXTENSIONS.has(extension);
    })
    .map((file) => file.relative)
    .slice(0, 8);
}

function evidencePaths(files, matcher) {
  return files.filter((file) => matcher(file.relative)).map((file) => file.relative).slice(0, 8);
}

export function classifyProject(scan) {
  const productFiles = scan.files.filter((file) => file.type === 'file' && !isGovernancePath(file.relative));
  const manifests = productFiles.filter((file) => PROJECT_MANIFESTS.has(file.relative.split('/').at(-1))).map((file) => file.relative).slice(0, 8);
  const sources = sourceEvidence(productFiles);
  const tests = evidencePaths(productFiles, (relative) => /(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/.test(relative));
  const migrations = evidencePaths(productFiles, (relative) => /(^|\/)(?:migrations?|db\/migrate)(\/|$)/.test(relative));
  const substantiveEvidence = [...sources, ...tests, ...migrations];
  const lifecycle = substantiveEvidence.length > 0 ? 'existing' : manifests.length > 0 ? 'ambiguous' : 'greenfield';
  const topology = scan.projectMode === 'monorepo' ? 'monorepo' : 'single-repo';
  const confidence = lifecycle === 'ambiguous' ? 'low' : substantiveEvidence.length > 0 ? 'high' : 'high';
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
        productFileCount: productFiles.length,
      },
    },
    governance: {
      state: governanceState,
      detectedPaths: [...scan.existingGovernance],
    },
    implementationBoundary: preservesExistingCode
      ? 'preserve-existing-code-until-an-explicit-migration-strategy-is-approved'
      : 'new-code-must-follow-the-module-first-architecture-standard',
    requiredDecisions: lifecycle === 'ambiguous'
      ? [{
          id: 'project-lifecycle-confirmation',
          question: 'The repository has manifests but no substantive source, test, or migration evidence. Confirm whether it is a new scaffold or an existing project.',
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

export function buildDecisionLedger(scan, config = null) {
  const assessment = classifyProject(scan);
  const initialClassification = config?.initialClassification ?? {
    codebase: assessment.codebase,
    implementationBoundary: assessment.implementationBoundary,
    requiredDecisions: assessment.requiredDecisions,
  };
  const configured = Boolean(config);
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
        id: 'implementation-boundary',
        value: initialClassification.implementationBoundary,
        source: 'project-classification-safety-default',
        status: initialClassification.codebase.lifecycle.value === 'greenfield' ? 'applied' : 'requires-user-confirmation',
      },
    ],
    pendingDecisions: initialClassification.requiredDecisions ?? assessment.requiredDecisions,
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

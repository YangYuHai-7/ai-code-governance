import path from 'node:path';
import { CLIENT_SUPPORT_MODES, CLIENT_SUPPORT_SOURCES, CONFIG_PATH, CONFIG_SCHEMA_VERSION, GENERATED_MARKER, INVOCATION_MODES, PACKAGE_ROOT, SUPPORTED_CODE_DOCUMENTATION_POLICIES, SUPPORTED_CONFIRMED_RISK_SIGNALS, SUPPORTED_DEPTHS, SUPPORTED_INTERACTION_LANGUAGES, SUPPORTED_LANGUAGES, SUPPORTED_OSES, TOOL_NAME, TOOL_VERSION } from '../../constants.mjs';
import { resolveAgents, resolvePacks } from '../../catalogs/index.mjs';
import { architectureProfileDocument, architectureRule, moduleGraphDeclaration, validateArchitectureDecision } from '../architecture/index.mjs';
import { buildCapabilityArtifacts, validateCapabilityEvolution, validateProjectCapabilities } from '../capabilities/index.mjs';
import { buildDecisionLedger, classifyProject, EXISTING_CODE_STRATEGIES, INITIALIZATION_LIFECYCLES, INITIALIZATION_SOURCES, surfaceVerificationProfiles } from '../repository/index.mjs';
import { buildTechnicalStandardArtifacts } from '../standards/index.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { normalizeRelative, stableJson, unique } from '../../shared/index.mjs';
import { BUSINESS_CONSTRAINT_SKILL_PATH, BUSINESS_CONSTRAINTS_PATH, businessConstraintRegistryContent, businessConstraintSkill } from './business-constraints.mjs';

function yamlList(values, indent = 0) {
  const prefix = ' '.repeat(indent);
  return values.length > 0 ? values.map((value) => `${prefix}- ${JSON.stringify(value)}`).join('\n') : `${prefix}[]`;
}

function languageTitle(config, zh, en) {
  if (config.artifactLanguage === 'en') return en;
  if (config.artifactLanguage === 'bilingual') return `${zh} / ${en}`;
  return zh;
}

function defaultCodeDocumentationPolicy(config, fallbackLifecycle = null) {
  const lifecycle = config.initialization?.lifecycle
    ?? config.initialClassification?.codebase?.lifecycle?.value
    ?? fallbackLifecycle;
  if (lifecycle === 'existing') return 'inherit-existing';
  if (!lifecycle && ['brownfield', 'monorepo', 'repository-family'].includes(config.projectMode)) return 'inherit-existing';
  return 'en';
}

export function governanceCommand(config, args = '') {
  const suffix = args ? ` ${args}` : '';
  if (config.invocationMode === 'project-local') return `npm exec -- aicg${suffix}`;
  if (config.invocationMode === 'global') return `aicg${suffix}`;
  return `npm exec --yes --package=ai-code-governance@${config.toolVersion ?? TOOL_VERSION} -- aicg${suffix}`;
}

export function defaultConfig(scan) {
  const assessment = classifyProject(scan);
  const requiredDecisions = [...assessment.requiredDecisions];
  if (assessment.codebase.lifecycle.value === 'greenfield') {
    requiredDecisions.push({
      id: 'architecture-not-established',
      status: 'not-established',
      question: 'Architecture is not established until implementation evidence exists and the owner confirms a stable pattern.',
      options: [],
    });
  }
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    invocationMode: 'npm-exec-pinned',
    interactionLanguage: 'en',
    projectName: scan.projectName,
    projectMode: scan.projectMode,
    initialClassification: {
      codebase: assessment.codebase,
      implementationBoundary: assessment.implementationBoundary,
      requiredDecisions,
    },
    canonicalRoot: 'docs/ai',
    clients: ['codex', 'claude-code', 'cursor'],
    stacks: scan.stacks.map((stack) => stack.id),
    governanceDepth: 'standard',
    artifactLanguage: 'en',
    codeDocumentationPolicy: assessment.codebase.lifecycle.value === 'existing' ? 'inherit-existing' : 'en',
    supportedOs: ['macos', 'windows', 'linux'],
    technologyPackages: [],
    projectCapabilities: [],
    features: {
      knowledge: false,
      taskRuntime: false,
      hooks: false,
      externalWorkflows: false,
      ciIntegration: false,
      aiAssist: false,
    },
    domainConstraints: [],
    confirmedRiskSignals: [],
  };
}

function normalizeConfigDefaults(config, scan) {
  const assessment = classifyProject(scan);
  const initialClassification = config.initialClassification ?? {
    codebase: assessment.codebase,
    implementationBoundary: assessment.implementationBoundary,
    requiredDecisions: assessment.requiredDecisions,
  };
  const requiredDecisions = [...initialClassification.requiredDecisions];
  if (
    initialClassification.codebase.lifecycle.value === 'greenfield'
    && !requiredDecisions.some((decision) => decision.id === 'architecture-not-established')
  ) {
    requiredDecisions.push({
      id: 'architecture-not-established',
      status: 'not-established',
      question: 'Architecture is not established until implementation evidence exists and the owner confirms a stable pattern.',
      options: [],
    });
  }
  return {
    ...config,
    codeDocumentationPolicy: config.codeDocumentationPolicy
      ?? defaultCodeDocumentationPolicy(config, assessment.codebase.lifecycle.value),
    initialClassification: {
      ...initialClassification,
      requiredDecisions,
    },
  };
}

export function validateConfig(config) {
  if (config.codeDocumentationPolicy === undefined) {
    config = { ...config, codeDocumentationPolicy: defaultCodeDocumentationPolicy(config) };
  }
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) throw usageError(`config.schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`);
  if (!config.projectName || typeof config.projectName !== 'string') throw usageError('config.projectName is required.');
  if (!['greenfield', 'brownfield', 'monorepo', 'repository-family'].includes(config.projectMode)) {
    throw usageError(`Unsupported project mode: ${config.projectMode}`);
  }
  if (config.canonicalRoot !== 'docs/ai') throw usageError('The first CLI release requires canonicalRoot to be docs/ai.');
  resolveAgents(config.clients ?? []);
  if (config.clientSupport !== undefined) {
    if (!config.clientSupport || typeof config.clientSupport !== 'object') throw usageError('config.clientSupport must be an object.');
    if (!CLIENT_SUPPORT_MODES.includes(config.clientSupport.mode)) throw usageError(`config.clientSupport.mode must be one of: ${CLIENT_SUPPORT_MODES.join(', ')}.`);
    if (!CLIENT_SUPPORT_SOURCES.includes(config.clientSupport.source)) throw usageError(`config.clientSupport.source must be one of: ${CLIENT_SUPPORT_SOURCES.join(', ')}.`);
    if (!Array.isArray(config.clientSupport.selectedClients) || config.clientSupport.selectedClients.length === 0) throw usageError('config.clientSupport.selectedClients must contain at least one client.');
    resolveAgents(config.clientSupport.selectedClients);
    if (stableJson(config.clientSupport.selectedClients) !== stableJson(config.clients ?? [])) throw usageError('config.clients must match config.clientSupport.selectedClients.');
    const builtIn = ['codex', 'claude-code', 'cursor'];
    if (config.clientSupport.mode === 'all-built-in' && stableJson(config.clientSupport.selectedClients) !== stableJson(builtIn)) {
      throw usageError('config.clientSupport.mode all-built-in must select codex, claude-code, and cursor in registry order.');
    }
  }
  resolvePacks(config.stacks ?? []);
  if (!SUPPORTED_DEPTHS.includes(config.governanceDepth)) throw usageError(`Unsupported governance depth: ${config.governanceDepth}`);
  if (!SUPPORTED_LANGUAGES.includes(config.artifactLanguage)) throw usageError(`Unsupported artifact language: ${config.artifactLanguage}`);
  if (config.interactionLanguage !== undefined && !SUPPORTED_INTERACTION_LANGUAGES.includes(config.interactionLanguage)) throw usageError(`Unsupported interaction language: ${config.interactionLanguage}`);
  if (!SUPPORTED_CODE_DOCUMENTATION_POLICIES.includes(config.codeDocumentationPolicy)) throw usageError(`Unsupported code documentation policy: ${config.codeDocumentationPolicy}`);
  if (config.invocationMode !== undefined && !INVOCATION_MODES.includes(config.invocationMode)) throw usageError(`Unsupported invocation mode: ${config.invocationMode}`);
  if (!Array.isArray(config.supportedOs) || config.supportedOs.some((value) => !SUPPORTED_OSES.includes(value))) {
    throw usageError('config.supportedOs contains an unsupported operating system.');
  }
  if (config.technologyPackages !== undefined && (!Array.isArray(config.technologyPackages) || config.technologyPackages.some((value) => typeof value !== 'string' || !value))) {
    throw usageError('technologyPackages must be an array of non-empty package names when provided.');
  }
  validateProjectCapabilities(config.projectCapabilities);
  validateCapabilityEvolution(config.capabilityEvolution, config.projectCapabilities ?? []);
  validateArchitectureDecision(config.architecture, config.initialization ?? null);
  if (!config.features || typeof config.features !== 'object') throw usageError('config.features is required.');
  if (!Array.isArray(config.domainConstraints)) throw usageError('config.domainConstraints must be an array.');
  if (config.domainConstraints.some((value) => typeof value !== 'string' || !value.trim() || value.length > 1000 || /[\u0000-\u001f\u007f]/.test(value))) {
    throw usageError('config.domainConstraints must contain non-empty single-line strings of at most 1000 characters.');
  }
  const normalizedConstraints = config.domainConstraints.map((value) => value.trim());
  if (new Set(normalizedConstraints).size !== normalizedConstraints.length) throw usageError('config.domainConstraints must not contain duplicate normalized constraints.');
  if (config.confirmedRiskSignals !== undefined && (!Array.isArray(config.confirmedRiskSignals) || config.confirmedRiskSignals.some((value) => !SUPPORTED_CONFIRMED_RISK_SIGNALS.includes(value)))) {
    throw usageError(`config.confirmedRiskSignals contains an unsupported value; expected only: ${SUPPORTED_CONFIRMED_RISK_SIGNALS.join(', ')}.`);
  }
  if (Array.isArray(config.confirmedRiskSignals) && new Set(config.confirmedRiskSignals).size !== config.confirmedRiskSignals.length) throw usageError('config.confirmedRiskSignals must not contain duplicates.');
  if ((config.confirmedRiskSignals?.length ?? 0) > 0 && config.domainConstraints.length === 0) throw usageError('config.confirmedRiskSignals requires at least one owner-confirmed domain constraint.');
  if (config.initialClassification !== undefined) {
    if (!config.initialClassification?.codebase?.lifecycle?.value || typeof config.initialClassification.implementationBoundary !== 'string' || !Array.isArray(config.initialClassification.requiredDecisions)) {
      throw usageError('initialClassification must preserve a scanner classification snapshot.');
    }
  }
  if (config.initialization !== undefined) {
    const initialization = config.initialization;
    if (!initialization || typeof initialization !== 'object') throw usageError('initialization must be an object when provided.');
    if (initialization.lifecycle !== null && initialization.lifecycle !== undefined && !INITIALIZATION_LIFECYCLES.includes(initialization.lifecycle)) {
      throw usageError('initialization.lifecycle must be greenfield or existing.');
    }
    if (initialization.existingCodeStrategy !== null && initialization.existingCodeStrategy !== undefined && !EXISTING_CODE_STRATEGIES.includes(initialization.existingCodeStrategy)) {
      throw usageError(`initialization.existingCodeStrategy must be one of: ${EXISTING_CODE_STRATEGIES.join(', ')}.`);
    }
    if (initialization.lifecycle === 'greenfield' && initialization.existingCodeStrategy !== null && initialization.existingCodeStrategy !== undefined) {
      throw usageError('initialization.existingCodeStrategy must be null when initialization.lifecycle is greenfield.');
    }
    if (initialization.source !== null && initialization.source !== undefined && !INITIALIZATION_SOURCES.includes(initialization.source)) {
      throw usageError(`initialization.source must be one of: ${INITIALIZATION_SOURCES.join(', ')}.`);
    }
    if (initialization.lifecycle && !initialization.source) {
      throw usageError('initialization.source is required when initialization.lifecycle is set.');
    }
    if (initialization.lifecycle === 'existing' && !initialization.existingCodeStrategy) {
      throw usageError('initialization.existingCodeStrategy is required when initialization.lifecycle is existing.');
    }
    if (!initialization.lifecycle && initialization.existingCodeStrategy) {
      throw usageError('initialization.existingCodeStrategy requires initialization.lifecycle to be existing.');
    }
    if (!initialization.lifecycle && initialization.source) {
      throw usageError('initialization.source requires initialization.lifecycle.');
    }
  }
  return config;
}

function rootInstructions(config) {
  const completeCommand = governanceCommand(config, 'complete .');
  const syncCommand = governanceCommand(config, 'sync .');
  return `## ${languageTitle(config, 'AI 编码治理', 'AI coding governance')}

This block is managed by \`aicg\`. Project-specific content outside this block is preserved.

- Canonical governance: \`${config.canonicalRoot}/\`
- Start with the \`ordinary\` profile in \`${config.canonicalRoot}/context-map.yaml\`; use a larger profile only when the task requires it.
- Preserve unrelated user changes and remain within the requested scope.
- Client adapters are generated. Change the canonical source and run \`${syncCommand}\`; do not edit adapters directly.
- Before delivery, run \`${completeCommand}\` once with any required repository verification command selected by its runtime guidance.
`;
}

function alwaysRule(config) {
  const completeCommand = governanceCommand(config, 'complete .');
  return `---
alwaysApply: true
---

# ${languageTitle(config, '常驻治理规则', 'Always-on governance')}

1. Preserve unrelated user changes and keep work inside the requested scope.
2. Treat code and tests as current behavior evidence; keep affected governance claims accurate.
3. Report evidence honestly, including commands, clients, platforms, and integrations that were not actually run.
4. Use only repository commands that exist; do not invent commands or append unapproved arguments.
5. Before delivery, run \`${completeCommand}\` once with any required discovered verification command.
`;
}

function stackRule(config, packs) {
  const rows = packs.map((pack) => `| \`${pack.id}\` | ${pack.evidence} | ${(pack.validation_sources ?? []).join('; ')} |`).join('\n');
  return `---
alwaysApply: false
profiles: [implementation]
---

# ${languageTitle(config, '技术栈证据边界', 'Technology evidence boundaries')}

| Pack | Evidence | Validation sources |
| --- | --- | --- |
${rows}

- Confirm installed versions from repository manifests or lockfiles before applying version-specific guidance.
- Research current official documentation before generating or changing framework-specific coding standards.
- A selected \`unverified\` pack provides routing only; it is not certification evidence.
- Use neighboring project implementations and tests to specialize generic stack guidance.
`;
}

function contextMap(config, technicalStandardArtifacts) {
  const hasBusinessSkill = config.domainConstraints.length > 0 && config.governanceDepth !== 'minimal';
  const checkCommand = governanceCommand(config, 'check .');
  const releaseCommand = governanceCommand(config, 'release-check . --type <bugfix|feature|major> --evidence <repository-relative-json> [--replay --approve <planHash>]');
  const conditional = [
    '      architecture:',
    '        - docs/ai/architecture-profile.json',
    '        - docs/ai/rules/15_architecture.mdc',
  ];
  if (config.governanceDepth !== 'minimal') {
    const standardSkills = technicalStandardArtifacts
      .map((artifact) => artifact.path)
      .filter((relative) => relative.startsWith('docs/ai/skills/standards/'));
    conditional.push(
      '      stack:',
      '        - docs/ai/stack-profile.json',
      '        - docs/ai/rules/20_stack.mdc',
      '        - docs/ai/technical-standards.json',
      ...standardSkills.map((relative) => `        - ${relative}`),
    );
  }
  if (config.domainConstraints.length > 0) {
    conditional.push(
      '      business:',
      `        - ${BUSINESS_CONSTRAINTS_PATH}`,
      ...(hasBusinessSkill ? [`        - ${BUSINESS_CONSTRAINT_SKILL_PATH}`] : []),
    );
  }
  return `version: 1
base:
  required:
    - docs/ai/rules/00_always.mdc
profiles:
  ordinary:
    extends: base
    required: []
  behavior_change:
    extends: ordinary
    conditional:
${conditional.join('\n')}
    verify:
      - ${checkCommand}
  release:
    extends: ordinary
    description: Validate risk-tiered evidence before deployment or publication.
    required:
      - docs/ai/release-acceptance-policy.json
    commandTemplate: ${releaseCommand}
`;
}

function verificationProfiles(config) {
  const assessCommand = governanceCommand(config, `assess . --locale ${config.interactionLanguage ?? 'en'} --json`);
  const runtimeInstruction = `# runtime discovery required: inspect actionGuide.allowedVerificationCommands from ${assessCommand}`;
  return `version: 1
profiles:
  governance:
    paths:
      - AGENTS.md
      - docs/ai/**
      - .ai-governance/**
    commands:
      - ${governanceCommand(config, 'check .')}
  project:
    paths:
      - "**"
    commands:
${yamlList([runtimeInstruction], 6)}
`;
}

function governanceReadme(config, scan, packs) {
  const checkCommand = governanceCommand(config, 'check .');
  const releaseCommand = governanceCommand(config, 'release-check . --type <type> --evidence <repository-relative-json>');
  const syncCommand = governanceCommand(config, 'sync .');
  return `# ${config.projectName} — ${languageTitle(config, 'AI 治理正典', 'AI governance canon')}

This directory is the human-maintained governance source. Client-specific regular files are generated adapters and are checked by \`${checkCommand}\`.

The generated [architecture profile](architecture-profile.json) is the sole current policy for future source placement. It records whether the policy is active, advisory, or legacy-unconfigured; it never authorizes business-code migration.

Before deployment or publication, use the generated [release acceptance policy](release-acceptance-policy.json) and Git-tracked evidence with \`${releaseCommand}\`, inspect the exact replay plan, then execute it with \`--replay --approve <planHash>\`. The tool never invents independent reviewer approval.

## Configuration

- Repository topology at initialization: \`${classifyProject(scan).codebase.topology.value}\`
- Depth: \`${config.governanceDepth}\`
- Interaction language: \`${config.interactionLanguage ?? 'en'}\`; artifact language: \`${config.artifactLanguage}\`
- CLI invocation: \`${config.invocationMode ?? 'npm-exec-pinned'}\`, pinned tool version \`${config.toolVersion ?? TOOL_VERSION}\`
- Client-support decision: \`${config.clientSupport?.mode ?? 'legacy-unrecorded'}\` from \`${config.clientSupport?.source ?? 'legacy configuration'}\`
- Clients: ${config.clients.map((item) => `\`${item}\``).join(', ')}
- Stacks: ${packs.map((pack) => `\`${pack.id}\` (${pack.evidence})`).join(', ')}
- Supported OS targets: ${config.supportedOs.map((item) => `\`${item}\``).join(', ')}
- Current generator evidence: \`${scan.currentOs}\` only until CI or real-client probes complete.

## Initialization boundary

The single current initialization decision is stored in \`.ai-governance/config.json\` and derived into \`docs/ai/decision-ledger.json\`. Read both before changing architecture or existing behavior. This seed document never grants migration authorization.

## Ownership

| Path | Owner |
| --- | --- |
| \`docs/ai/\` | Human-maintained governance canon |
| \`docs/ai/release-acceptance-policy.json\` | Managed baseline updated by \`${syncCommand}\`; tighten only through a separate override |
| \`.ai-governance/config.json\` | Confirmed initialization decisions |
| \`.ai-governance/manifest.json\` | Generated ownership and content hashes |
| Client-specific adapters | \`${syncCommand}\`; do not edit directly |

## Gaps

${config.domainConstraints.length > 0 ? config.domainConstraints.map((item) => `- Confirmed constraint: ${item}`).join('\n') : '- No project-specific business invariant was confirmed during deterministic initialization.'}
- Stack-specific rules must be refreshed against current official documentation before being promoted to enforced policy.
- Hooks, CI integration, and external workflow providers remain disabled unless the configuration explicitly enables them.
`;
}

function antiPatterns(config) {
  const syncCommand = governanceCommand(config, 'sync .');
  const checkCommand = governanceCommand(config, 'check .');
  return `# ${languageTitle(config, '项目反模式', 'Project anti-patterns')}

Only add an item after repository evidence, a review finding, an incident, or an explicit owner decision exists.

## Generated adapter edits

**Wrong:** Edit a client-specific generated rule or Skill directly.

**Right:** Edit the canonical source and run \`${syncCommand}\`.

**Why:** Direct edits create client drift and will fail \`${checkCommand}\`.
`;
}

function stackSkill(config, pack) {
  const description = `Apply ${pack.id} repository conventions after verifying installed versions and loading project evidence.`;
  return `---
name: ${pack.id}
description: ${description}
---

# ${pack.id}

<!-- ${GENERATED_MARKER} -->

1. Read \`AGENTS.md\`, \`${config.canonicalRoot}/context-map.yaml\`, and neighboring implementation tests.
2. Verify the installed stack version from manifests or lockfiles.
3. Consult current official sources for version-sensitive decisions; do not rely on this generated routing shell as a frozen best-practice manual.
4. Use these project validation sources: ${(pack.validation_sources ?? []).join('; ') || 'repository-defined commands only'}.
5. Report any missing command, unsupported combination, or business invariant as \`unverified\` instead of inventing it.
`;
}

function bootstrapPrompt(config) {
  const syncCommand = governanceCommand(config, 'sync .');
  const checkCommand = governanceCommand(config, 'check .');
  return `# AI-assisted governance completion

The deterministic \`${governanceCommand(config, 'init')}\` phase is complete for ${config.projectName}.

Inspect the repository and refine the human-maintained files under \`${config.canonicalRoot}/\`. Preserve generated adapters and existing user content. Before proposing any code change, read \`.ai-governance/config.json\` and \`docs/ai/decision-ledger.json\`; initialization decisions are authoritative there, and this seed prompt never authorizes migration or business-code changes. Derive business rules only from requirements, code, tests, ADRs, incidents, or explicit user decisions. Research current official documentation for the selected stack versions. Run \`${syncCommand}\` after canonical Skill or rule changes, then run \`${checkCommand}\` and real project verification commands. Do not enable hooks, CI, external providers, publishing, or destructive migration without explicit authorization.
`;
}

function cursorRule(config) {
  return `---
description: Route Cursor to the repository AI governance canon.
alwaysApply: true
---

<!-- ${GENERATED_MARKER} -->

Read \`AGENTS.md\`, then follow \`${config.canonicalRoot}/context-map.yaml\` and \`${config.canonicalRoot}/rules/00_always.mdc\`. Client-specific adapters are generated; change canonical governance and run \`${governanceCommand(config, 'sync .')}\`.
`;
}

function fullDepthArtifacts(config) {
  const artifacts = [
    {
      path: 'docs/ai/lifecycle.md',
      content: `# Governance lifecycle\n\nPromote repeated, evidence-backed guidance into rules or Skills. Review stale sources, retire superseded guidance, and keep one owner for every fact.\n`,
      ownership: 'seed', kind: 'canonical', source: 'template:lifecycle',
    },
  ];
  if (config.features.knowledge) artifacts.push({
      path: 'docs/memory/INDEX.md',
      content: `# Project memory index\n\nRecord current module behavior and machine-checkable assertions here. Do not use this directory as a changelog.\n`,
      ownership: 'seed', kind: 'canonical', source: 'template:memory-index',
    });
  if (config.features.taskRuntime) artifacts.push({
      path: 'docs/ai/long-running/README.md',
      content: `# Long-running task state\n\nCreate one task directory per approved long-running effort. Runtime state references canonical plans and external changes instead of copying them.\n`,
      ownership: 'seed', kind: 'canonical', source: 'template:task-runtime',
    });
  return artifacts;
}

export function buildArtifacts(config, scan) {
  config = normalizeConfigDefaults(config, scan);
  validateConfig(config);
  const agents = resolveAgents(config.clients);
  const packs = resolvePacks(config.stacks);
  const technicalStandardArtifacts = config.governanceDepth === 'minimal'
    ? []
    : buildTechnicalStandardArtifacts(config, scan).artifacts;
  const artifacts = [
    {
      path: '.gitignore',
      content: '!/reviews/\n/reviews/*\n!/reviews/.gitkeep\n!/reports/\n/reports/*\n!/reports/.gitkeep',
      ownership: 'gitignore-block',
      kind: 'local-output-ignore',
      source: 'template:local-output-layout',
    },
    {
      path: 'reviews/.gitkeep',
      content: `# ${GENERATED_MARKER}\n`,
      ownership: 'seed',
      kind: 'local-output-directory',
      source: 'template:local-output-layout',
    },
    {
      path: 'reports/.gitkeep',
      content: `# ${GENERATED_MARKER}\n`,
      ownership: 'seed',
      kind: 'local-output-directory',
      source: 'template:local-output-layout',
    },
    { path: CONFIG_PATH, content: stableJson(config), ownership: 'full', kind: 'configuration', source: 'confirmed-decisions' },
    { path: 'AGENTS.md', content: rootInstructions(config), ownership: 'managed-block', kind: 'entrypoint', source: 'template:agents' },
    { path: 'docs/ai/README.md', content: governanceReadme(config, scan, packs), ownership: 'seed', kind: 'canonical', source: 'template:canon-readme' },
    { path: 'docs/ai/context-map.yaml', content: contextMap(config, technicalStandardArtifacts), ownership: 'seed', kind: 'canonical', source: 'template:context-map' },
    { path: 'docs/ai/rules/00_always.mdc', content: alwaysRule(config), ownership: 'seed', kind: 'canonical', source: 'template:always-rule' },
    { path: 'docs/ai/verification-profiles.yaml', content: verificationProfiles(config), ownership: 'seed', kind: 'canonical', source: 'template:runtime-verification' },
    { path: 'docs/ai/surface-verification-profiles.json', content: stableJson(surfaceVerificationProfiles()), ownership: 'full', kind: 'surface-verification-profiles', source: 'asset:surface-verification-contract' },
    { path: 'docs/ai/anti-patterns.md', content: antiPatterns(config), ownership: 'seed', kind: 'canonical', source: 'template:anti-patterns' },
    { path: 'docs/ai/stack-profile.json', content: stableJson({ schemaVersion: 1, packs: packs.map((pack) => ({ id: pack.id, lifecycle: pack.lifecycle, evidence: pack.evidence, validationSources: pack.validation_sources })) }), ownership: 'full', kind: 'canonical', source: 'capability-pack-registry' },
    { path: 'docs/ai/architecture-profile.json', content: stableJson(architectureProfileDocument(config)), ownership: 'full', kind: 'architecture-profile', source: 'architecture-profile-registry-and-initialization-decision' },
    { path: 'docs/ai/rules/15_architecture.mdc', content: architectureRule(config), ownership: 'full', kind: 'architecture-rule', source: 'architecture-profile-registry-and-initialization-decision' },
    { path: 'docs/ai/decision-ledger.json', content: stableJson(buildDecisionLedger(scan, config)), ownership: 'full', kind: 'canonical', source: 'project-classification-and-governance-config' },
    { path: 'docs/ai/bootstrap-prompt.md', content: bootstrapPrompt(config), ownership: 'seed', kind: 'canonical', source: 'template:bootstrap-prompt' },
    { path: 'docs/ai/acceptance-contract.json', content: readText(path.join(PACKAGE_ROOT, 'assets/contracts/acceptance-contract.json')), ownership: 'seed', kind: 'canonical', source: 'asset:acceptance-contract' },
    { path: 'docs/ai/release-acceptance-policy.json', content: readText(path.join(PACKAGE_ROOT, 'assets/policies/release-acceptance-policy.json')), ownership: 'full', kind: 'release-policy', source: 'asset:release-acceptance-policy' },
  ];

  const moduleGraph = moduleGraphDeclaration(config);
  if (moduleGraph) artifacts.push({
    path: 'docs/ai/module-graph.json',
    content: stableJson(moduleGraph),
    ownership: 'full',
    kind: 'architecture-module-graph',
    source: 'architecture-profile-registry-and-initialization-decision',
  });

  if (config.domainConstraints.length > 0) {
    artifacts.push({ path: BUSINESS_CONSTRAINTS_PATH, content: businessConstraintRegistryContent(config), ownership: 'full', kind: 'business-constraint-registry', source: 'owner-confirmed-config' });
    if (config.governanceDepth !== 'minimal') {
      const content = businessConstraintSkill(config);
      artifacts.push({ path: BUSINESS_CONSTRAINT_SKILL_PATH, content, ownership: 'seed', kind: 'canonical-skill', source: 'owner-confirmed-config' });
      const canonicalContent = readText(path.join(scan.root, BUSINESS_CONSTRAINT_SKILL_PATH), content);
      const targets = [];
      if (agents.some((agent) => ['codex', 'cursor', 'generic'].includes(agent.id))) targets.push('.agents/skills/business-constraints/SKILL.md');
      if (agents.some((agent) => agent.id === 'claude-code')) targets.push('.claude/skills/business-constraints/SKILL.md');
      for (const target of unique(targets)) artifacts.push({ path: target, content: canonicalContent, ownership: 'full', kind: 'adapter-skill', source: BUSINESS_CONSTRAINT_SKILL_PATH });
    }
  }

  if (config.governanceDepth !== 'minimal') {
    artifacts.push({ path: 'docs/ai/rules/20_stack.mdc', content: stackRule(config, packs), ownership: 'seed', kind: 'canonical', source: 'capability-pack-registry' });
    artifacts.push(...technicalStandardArtifacts);
    artifacts.push(...buildCapabilityArtifacts(config).artifacts);
  } else if ((config.projectCapabilities?.length ?? 0) > 0 || config.capabilityEvolution) {
    artifacts.push(...buildCapabilityArtifacts(config).artifacts);
  }
  if (config.governanceDepth === 'complete') artifacts.push(...fullDepthArtifacts(config));
  if (config.features.externalWorkflows) {
    artifacts.push({
      path: 'docs/ai/workflow-integrations.yaml',
      content: `schema_version: 1\nmode: project-native\nproviders: {}\nauthority:\n  current_product_behavior: project-code-and-tests\n  active_change: project-native\n  project_ai_governance: docs/ai\n  implementation_task_list: project-native\n  runtime_state: docs/ai/long-running\n  delivery_evidence: docs/ai/acceptance-results.json\n`,
      ownership: 'seed', kind: 'canonical', source: 'template:workflow-integrations',
    });
  }
  if (config.features.hooks) {
    artifacts.push({
      path: 'docs/ai/hooks.md',
      content: `# Hook integration candidate\n\nHook installation was selected, but each agent uses a different lifecycle API. Keep this capability \`unverified\` until a real client entrypoint calls the project delivery check and a negative/recovery probe passes. Do not install a shell-specific adapter or bypass an existing hook chain.\n`,
      ownership: 'seed', kind: 'canonical', source: 'template:hooks-candidate',
    });
  }
  if (config.features.ciIntegration) {
    artifacts.push({
      path: 'docs/ai/ci-integration.md',
      content: `# CI integration candidate\n\nAdd \`${governanceCommand(config, 'check .')}\` to the repository's existing CI task runner only after the tool has a pinned installation source. Until the real workflow is replayed with a deliberate drift failure and recovery, report CI enforcement as \`unverified\`.\n`,
      ownership: 'seed', kind: 'canonical', source: 'template:ci-candidate',
    });
  }

  if (agents.some((agent) => agent.id === 'claude-code')) {
    artifacts.push({
      path: 'CLAUDE.md',
      content: `@AGENTS.md\n\nClaude Code loads the shared project governance through the native import above.`,
      ownership: 'managed-block', kind: 'adapter', source: 'AGENTS.md',
    });
  }
  if (agents.some((agent) => agent.id === 'cursor')) {
    artifacts.push({ path: '.cursor/rules/ai-code-governance.mdc', content: cursorRule(config), ownership: 'full', kind: 'adapter', source: 'docs/ai/rules/00_always.mdc' });
  }

  if (config.governanceDepth === 'complete') {
    for (const pack of packs) {
      const canonicalPath = `docs/ai/skills/${pack.id}/SKILL.md`;
      const content = stackSkill(config, pack);
      artifacts.push({ path: canonicalPath, content, ownership: 'seed', kind: 'canonical-skill', source: 'capability-pack-registry' });
      const canonicalContent = readText(path.join(scan.root, canonicalPath), content);
      const targets = [];
      if (agents.some((agent) => ['codex', 'cursor', 'generic'].includes(agent.id))) targets.push(`.agents/skills/${pack.id}/SKILL.md`);
      if (agents.some((agent) => agent.id === 'claude-code')) targets.push(`.claude/skills/${pack.id}/SKILL.md`);
      for (const target of unique(targets)) artifacts.push({ path: target, content: canonicalContent, ownership: 'full', kind: 'adapter-skill', source: canonicalPath });
    }
  }
  return artifacts.map((artifact) => ({ ...artifact, path: normalizeRelative(artifact.path) }));
}

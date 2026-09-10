import path from 'node:path';
import { CLIENT_SUPPORT_MODES, CLIENT_SUPPORT_SOURCES, CONFIG_PATH, CONFIG_SCHEMA_VERSION, GENERATED_MARKER, INVOCATION_MODES, PACKAGE_ROOT, SUPPORTED_CONFIRMED_RISK_SIGNALS, SUPPORTED_DEPTHS, SUPPORTED_INTERACTION_LANGUAGES, SUPPORTED_LANGUAGES, SUPPORTED_OSES, TOOL_NAME, TOOL_VERSION } from '../../constants.mjs';
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

export function governanceCommand(config, args = '') {
  const suffix = args ? ` ${args}` : '';
  if (config.invocationMode === 'project-local') return `npm exec -- aicg${suffix}`;
  if (config.invocationMode === 'global') return `aicg${suffix}`;
  return `npm exec --yes --package=ai-code-governance@${config.toolVersion ?? TOOL_VERSION} -- aicg${suffix}`;
}

export function defaultConfig(scan) {
  const assessment = classifyProject(scan);
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
      requiredDecisions: assessment.requiredDecisions,
    },
    canonicalRoot: 'docs/ai',
    clients: ['codex', 'claude-code', 'cursor'],
    stacks: scan.stacks.map((stack) => stack.id),
    governanceDepth: 'standard',
    artifactLanguage: 'zh-CN',
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

function normalizeInitialClassification(config, scan) {
  if (config.initialClassification) return config;
  const assessment = classifyProject(scan);
  return {
    ...config,
    initialClassification: {
      codebase: assessment.codebase,
      implementationBoundary: assessment.implementationBoundary,
      requiredDecisions: assessment.requiredDecisions,
    },
  };
}

export function validateConfig(config) {
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

function initializationGuidance(config) {
  const initialization = config.initialization;
  if (initialization?.lifecycle === 'greenfield') {
    return 'The repository is confirmed as greenfield. Establish new code with the approved project architecture profile; do not collapse unrelated layers into a catch-all directory.';
  }
  switch (initialization?.existingCodeStrategy) {
    case 'keep-existing':
      return 'Existing code is protected. Do not change its architecture or behavior unless a separate request explicitly authorizes that work.';
    case 'new-code-standard':
      return 'Existing code is protected. Apply the approved project architecture profile to new code only; do not rewrite legacy code as incidental cleanup.';
    case 'staged-migration':
      return 'Existing code is protected until a separate staged-migration plan, compatibility contract, and approval exist. Initialization itself must not rewrite business code.';
    default:
      return 'Existing-code handling is not yet confirmed. Preserve existing code and stop before architectural or behavioral changes.';
  }
}

function rootInstructions(config, scan) {
  const assessment = config.initialClassification ?? classifyProject(scan);
  const technicalStandards = config.governanceDepth === 'minimal'
    ? ''
    : `\n- Read \`${config.canonicalRoot}/technical-standards.json\` and \`${config.canonicalRoot}/capability-evolution.json\`; load matching technical and project-capability Skills before implementation.`;
  const completeCommand = governanceCommand(config, 'complete .');
  const assessCommand = governanceCommand(config, `assess . --locale ${config.interactionLanguage ?? 'en'} --json`);
  const hookCommand = governanceCommand(config, 'hook install . --yes');
  const syncCommand = governanceCommand(config, 'sync .');
  const harvestCommand = governanceCommand(config, 'harvest .');
  const promoteCommand = governanceCommand(config, 'promote ...');
  const releaseCommand = governanceCommand(config, 'release-check . --type <type> --evidence <repository-relative-json>');
  const businessGuidance = config.domainConstraints.length === 0
    ? ''
    : config.governanceDepth === 'minimal'
      ? '\n- Owner-confirmed business constraints exist. Select standard or complete governance to generate a routable business constraint Skill. Production readiness is blocked while evidence is missing, incomplete, or mismatched; complete bound records remain unverified and only eligible for review.'
      : `\n- Before changing behavior, read \`${BUSINESS_CONSTRAINT_SKILL_PATH}\`; every affected owner-confirmed constraint requires success plus negative/boundary evidence bound to its current id, text, and hash.`;
  return `## ${languageTitle(config, 'AI 编码治理', 'AI coding governance')}

This block is managed by \`aicg\`. Project-specific content outside this block is preserved.

- Canonical governance: \`${config.canonicalRoot}/\`
- Repository topology: \`${assessment.codebase.topology.value}\`
- Initial scanner lifecycle evidence: \`${assessment.codebase.lifecycle.value}\` (\`${assessment.codebase.lifecycle.confidence}\` confidence)
- Governance depth: \`${config.governanceDepth}\`
- Selected stacks: ${config.stacks.map((item) => `\`${item}\``).join(', ')}
- Initialization boundary: ${initializationGuidance(config)}
- Read \`${config.canonicalRoot}/architecture-profile.json\` and \`${config.canonicalRoot}/rules/15_architecture.mdc\` before placing new source. The profile is the sole current architecture policy; it never authorizes migration.
- Read \`${config.canonicalRoot}/context-map.yaml\` before implementation and load only matching profiles.
${businessGuidance}
${technicalStandards}
- Code and tests override stale documentation; update the affected governance evidence in the same change.
- Do not run completion gates after ordinary conversation turns. When a change is ready, run \`${completeCommand}\` once; after \`${hookCommand}\`, Git also validates the exact staged snapshot before commit.
- A completion gate is validation only: it never stages files or invents semantic memory, capability Skills, or documentation. Use separately approved \`${syncCommand}\`, \`${harvestCommand}\`, or \`${promoteCommand}\` commands for those changes.
- Store temporary review notes under \`reviews/\`. Store generated task and diagnostic reports under \`reports/\`. Both directories are local working areas and their contents are ignored by Git.
- Auditable release evidence under \`${config.canonicalRoot}/release-evidence/\` must remain tracked. Do not move formal governance records into ignored working directories.
- Before deployment or publication, classify the release as \`bugfix\`, \`feature\`, or \`major\`, read \`${config.canonicalRoot}/release-acceptance-policy.json\`, and preview \`${releaseCommand}\`. Execute receipt-bound npm scripts only with \`--replay --approve <planHash>\` for the exact returned plan; do not fabricate human review evidence.

### ${languageTitle(config, '运行时验证入口', 'Runtime verification entrypoints')}

${languageTitle(
    config,
    `- package scripts 会随项目演进，因此不复制进受管入口。运行 \`${assessCommand}\`，从 \`actionGuide.allowedVerificationCommands\` 选择当前允许命令，再运行 \`${completeCommand} --verify "<允许的命令>"\`。未知命令或附加参数会被拒绝。`,
    `- Package scripts change as the project evolves, so managed guidance does not copy them. Run \`${assessCommand}\`, select a current command from \`actionGuide.allowedVerificationCommands\`, then run \`${completeCommand} --verify "<allowed command>"\`. Unknown commands and appended arguments are rejected.`,
  )}`;
}

function alwaysRule(config) {
  const technicalStandards = config.governanceDepth === 'minimal'
    ? ''
    : ' and matching entries in `docs/ai/technical-standards.json` plus `docs/ai/capability-evolution.json`';
  const syncCommand = governanceCommand(config, 'sync .');
  const harvestPreview = governanceCommand(config, 'harvest . --dry-run');
  const harvestCommand = governanceCommand(config, 'harvest .');
  const promoteCommand = governanceCommand(config, 'promote ...');
  const completeCommand = governanceCommand(config, 'complete .');
  const releaseCommand = governanceCommand(config, 'release-check');
  return `---
alwaysApply: true
---

# ${languageTitle(config, '常驻治理规则', 'Always-on governance')}

1. Read \`AGENTS.md\`, then select the smallest matching profile from \`${config.canonicalRoot}/context-map.yaml\`${technicalStandards}.
2. Preserve unrelated user changes and keep work inside the requested scope.
3. Treat code and tests as current behavior evidence; repair stale governance documentation in the same change.
4. Use only repository commands that exist and report commands that were not run.
5. Do not edit generated client adapters; edit canonical governance and run \`${syncCommand}\`.
6. Do not claim a client, platform, hook, or external workflow is enforced without replay evidence.
7. When product behavior changes are ready for capability evolution, an authorized operator explicitly runs \`${harvestPreview}\`; if it finds a candidate or review item, apply its separately approved harvest before claiming capability evolution is complete.
8. Do not run completion gates after ordinary conversation turns. Before delivery, run \`${completeCommand}\` with an explicitly selected discovered verification command when needed; an installed Git pre-commit hook validates only the staged snapshot. Completion never stages files or synthesizes semantic memory, Skills, or documentation; use separately approved \`${syncCommand}\`, \`${harvestCommand}\`, or \`${promoteCommand}\` commands for those mutations.
9. Before architecture or behavior changes, read \`.ai-governance/config.json\` and \`docs/ai/decision-ledger.json\`. They are the sole current record of initialization lifecycle, existing-code strategy, and implementation boundary; do not infer a migration authorization from this seed file.
10. Before deployment or publication, run the tiered \`${releaseCommand}\` against repository-local evidence. Bug fixes, features, and major releases have different evidence and independent-review requirements; never synthesize reviewer approval.
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

function contextMap(config) {
  const hasBusinessSkill = config.domainConstraints.length > 0 && config.governanceDepth !== 'minimal';
  const rules = config.governanceDepth === 'minimal'
    ? ['docs/ai/rules/00_always.mdc', 'docs/ai/rules/15_architecture.mdc']
    : ['docs/ai/rules/00_always.mdc', 'docs/ai/rules/15_architecture.mdc', 'docs/ai/rules/20_stack.mdc'];
  if (hasBusinessSkill) rules.push(BUSINESS_CONSTRAINT_SKILL_PATH);
  const reviewRules = ['docs/ai/rules/00_always.mdc'];
  if (hasBusinessSkill) reviewRules.push(BUSINESS_CONSTRAINT_SKILL_PATH);
  const technicalStandardStart = config.governanceDepth === 'minimal' ? '' : '  - docs/ai/technical-standards.json\n  - docs/ai/capability-evolution.json\n';
  const checkCommand = governanceCommand(config, 'check .');
  const releaseCommand = governanceCommand(config, 'release-check . --type <bugfix|feature|major> --evidence <repository-relative-json> [--replay --approve <planHash>]');
  const businessProfile = config.domainConstraints.length === 0 ? '' : hasBusinessSkill
    ? `  business_constraints:
    description: Apply owner-confirmed business invariants without inferring risk from wording.
    triggers:
      en: [business rule, invariant, acceptance]
      zh: [业务规则, 不变量, 验收]
    required:
      - ${BUSINESS_CONSTRAINTS_PATH}
      - ${BUSINESS_CONSTRAINT_SKILL_PATH}
    verify:
      - ${checkCommand}
`
    : `  business_constraints:
    description: Production readiness is blocked until every owner-confirmed constraint has complete evidence bound to its current id, text, and hash; recorded evidence remains unverified and only eligible for review.
    required:
      - ${BUSINESS_CONSTRAINTS_PATH}
    cta: Select standard or complete governance to generate the routable business constraint Skill, then record success plus negative or boundary evidence.
`;
  return `version: 1
default_start:
  - AGENTS.md
  - docs/ai/context-map.yaml
  - docs/ai/rules/00_always.mdc
${technicalStandardStart}profiles:
  implementation:
    description: Implement or change observable repository behavior.
    triggers:
      en: [implement, feature, fix, refactor]
      zh: [实现, 功能, 修复, 重构]
    required:
${yamlList(rules, 6)}
    verify:
      - ${checkCommand}
  review:
    description: Review changes without taking implementation ownership.
    triggers:
      en: [review, audit]
      zh: [评审, 审计]
    required:
${yamlList(reviewRules, 6)}
    verify:
      - ${checkCommand}
${businessProfile}  release:
    description: Validate risk-tiered evidence before deployment or publication.
    triggers:
      en: [release, deploy, publish]
      zh: [发布, 部署, 上线]
    required:
      - docs/ai/rules/00_always.mdc
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
  config = normalizeInitialClassification(config, scan);
  validateConfig(config);
  const agents = resolveAgents(config.clients);
  const packs = resolvePacks(config.stacks);
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
    { path: 'AGENTS.md', content: rootInstructions(config, scan), ownership: 'managed-block', kind: 'entrypoint', source: 'template:agents' },
    { path: 'docs/ai/README.md', content: governanceReadme(config, scan, packs), ownership: 'seed', kind: 'canonical', source: 'template:canon-readme' },
    { path: 'docs/ai/context-map.yaml', content: contextMap(config), ownership: 'seed', kind: 'canonical', source: 'template:context-map' },
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
    artifacts.push(...buildTechnicalStandardArtifacts(config, scan).artifacts);
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

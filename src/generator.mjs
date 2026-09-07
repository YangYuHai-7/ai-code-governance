import path from 'node:path';
import { CONFIG_PATH, CONFIG_SCHEMA_VERSION, GENERATED_MARKER, PACKAGE_ROOT, SUPPORTED_DEPTHS, SUPPORTED_LANGUAGES, SUPPORTED_OSES, TOOL_NAME, TOOL_VERSION } from './constants.mjs';
import { resolveAgents, resolvePacks } from './registry.mjs';
import { normalizeRelative, readText, stableJson, unique, usageError } from './utils.mjs';

function yamlList(values, indent = 0) {
  const prefix = ' '.repeat(indent);
  return values.length > 0 ? values.map((value) => `${prefix}- ${JSON.stringify(value)}`).join('\n') : `${prefix}[]`;
}

function languageTitle(config, zh, en) {
  if (config.artifactLanguage === 'en') return en;
  if (config.artifactLanguage === 'bilingual') return `${zh} / ${en}`;
  return zh;
}

export function defaultConfig(scan) {
  return {
    schemaVersion: CONFIG_SCHEMA_VERSION,
    generatedBy: TOOL_NAME,
    toolVersion: TOOL_VERSION,
    projectName: scan.projectName,
    projectMode: scan.projectMode,
    canonicalRoot: 'docs/ai',
    clients: ['codex', 'claude-code', 'cursor'],
    stacks: scan.stacks.map((stack) => stack.id),
    governanceDepth: 'standard',
    artifactLanguage: 'zh-CN',
    supportedOs: ['macos', 'windows', 'linux'],
    features: {
      knowledge: false,
      taskRuntime: false,
      hooks: false,
      externalWorkflows: false,
      ciIntegration: false,
      aiAssist: false,
    },
    domainConstraints: [],
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
  resolvePacks(config.stacks ?? []);
  if (!SUPPORTED_DEPTHS.includes(config.governanceDepth)) throw usageError(`Unsupported governance depth: ${config.governanceDepth}`);
  if (!SUPPORTED_LANGUAGES.includes(config.artifactLanguage)) throw usageError(`Unsupported artifact language: ${config.artifactLanguage}`);
  if (!Array.isArray(config.supportedOs) || config.supportedOs.some((value) => !SUPPORTED_OSES.includes(value))) {
    throw usageError('config.supportedOs contains an unsupported operating system.');
  }
  if (!config.features || typeof config.features !== 'object') throw usageError('config.features is required.');
  if (!Array.isArray(config.domainConstraints)) throw usageError('config.domainConstraints must be an array.');
  return config;
}

function rootInstructions(config, scan) {
  const commands = scan.commands.length > 0 ? scan.commands.map((item) => `- \`${item.command}\` — discovered from \`${item.source}\``).join('\n') : '- No verified repository command was discovered; do not invent one.';
  return `## ${languageTitle(config, 'AI 编码治理', 'AI coding governance')}

This block is managed by \`aicg\`. Project-specific content outside this block is preserved.

- Canonical governance: \`${config.canonicalRoot}/\`
- Project mode: \`${config.projectMode}\`
- Governance depth: \`${config.governanceDepth}\`
- Selected stacks: ${config.stacks.map((item) => `\`${item}\``).join(', ')}
- Read \`${config.canonicalRoot}/context-map.yaml\` before implementation and load only matching profiles.
- Code and tests override stale documentation; update the affected governance evidence in the same change.
- Completion requires \`aicg check .\` plus the strongest discovered project verification below.

### ${languageTitle(config, '已发现的验证入口', 'Discovered verification entrypoints')}

${commands}`;
}

function alwaysRule(config) {
  return `---
alwaysApply: true
---

# ${languageTitle(config, '常驻治理规则', 'Always-on governance')}

1. Read \`AGENTS.md\`, then select the smallest matching profile from \`${config.canonicalRoot}/context-map.yaml\`.
2. Preserve unrelated user changes and keep work inside the requested scope.
3. Treat code and tests as current behavior evidence; repair stale governance documentation in the same change.
4. Use only repository commands that exist and report commands that were not run.
5. Do not edit generated client adapters; edit canonical governance and run \`aicg sync .\`.
6. Do not claim a client, platform, hook, or external workflow is enforced without replay evidence.
7. Before completion, run \`aicg check .\` and the selected verification profile.
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
  const rules = config.governanceDepth === 'minimal' ? ['docs/ai/rules/00_always.mdc'] : ['docs/ai/rules/00_always.mdc', 'docs/ai/rules/20_stack.mdc'];
  return `version: 1
default_start:
  - AGENTS.md
  - docs/ai/context-map.yaml
  - docs/ai/rules/00_always.mdc
profiles:
  implementation:
    description: Implement or change observable repository behavior.
    triggers:
      en: [implement, feature, fix, refactor]
      zh: [实现, 功能, 修复, 重构]
    required:
${yamlList(rules, 6)}
    verify:
      - aicg check .
  review:
    description: Review changes without taking implementation ownership.
    triggers:
      en: [review, audit]
      zh: [评审, 审计]
    required:
      - docs/ai/rules/00_always.mdc
    verify:
      - aicg check .
`;
}

function verificationProfiles(scan) {
  const commands = scan.commands.map((item) => item.command);
  return `version: 1
profiles:
  governance:
    paths:
      - AGENTS.md
      - docs/ai/**
      - .ai-governance/**
    commands:
      - aicg check .
  project:
    paths:
      - "**"
    commands:
${yamlList(commands.length > 0 ? commands : ['# not yet verified: select a real project command'], 6)}
`;
}

function governanceReadme(config, scan, packs) {
  return `# ${config.projectName} — ${languageTitle(config, 'AI 治理正典', 'AI governance canon')}

This directory is the human-maintained governance source. Client-specific regular files are generated adapters and are checked by \`aicg check .\`.

## Configuration

- Mode: \`${config.projectMode}\`
- Depth: \`${config.governanceDepth}\`
- Clients: ${config.clients.map((item) => `\`${item}\``).join(', ')}
- Stacks: ${packs.map((pack) => `\`${pack.id}\` (${pack.evidence})`).join(', ')}
- Supported OS targets: ${config.supportedOs.map((item) => `\`${item}\``).join(', ')}
- Current generator evidence: \`${scan.currentOs}\` only until CI or real-client probes complete.

## Ownership

| Path | Owner |
| --- | --- |
| \`docs/ai/\` | Human-maintained governance canon |
| \`.ai-governance/config.json\` | Confirmed initialization decisions |
| \`.ai-governance/manifest.json\` | Generated ownership and content hashes |
| Client-specific adapters | \`aicg sync\`; do not edit directly |

## Gaps

${config.domainConstraints.length > 0 ? config.domainConstraints.map((item) => `- Confirmed constraint: ${item}`).join('\n') : '- No project-specific business invariant was confirmed during deterministic initialization.'}
- Stack-specific rules must be refreshed against current official documentation before being promoted to enforced policy.
- Hooks, CI integration, and external workflow providers remain disabled unless the configuration explicitly enables them.
`;
}

function antiPatterns(config) {
  return `# ${languageTitle(config, '项目反模式', 'Project anti-patterns')}

Only add an item after repository evidence, a review finding, an incident, or an explicit owner decision exists.

## Generated adapter edits

**Wrong:** Edit a client-specific generated rule or Skill directly.

**Right:** Edit the canonical source and run \`aicg sync .\`.

**Why:** Direct edits create client drift and will fail \`aicg check .\`.
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
  return `# AI-assisted governance completion

The deterministic \`aicg init\` phase is complete for ${config.projectName}.

Inspect the repository and refine the human-maintained files under \`${config.canonicalRoot}/\`. Preserve generated adapters and existing user content. Derive business rules only from requirements, code, tests, ADRs, incidents, or explicit user decisions. Research current official documentation for the selected stack versions. Run \`aicg sync .\` after canonical Skill or rule changes, then run \`aicg check .\` and real project verification commands. Do not enable hooks, CI, external providers, publishing, or destructive migration without explicit authorization.
`;
}

function cursorRule(config) {
  return `---
description: Route Cursor to the repository AI governance canon.
alwaysApply: true
---

<!-- ${GENERATED_MARKER} -->

Read \`AGENTS.md\`, then follow \`${config.canonicalRoot}/context-map.yaml\` and \`${config.canonicalRoot}/rules/00_always.mdc\`. Client-specific adapters are generated; change canonical governance and run \`aicg sync .\`.
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
  validateConfig(config);
  const agents = resolveAgents(config.clients);
  const packs = resolvePacks(config.stacks);
  const artifacts = [
    { path: CONFIG_PATH, content: stableJson(config), ownership: 'full', kind: 'configuration', source: 'confirmed-decisions' },
    { path: 'AGENTS.md', content: rootInstructions(config, scan), ownership: 'managed-block', kind: 'entrypoint', source: 'template:agents' },
    { path: 'docs/ai/README.md', content: governanceReadme(config, scan, packs), ownership: 'seed', kind: 'canonical', source: 'template:canon-readme' },
    { path: 'docs/ai/context-map.yaml', content: contextMap(config), ownership: 'seed', kind: 'canonical', source: 'template:context-map' },
    { path: 'docs/ai/rules/00_always.mdc', content: alwaysRule(config), ownership: 'seed', kind: 'canonical', source: 'template:always-rule' },
    { path: 'docs/ai/verification-profiles.yaml', content: verificationProfiles(scan), ownership: 'seed', kind: 'canonical', source: 'repository-scan' },
    { path: 'docs/ai/anti-patterns.md', content: antiPatterns(config), ownership: 'seed', kind: 'canonical', source: 'template:anti-patterns' },
    { path: 'docs/ai/stack-profile.json', content: stableJson({ schemaVersion: 1, packs: packs.map((pack) => ({ id: pack.id, lifecycle: pack.lifecycle, evidence: pack.evidence, validationSources: pack.validation_sources })) }), ownership: 'full', kind: 'canonical', source: 'capability-pack-registry' },
    { path: 'docs/ai/bootstrap-prompt.md', content: bootstrapPrompt(config), ownership: 'seed', kind: 'canonical', source: 'template:bootstrap-prompt' },
    { path: 'docs/ai/acceptance-contract.json', content: readText(path.join(PACKAGE_ROOT, 'assets/acceptance-contract.json')), ownership: 'seed', kind: 'canonical', source: 'asset:acceptance-contract' },
  ];

  if (config.governanceDepth !== 'minimal') {
    artifacts.push({ path: 'docs/ai/rules/20_stack.mdc', content: stackRule(config, packs), ownership: 'seed', kind: 'canonical', source: 'capability-pack-registry' });
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
      content: `# CI integration candidate\n\nAdd \`aicg check .\` to the repository's existing CI task runner only after the tool has a pinned installation source. Until the real workflow is replayed with a deliberate drift failure and recovery, report CI enforcement as \`unverified\`.\n`,
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

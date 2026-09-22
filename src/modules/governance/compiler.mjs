import fs from 'node:fs';
import path from 'node:path';
import { CLIENT_SUPPORT_MODES, CLIENT_SUPPORT_SOURCES, CONFIG_PATH, CONFIG_SCHEMA_VERSION, GENERATED_MARKER, INVOCATION_MODES, PACKAGE_ROOT, SUPPORTED_CODE_DOCUMENTATION_POLICIES, SUPPORTED_CONFIRMED_RISK_SIGNALS, SUPPORTED_DEPTHS, SUPPORTED_GOVERNANCE_FOOTPRINTS, SUPPORTED_INTERACTION_LANGUAGES, SUPPORTED_LANGUAGES, SUPPORTED_OSES, SUPPORTED_TEST_CASE_FORMATS, TOOL_NAME, TOOL_VERSION } from '../../constants.mjs';
import { allBuiltInClientIds, resolveAgents, resolvePacks, selectedSkillDirectories } from '../../catalogs/index.mjs';
import { architectureProfileDocument, architectureRule, moduleGraphDeclaration, validateArchitectureDecision } from '../architecture/index.mjs';
import { buildCapabilityArtifacts, validateCapabilityEvolution, validateProjectCapabilities } from '../capabilities/index.mjs';
import { buildDecisionLedger, buildDevelopmentDocumentationArtifacts, buildGreenfieldLayoutArtifacts, classifyProject, EXISTING_CODE_STRATEGIES, hasDocumentableDevelopmentUnit, INITIALIZATION_LIFECYCLES, INITIALIZATION_SOURCES, surfaceVerificationProfiles } from '../repository/index.mjs';
import { assertSkillQuality, buildTechnicalStandardArtifacts, buildProjectConventionArtifacts, loadTechnicalStandardRegistry, selectTechnicalStandards } from '../standards/index.mjs';
import { buildMemoryArtifacts } from '../memory/index.mjs';
import { validateAdaptiveDecisions, validateApprovedAgentTeam, validateSkillDecision } from '../skills/index.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative, normalizeRelative, sha256, skillAdapterContent, stableJson } from '../../shared/index.mjs';
import { BUSINESS_CONSTRAINT_SKILL_PATH, BUSINESS_CONSTRAINTS_PATH, BUSINESS_RISK_EVIDENCE_PATH, businessConstraintRegistryContent, businessConstraintSkill } from './business-constraints.mjs';
import { conditionalArtifactRoutes, hasArtifactEvidence, hasGovernanceUsage, selectArtifactDefinitions } from './artifact-selection.mjs';
import { taskRoutingPolicy, taskRoutingSummary } from './task-routing.mjs';
import { buildDeliveryLoopArtifacts, DELIVERY_LOOP_ENTRY_KIND, DELIVERY_LOOP_PHASE_KIND } from './delivery-loop.mjs';
import { planArtifacts } from './artifact-plan.mjs';
import { canonicalPath, remapContentPaths, relativeReference } from './layout.mjs';
import { clientProjectionDefinitions, SKILL_ADAPTER_FLAG } from './projections.mjs';
import { assertNoLinkAncestor } from '../../preconditions.mjs';

const COMPACTED_SEED_PATHS = ['docs/ai/bootstrap-prompt.md', 'reviews/.gitkeep', 'reports/.gitkeep', BUSINESS_CONSTRAINT_SKILL_PATH];

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
  // Pinned mode records bootstrap provenance; daily work requires an installed CLI.
  return `aicg${suffix}`;
}

export function governanceBootstrapCommand(config, args = 'help') {
  const suffix = args ? ` ${args}` : '';
  return `npm exec --yes --package=ai-code-governance@${config.toolVersion ?? TOOL_VERSION} -- aicg${suffix}`;
}

/**
 * Footprint of the managed configuration already recorded in this repository.
 *
 * A configuration created from scratch is `compact`. A repository that already carries a
 * managed configuration keeps the layout it recorded; a pre-footprint configuration with no
 * field at all is `preserve`, so an upgrade never silently converges an existing tree. Reading
 * the value from the recorded config (instead of just testing for the file) keeps regeneration
 * from defaults deterministic: applying a `compact` config and then rebuilding from defaults
 * must not flip the footprint to `preserve`.
 */
function recordedGovernanceFootprint(root) {
  try {
    const existing = JSON.parse(fs.readFileSync(path.join(root, CONFIG_PATH), 'utf8'));
    return SUPPORTED_GOVERNANCE_FOOTPRINTS.includes(existing?.governanceFootprint)
      ? existing.governanceFootprint
      : 'preserve';
  } catch {
    return 'compact';
  }
}

export function projectLocalAvailable(root) {
  if (!root) return false;
  try {
    const packageName = 'ai-code-governance';
    const packageRoot = path.join(root, 'node_modules', packageName);
    const manifest = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'));
    if (manifest.name !== packageName || typeof manifest.bin?.aicg !== 'string') return false;
    const entry = path.resolve(packageRoot, manifest.bin.aicg);
    if (!entry.startsWith(`${packageRoot}${path.sep}`) || !fs.statSync(entry).isFile()) return false;
    const bin = path.join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'aicg.cmd' : 'aicg');
    if (!fs.statSync(bin).isFile()) return false;
    fs.accessSync(entry, fs.constants.R_OK);
    if (process.platform === 'win32') {
      const shim = fs.readFileSync(bin, 'utf8').replaceAll('\\', '/');
      return shim.includes(`../${packageName}/${manifest.bin.aicg.replace(/^\.\//, '')}`);
    }
    fs.accessSync(bin, fs.constants.X_OK);
    return fs.realpathSync(bin) === fs.realpathSync(entry);
  } catch {
    return false;
  }
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
    invocationMode: projectLocalAvailable(scan.root) ? 'project-local' : 'npm-exec-pinned',
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
    governanceFootprint: recordedGovernanceFootprint(scan.root),
    stacks: scan.stacks.map((stack) => stack.id),
    // `complete` is the default governance depth: every repository lands with the
    // Skill-management set (skill-discovery + team-orchestrator + skill-index +
    // project-agent-team) wired into the same exact-planHash approval. Operators who
    // want a strictly smaller artifact set can still opt into `standard` or `minimal`
    // explicitly; the default exists because the recommended entry point
    // (`aicg config open`) plus an AI-driven init means the operator usually does not
    // want to revisit the depth decision after first install.
    governanceDepth: 'complete',
    artifactLanguage: 'en',
    codeDocumentationPolicy: assessment.codebase.lifecycle.value === 'existing' ? 'inherit-existing' : 'en',
    testing: {
      schemaVersion: 1,
      caseFormat: 'aicg-json-v2',
      caseRoot: 'docs/ai/testing',
      reportRoot: 'reports/testing',
      reportLanguage: 'en',
      humanPerspective: 'ask',
    },
    supportedOs: ['macos', 'windows', 'linux'],
    technologyPackages: [],
    projectCapabilities: [],
    skillDiscovery: { enabled: false },
    agentTeam: { enabled: false },
    features: {
      knowledge: true,
      taskRuntime: false,
      hooks: false,
      externalWorkflows: false,
      ciIntegration: false,
      deliveryLoop: true,
      aiAssist: false,
    },
    domainConstraints: [],
    confirmedRiskSignals: [],
    scanExclusions: { schemaVersion: 1, policySha256: scan.scanIgnore?.sha256 ?? null, approvals: [] },
  };
}

function normalizeConfigDefaults(config, scan) {
  const assessment = !config.initialClassification || config.codeDocumentationPolicy === undefined ? classifyProject(scan) : null;
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
    governanceFootprint: config.governanceFootprint ?? 'preserve',
    testing: {
      schemaVersion: 1,
      caseFormat: 'aicg-json-v2',
      caseRoot: 'docs/ai/testing',
      reportRoot: 'reports/testing',
      reportLanguage: config.artifactLanguage === 'zh-CN' ? 'zh-CN' : 'en',
      humanPerspective: 'ask',
      ...(config.testing ?? {}),
    },
    codeDocumentationPolicy: config.codeDocumentationPolicy
      ?? defaultCodeDocumentationPolicy(config, assessment?.codebase.lifecycle.value),
    initialClassification: {
      ...initialClassification,
      requiredDecisions,
    },
  };
}

export function validateConfig(config) {
  if (config.adaptiveDecisions !== undefined) validateAdaptiveDecisions(config.adaptiveDecisions);
  if (config.scanExclusions !== undefined) {
    const policy = config.scanExclusions;
    if (!policy || policy.schemaVersion !== 1 || !Array.isArray(policy.approvals) || policy.approvals.length > 32
      || (policy.policySha256 !== null && !/^[a-f0-9]{64}$/.test(policy.policySha256 ?? ''))) throw usageError('scanExclusions must bind a valid .aicgignore policy digest and bounded approvals.');
    for (const approval of policy.approvals) {
      if (!approval || typeof approval.path !== 'string' || typeof approval.reason !== 'string' || !approval.reason.trim() || approval.reason.length > 500
        || !/^[a-f0-9]{64}$/.test(approval.evidenceHash ?? '')) throw usageError('scanExclusions approvals require path, reason, and evidenceHash.');
    }
  }
  if (config.codeDocumentationPolicy === undefined) {
    config = { ...config, codeDocumentationPolicy: defaultCodeDocumentationPolicy(config) };
  }
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) throw usageError(`config.schemaVersion must be ${CONFIG_SCHEMA_VERSION}.`);
  if (!config.projectName || typeof config.projectName !== 'string') throw usageError('config.projectName is required.');
  if (!['greenfield', 'brownfield', 'monorepo', 'repository-family'].includes(config.projectMode)) {
    throw usageError(`Unsupported project mode: ${config.projectMode}`);
  }
  if (config.canonicalRoot !== 'docs/ai') throw usageError('The first CLI release requires canonicalRoot to be docs/ai.');
  config = { ...config, governanceFootprint: config.governanceFootprint ?? 'preserve' };
  if (!SUPPORTED_GOVERNANCE_FOOTPRINTS.includes(config.governanceFootprint)) {
    throw usageError(`config.governanceFootprint must be one of: ${SUPPORTED_GOVERNANCE_FOOTPRINTS.join(', ')}.`);
  }
  resolveAgents(config.clients ?? []);
  if (config.clientSupport !== undefined) {
    if (!config.clientSupport || typeof config.clientSupport !== 'object') throw usageError('config.clientSupport must be an object.');
    if (!CLIENT_SUPPORT_MODES.includes(config.clientSupport.mode)) throw usageError(`config.clientSupport.mode must be one of: ${CLIENT_SUPPORT_MODES.join(', ')}.`);
    if (!CLIENT_SUPPORT_SOURCES.includes(config.clientSupport.source)) throw usageError(`config.clientSupport.source must be one of: ${CLIENT_SUPPORT_SOURCES.join(', ')}.`);
    if (!Array.isArray(config.clientSupport.selectedClients) || config.clientSupport.selectedClients.length === 0) throw usageError('config.clientSupport.selectedClients must contain at least one client.');
    resolveAgents(config.clientSupport.selectedClients);
    if (stableJson(config.clientSupport.selectedClients) !== stableJson(config.clients ?? [])) throw usageError('config.clients must match config.clientSupport.selectedClients.');
    const builtIn = allBuiltInClientIds();
    if (config.clientSupport.mode === 'all-built-in' && stableJson(config.clientSupport.selectedClients) !== stableJson(builtIn)) {
      throw usageError(`config.clientSupport.mode all-built-in must select ${builtIn.join(', ')} in registry order.`);
    }
  }
  if (config.externalGovernance !== undefined) {
    const external = config.externalGovernance;
    if (!external || typeof external !== 'object' || Array.isArray(external)) throw usageError('config.externalGovernance must be an object.');
    if (external.schemaVersion !== 1) throw usageError('config.externalGovernance.schemaVersion must be 1.');
    if (external.strategy !== 'adopt') throw usageError("config.externalGovernance.strategy must be 'adopt'.");
    if (!Array.isArray(external.adopted)
      || external.adopted.some((entry) => typeof entry !== 'string' || !isSafeRelative(entry) || normalizeRelative(entry) !== entry)) {
      throw usageError('config.externalGovernance.adopted must be an array of safe repository-relative paths.');
    }
    config = {
      ...config,
      externalGovernance: { schemaVersion: 1, strategy: 'adopt', adopted: [...new Set(external.adopted)].sort((left, right) => left.localeCompare(right)) },
    };
  }
  resolvePacks(config.stacks ?? []);
  if (!SUPPORTED_DEPTHS.includes(config.governanceDepth)) throw usageError(`Unsupported governance depth: ${config.governanceDepth}`);
  if (!SUPPORTED_LANGUAGES.includes(config.artifactLanguage)) throw usageError(`Unsupported artifact language: ${config.artifactLanguage}`);
  if (config.interactionLanguage !== undefined && !SUPPORTED_INTERACTION_LANGUAGES.includes(config.interactionLanguage)) throw usageError(`Unsupported interaction language: ${config.interactionLanguage}`);
  if (!SUPPORTED_CODE_DOCUMENTATION_POLICIES.includes(config.codeDocumentationPolicy)) throw usageError(`Unsupported code documentation policy: ${config.codeDocumentationPolicy}`);
  const testing = config.testing ?? {
    schemaVersion: 1,
    caseFormat: 'aicg-json-v2',
    caseRoot: 'docs/ai/testing',
    reportRoot: 'reports/testing',
    reportLanguage: config.artifactLanguage === 'zh-CN' ? 'zh-CN' : 'en',
    humanPerspective: 'ask',
  };
  if (!testing || typeof testing !== 'object' || Array.isArray(testing) || Object.keys(testing).some((key) => !['schemaVersion', 'caseFormat', 'caseRoot', 'reportRoot', 'reportLanguage', 'humanPerspective'].includes(key))) throw usageError('testing contains unsupported fields.');
  if (testing.schemaVersion !== 1 || !SUPPORTED_TEST_CASE_FORMATS.includes(testing.caseFormat)) throw usageError(`testing must use schemaVersion 1 and a supported caseFormat: ${SUPPORTED_TEST_CASE_FORMATS.join(', ')}.`);
  for (const [field, value] of [['caseRoot', testing.caseRoot], ['reportRoot', testing.reportRoot]]) {
    if (typeof value !== 'string' || !isSafeRelative(value) || normalizeRelative(value) !== value || value.split('/').some((part) => part.toLowerCase() === '.git')) throw usageError(`testing.${field} must be a safe repository-relative directory outside .git.`);
  }
  if (!['en', 'zh-CN'].includes(testing.reportLanguage)) throw usageError('testing.reportLanguage must be en or zh-CN.');
  if (!['ask', 'not-required', 'required'].includes(testing.humanPerspective)) throw usageError('testing.humanPerspective must be ask, not-required, or required.');
  config = { ...config, testing };
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
  validateSkillGovernanceConfig(config);
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
  if (config.artifactLanguage === 'zh-CN') return `## AI 编码治理

本区块由 \`aicg\` 管理，区块外的项目专属内容会保留。

- 治理正典：\`${config.canonicalRoot}/\`
- 从 \`${config.canonicalRoot}/context-map.yaml\` 的 \`ordinary\` 配置开始，仅在任务需要时加载更大的配置。
- 保留无关的用户修改，并在请求范围内工作。
- 如果配置的 AICG 命令不可用，停止并请求明确安装；日常工作不得临时下载包。${config.invocationMode === 'npm-exec-pinned' || !config.invocationMode ? ` 固定版本引导需要全局安装 ai-code-governance@${config.toolVersion ?? TOOL_VERSION}，或本地安装后明确选择 project-local 配置。` : ''}
- ${taskRoutingSummary(config)}
- 任务开始时可运行 \`${governanceCommand(config, 'route . --text "<task>"')}\` 获取等级、已审批角色建议与专业复核缺口；角色建议本身不是已分派的 Agent。
- 治理文件必须先预览并经用户确认才应用；业务代码修改必须在实施前获得用户确认，修改后运行适用测试并保存测试结果报告。
- 客户端适配器由工具生成。修改正典后运行 \`${syncCommand}\`，不要直接编辑适配器。
- 交付前运行一次 \`${completeCommand}\`，并按运行时指引选择任务所需的仓库验证命令。
`;
  return `## ${languageTitle(config, 'AI 编码治理', 'AI coding governance')}

This block is managed by \`aicg\`. Project-specific content outside this block is preserved.

- Canonical governance: \`${config.canonicalRoot}/\`
- Start with the \`ordinary\` profile in \`${config.canonicalRoot}/context-map.yaml\`; use a larger profile only when the task requires it.
- Preserve unrelated user changes and remain within the requested scope.
- If the configured AICG command is unavailable, stop and request an explicit install; never fetch a package during daily work.${config.invocationMode === 'npm-exec-pinned' || !config.invocationMode ? ` Pinned bootstrap requires a global installation of ai-code-governance@${config.toolVersion ?? TOOL_VERSION}, or a local installation followed by an explicit project-local configuration choice.` : ''}
- ${taskRoutingSummary(config)}
- At task start, \`${governanceCommand(config, 'route . --text "<task>"')}\` recommends the task level and approved roles; a recommendation does not mean an Agent was launched or a qualified human was assigned.
- Preview governance changes and obtain user confirmation before applying them. Obtain user confirmation before business-code implementation, then run applicable tests and save a test result report.
- Client adapters are generated. Change the canonical source and run \`${syncCommand}\`; do not edit adapters directly.
- Before delivery, run \`${completeCommand}\` once with any required repository verification command selected by its runtime guidance.
`;
}

function alwaysRule(config) {
  const completeCommand = governanceCommand(config, 'complete .');
  if (config.artifactLanguage === 'zh-CN') return `---
alwaysApply: true
---

# 常驻治理规则

1. 保留无关的用户修改，将工作限制在请求范围内。
2. 将代码和测试视为当前行为的证据，保持受影响的治理声明准确。
3. 如实报告证据，包括未实际运行的命令、客户端、平台和集成。
4. 仅使用仓库中存在的命令，不得编造命令或添加未经批准的参数。
5. 交付前运行一次 \`${completeCommand}\`，并执行任务需要且已发现的验证命令。
`;
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
  if (config.artifactLanguage === 'zh-CN') return `---
alwaysApply: false
profiles: [implementation]
---

# 技术栈证据边界

| 能力包 | 证据状态 | 验证来源 |
| --- | --- | --- |
${rows}

- 应用特定版本的指引前，从仓库清单或锁文件确认已安装版本。
- 生成或修改框架专属编码规范前，查阅当前官方文档。
- 选中的 \`unverified\` 能力包仅提供路由，不代表认证证据。
- 结合相邻实现和测试，将通用技术栈指引落实到项目。
`;
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

function contextMap(config, selected) {
  const selectedPaths = new Set(selected.map((definition) => definition.path));
  const checkCommand = governanceCommand(config, 'check .');
  const releaseCommand = governanceCommand(config, 'release-check . --type <bugfix|feature|major> --evidence <repository-relative-json> [--replay --approve <planHash>]');
  const footprint = config.governanceFootprint ?? 'compact';
  const alwaysPath = canonicalPath('docs/ai/rules/00_always.mdc', footprint);
  const releasePath = canonicalPath('docs/ai/release-acceptance-policy.json', footprint);
  const conditional = [...conditionalArtifactRoutes(selected, 'behavior_change')]
    .flatMap(([condition, paths]) => [`      ${condition}:`, ...paths.map((relative) => `        - ${relative}`)]);
  return `version: 1
base:
  required:
    - ${alwaysPath}
profiles:
  ordinary:
    extends: base
    required: []
  behavior_change:
    extends: ordinary
    conditional:${conditional.length ? `\n${conditional.join('\n')}` : ' {}'}
    verify:
      - ${checkCommand}
  release:
    extends: ordinary
    description: ${languageTitle(config, '部署或发布前，验证对应风险等级的证据。', 'Validate risk-tiered evidence before deployment or publication.')}
    required:${selectedPaths.has(releasePath) ? `\n      - ${releasePath}` : ' []'}
    commandTemplate: ${releaseCommand}
`;
}

function verificationProfiles(config) {
  const assessCommand = governanceCommand(config, `assess . --locale ${config.interactionLanguage ?? 'en'} --json`);
  const runtimeInstruction = config.artifactLanguage === 'zh-CN'
    ? `# 运行时发现验证命令：检查 ${assessCommand} 返回的 actionGuide.allowedVerificationCommands`
    : `# runtime discovery required: inspect actionGuide.allowedVerificationCommands from ${assessCommand}`;
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

function governanceReadme(config, scan, packs, selected) {
  const selectedPaths = new Set(selected.map((definition) => definition.path));
  const checkCommand = governanceCommand(config, 'check .');
  const releaseCommand = governanceCommand(config, 'release-check . --type <type> --evidence <repository-relative-json>');
  const syncCommand = governanceCommand(config, 'sync .');
  const footprint = config.governanceFootprint ?? 'compact';
  const architectureProfile = canonicalPath('docs/ai/architecture-profile.json', footprint);
  const releasePolicy = canonicalPath('docs/ai/release-acceptance-policy.json', footprint);
  const decisionLedger = canonicalPath('docs/ai/decision-ledger.json', footprint);
  const architectureLink = relativeReference('docs/ai/README.md', architectureProfile);
  const releaseLink = relativeReference('docs/ai/README.md', releasePolicy);
  const familyBoundaryZh = config.projectMode === 'repository-family'
    ? '\n## 仓库族边界\n\n本仓库仅负责编排。[repository-family.json](repository-family.json) 只记录稳定的成员关系和治理权威边界；成员技术栈、代码约定、验证命令和运行时状态须在各成员仓库内分别检查和治理，父清单不得拥有成员文件。\n'
    : '';
  const familyBoundaryEn = config.projectMode === 'repository-family'
    ? '\n## Repository-family boundary\n\nThis repository is an orchestrator only. [repository-family.json](repository-family.json) records stable membership and governance authority boundaries only. Inspect and govern member stacks, conventions, verification commands, and runtime status inside each member repository; the parent manifest never owns member files.\n'
    : '';
  if (config.artifactLanguage === 'zh-CN') return `# ${config.projectName} — AI 治理正典

本目录是人工维护的治理来源。客户端专属普通文件是生成的适配器，由 \`${checkCommand}\` 检查。

${selectedPaths.has(architectureProfile) ? '生成的[架构配置](${architectureLink})是未来源码放置的唯一当前策略，不授权迁移业务代码。' : '尚未选择架构策略；依赖生成的放置指引前，需要确认架构决策。'}

${selectedPaths.has(releasePolicy) ? `部署或发布前，结合[发布验收策略](${releaseLink})及 Git 跟踪的证据运行 \`${releaseCommand}\`，检查具体重放计划后，使用 \`--replay --approve <planHash>\` 执行。` : '发布、端验证和验收策略在首次使用时生成。生成治理产物不授予部署或发布权限。'} 工具不会编造独立评审者的批准。

## 配置

当前机器可读状态由[确认配置](../../.ai-governance/config.json)统一维护。不要在本文复制拓扑、深度、客户端、技术栈或平台值。
${familyBoundaryZh}

## 初始化边界

唯一当前初始化决策保存在 \`.ai-governance/config.json\`${selectedPaths.has(decisionLedger) ? '，并派生到 `docs/ai/decision-ledger.json`' : ''}。修改架构或既有行为前，先读取已记录的决策。本种子文档不授权迁移。

## 所有权

| 路径 | 维护责任 |
| --- | --- |
| \`docs/ai/\` | 人工维护的治理正典 |
${selectedPaths.has(releasePolicy) ? `| \`docs/ai/release-acceptance-policy.json\` | 由 \`${syncCommand}\` 更新的受管基线，仅可通过独立覆盖策略收紧 |\n` : ''}| \`.ai-governance/config.json\` | 已确认的初始化决策 |
| \`.ai-governance/manifest.json\` | 生成的所有权和内容哈希 |
| 客户端专属适配器 | 运行 \`${syncCommand}\` 生成，不直接编辑 |

## 待补证据

${config.domainConstraints.length > 0 ? config.domainConstraints.map((item) => `- 已确认约束：${item}`).join('\n') : '- 确定性初始化期间尚未确认项目专属业务不变量。'}
- 技术栈专属规则在提升为强制策略前，需要依据当前官方文档更新。
- 除非配置明确启用，否则钩子、CI 集成和外部工作流提供方保持关闭。
`;
  return `# ${config.projectName} — ${languageTitle(config, 'AI 治理正典', 'AI governance canon')}

This directory is the human-maintained governance source. Client-specific regular files are generated adapters and are checked by \`${checkCommand}\`.

${selectedPaths.has(architectureProfile) ? 'The generated [architecture profile](${architectureLink}) is the sole current policy for future source placement. It never authorizes business-code migration.' : 'Architecture policy is not selected. Confirm an architecture decision before relying on generated placement guidance.'}

${selectedPaths.has(releasePolicy) ? `Before deployment or publication, use the generated [release acceptance policy](${releaseLink}) and Git-tracked evidence with \`${releaseCommand}\`, inspect the exact replay plan, then execute it with \`--replay --approve <planHash>\`.` : 'Release, surface, and acceptance policies are materialized on first use. Generated governance does not grant deployment or publication authority.'} The tool never invents independent reviewer approval.

## Configuration

The current machine-readable state is maintained in the [confirmed configuration](../../.ai-governance/config.json). Do not duplicate topology, depth, clients, stacks, or platform values in this document.
${familyBoundaryEn}

## Initialization boundary

The single current initialization decision is stored in \`.ai-governance/config.json\`${selectedPaths.has(decisionLedger) ? ' and derived into `docs/ai/decision-ledger.json`' : ''}. Read the recorded decisions before changing architecture or existing behavior. This seed document never grants migration authorization.

## Ownership

| Path | Owner |
| --- | --- |
| \`docs/ai/\` | Human-maintained governance canon |
${selectedPaths.has(releasePolicy) ? `| \`docs/ai/release-acceptance-policy.json\` | Managed baseline updated by \`${syncCommand}\`; tighten only through a separate override |\n` : ''}| \`.ai-governance/config.json\` | Confirmed initialization decisions |
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
  if (config.artifactLanguage === 'zh-CN') return `# 项目反模式

仅在存在仓库证据、评审发现、事故或负责人明确决策后添加条目。

## 修改生成的适配器

**错误：** 直接编辑客户端专属的生成规则或技能适配器。

**正确：** 修改正典来源并运行 \`${syncCommand}\`。

**原因：** 直接编辑会造成客户端漂移，并导致 \`${checkCommand}\` 失败。
`;
  return `# ${languageTitle(config, '项目反模式', 'Project anti-patterns')}

Only add an item after repository evidence, a review finding, an incident, or an explicit owner decision exists.

## Generated adapter edits

**Wrong:** Edit a client-specific generated rule or Skill directly.

**Right:** Edit the canonical source and run \`${syncCommand}\`.

**Why:** Direct edits create client drift and will fail \`${checkCommand}\`.
`;
}

function stackSkill(config, pack, scan, selectedStandards = []) {
  const zh = config.artifactLanguage === 'zh-CN';
  const standardRows = selectedStandards.length
    ? selectedStandards.map((standard) => `| ${standard.title} | \`docs/ai/skills/standards/${standard.id}/SKILL.md\` | ${zh ? '仅当任务表面匹配时加载' : 'Load only when the task surface matches'} |`).join('\n')
    : `| ${zh ? '未发现精确技术标准' : 'No exact technical standard detected'} | - | ${zh ? '读取相邻代码并记录缺口' : 'Read neighboring code and record the gap'} |`;
  const commands = scan.commands.filter((command) => command.verification?.purpose?.includes('verification'));
  const commandRows = commands.length
    ? commands.map((command) => `| \`${command.command}\` | \`${command.verification.cwd}\` | ${zh ? `命令完成对应验证且退出成功；可信度：${command.verification.trust.level}` : `The declared verification completes successfully; trust: ${command.verification.trust.level}`} |`).join('\n')
    : `| - | - | ${zh ? '尚未验证；未发现入口' : 'not yet verified; no entrypoint discovered'} |`;
  const content = `---
name: ${pack.id}
description: ${zh ? `修改 ${pack.id} 代码时，用此路由选择精确实现 Skill、项目证据和验证命令。` : `Route ${pack.id} changes to exact implementation Skills, project evidence, and verification commands.`}
---

# ${pack.id}

<!-- ${GENERATED_MARKER} -->

## When to use

- ${zh ? `新增、修改或评审 ${pack.id} 的生产代码。` : `Add, change, or review ${pack.id} production code.`}
- ${zh ? '需要确定应加载哪个实现标准、项目约定或验证入口。' : 'Choose which implementation standard, project convention, or verification entrypoint to load.'}

## When not to use

- ${zh ? '不要用本路由推断业务规则、授权模型或跨仓库契约。' : 'Do not use this router to infer business rules, authorization models, or cross-repository contracts.'}
- ${zh ? '不要用通用栈建议覆盖相邻代码和已批准的项目 Skill。' : 'Do not override neighboring code or approved project Skills with generic stack advice.'}

## Required invariants

- ${zh ? '一次任务只加载命中变更表面的最小 Skill 集。' : 'Load the smallest Skill set that matches the changed surface.'}
- ${zh ? '项目专属证据可以收紧通用标准，但必须可追溯且未过期。' : 'Project evidence may narrow general standards, but it must remain traceable and fresh.'}
- ${zh ? '命令未运行或不可信时，结果必须标记为尚未验证。' : 'When a command is not run or is untrusted, report the result as not yet verified.'}

## Decision flow

1. ${zh ? '从变更文件和清单证据识别实际代码表面。' : 'Identify the actual code surface from changed files and manifest evidence.'}
2. ${zh ? '从下表加载精确技术 Skill，再读取相邻实现、测试和已批准的项目约定。' : 'Load exact technical Skills from the table, then read neighboring implementation, tests, and approved project conventions.'}
3. ${zh ? '若只有候选约定或证据冲突，停止提升并请求证据绑定的负责人决定。' : 'If only a candidate convention exists or evidence conflicts, stop promotion and request an evidence-bound owner decision.'}
4. ${zh ? '执行验证矩阵；分别报告通过、失败和尚未验证。' : 'Run the verification matrix and report pass, fail, and not-yet-verified outcomes separately.'}

## Skill routing matrix

| ${zh ? '代码表面' : 'Surface'} | Skill | ${zh ? '加载规则' : 'Load rule'} |
| --- | --- | --- |
${standardRows}

## Exceptions and escalation

- ${zh ? '版本敏感行为必须查阅匹配版本的官方来源。' : 'Version-sensitive behavior requires official sources matching the installed version.'}
- ${zh ? '发现新的稳定项目模式时，只生成候选；没有负责人回执不得自动采纳。' : 'A newly repeated project pattern remains a candidate until an owner adopts its exact evidence.'}

## Verification matrix

| ${zh ? '命令' : 'Command'} | cwd | ${zh ? '期望结果' : 'Expected result'} |
| --- | --- | --- |
${commandRows}

## Project evidence boundary

- ${zh ? '清单和源码路径证明技术存在，不证明业务语义。' : 'Manifest and source paths prove technology presence, not business meaning.'}
- ${zh ? '本路由不声称项目已经采用所有列出的标准。' : 'This router does not claim that the project already follows every listed standard.'}

## Sources

- ${zh ? `扫描到的技术栈：${pack.id}；清单路径：${scan.stacks.find((stack) => stack.id === pack.id)?.paths.join(', ') || '未记录'}。` : `Detected stack: ${pack.id}; manifest paths: ${scan.stacks.find((stack) => stack.id === pack.id)?.paths.join(', ') || 'not recorded'}.`}
- ${zh ? `验证来源：${(pack.validation_sources ?? []).join('; ') || '仅限仓库命令'}。` : `Validation sources: ${(pack.validation_sources ?? []).join('; ') || 'repository commands only'}.`}
`;
  assertSkillQuality(content, { profile: 'workflow', id: pack.id });
  return content;
}

function bootstrapPrompt(config) {
  const syncCommand = governanceCommand(config, 'sync .');
  const checkCommand = governanceCommand(config, 'check .');
  if (config.artifactLanguage === 'zh-CN') return `# AI 辅助完善治理

${config.projectName} 的确定性 \`${governanceCommand(config, 'init')}\` 阶段已完成。

${config.invocationMode === 'npm-exec-pinned' || !config.invocationMode ? `仅用于引导：\`${governanceBootstrapCommand(config)}\` 临时解析固定版本的软件包，不安装日常 CLI。执行日常命令前，明确运行 \`npm install --global ai-code-governance@${config.toolVersion ?? TOOL_VERSION}\`，或本地安装并明确选择 project-local 模式。如果无法安装，停止并报告缺失的 CLI。\n` : ''}
检查仓库并完善 \`${config.canonicalRoot}/\` 下人工维护的文件。保留生成的适配器及用户既有内容。提出代码变更前，读取 \`.ai-governance/config.json\` 和 \`docs/ai/decision-ledger.json\`；初始化决策以此为准，本种子提示不授权迁移或业务代码修改。仅依据需求、代码、测试、ADR、事故或用户明确决策推导业务规则。研究所选技术栈版本的当前官方文档。修改正典技能或规则后运行 \`${syncCommand}\`，随后执行 \`${checkCommand}\` 和真实项目验证命令。未经明确授权，不启用钩子、CI、外部提供方、发布或破坏性迁移。
`;
  return `# AI-assisted governance completion

The deterministic \`${governanceCommand(config, 'init')}\` phase is complete for ${config.projectName}.

${config.invocationMode === 'npm-exec-pinned' || !config.invocationMode ? `Bootstrap only: \`${governanceBootstrapCommand(config)}\` temporarily resolves the pinned package and does not install a daily CLI. Before daily commands, explicitly install with \`npm install --global ai-code-governance@${config.toolVersion ?? TOOL_VERSION}\`, or install locally and explicitly select project-local mode. If installation is unavailable, stop and report the missing CLI.\n` : ''}

Inspect the repository and refine the human-maintained files under \`${config.canonicalRoot}/\`. Preserve generated adapters and existing user content. Before proposing any code change, read \`.ai-governance/config.json\` and \`docs/ai/decision-ledger.json\`; initialization decisions are authoritative there, and this seed prompt never authorizes migration or business-code changes. Derive business rules only from requirements, code, tests, ADRs, incidents, or explicit user decisions. Research current official documentation for the selected stack versions. Run \`${syncCommand}\` after canonical Skill or rule changes, then run \`${checkCommand}\` and real project verification commands. Do not enable hooks, CI, external providers, publishing, or destructive migration without explicit authorization.
`;
}

function cursorRule(config) {
  const footprint = config.governanceFootprint ?? 'compact';
  const alwaysPath = canonicalPath('docs/ai/rules/00_always.mdc', footprint);
  if (config.artifactLanguage === 'zh-CN') return `---
description: 将 Cursor 路由到仓库的 AI 治理正典。
alwaysApply: true
---

<!-- ${GENERATED_MARKER} -->

读取 \`AGENTS.md\`，随后遵循 \`${config.canonicalRoot}/context-map.yaml\` 和 \`${alwaysPath}\`。客户端专属适配器由工具生成；修改正典治理后运行 \`${governanceCommand(config, 'sync .')}\`。
`;
  return `---
description: Route Cursor to the repository AI governance canon.
alwaysApply: true
---

<!-- ${GENERATED_MARKER} -->

Read \`AGENTS.md\`, then follow \`${config.canonicalRoot}/context-map.yaml\` and \`${alwaysPath}\`. Client-specific adapters are generated; change canonical governance and run \`${governanceCommand(config, 'sync .')}\`.
`;
}

function stableFamilyMembers(family, governanceUnits = []) {
  return (family?.members ?? []).map((member) => {
    const unit = governanceUnits.find((candidate) => candidate.path === member.path);
    return {
      id: member.id,
      path: member.path,
      repositoryKind: member.repositoryKind,
      governanceMode: 'autonomous',
      members: stableFamilyMembers(unit?.repositoryFamily, unit?.governanceUnits),
    };
  });
}

export function artifactDefinitions(config, scan) {
  const packs = resolvePacks(config.stacks);
  const definitions = [];
  const footprint = config.governanceFootprint ?? 'compact';
  const locate = (relative) => canonicalPath(relative, footprint);
  const add = (legacyRelative, capability, content, { activation = 'selected', requires = [], ownership = 'seed', routeProfiles = [], gateAssertions = [], kind = 'canonical', source = 'template:governance' } = {}) => {
    const relative = locate(legacyRelative);
    const mappedSource = typeof source === 'string' ? locate(source) : source;
    definitions.push({
      id: relative, path: relative, capability, activation, requires, ownership, routeProfiles,
      gateAssertions: [...gateAssertions, ...(routeProfiles.some((route) => route.startsWith('behavior_change:')) ? ['conditional-route'] : [])],
      build: (selected) => ({ path: relative, content: content(selected), ownership, kind, source: mappedSource }),
    });
  };
  const core = { activation: 'eager-core' };
  const architecture = (value) => ['approved', 'active', 'advisory'].includes(value.architecture?.status);
  const business = (value) => value.domainConstraints.length > 0;
  const stack = (value) => value.stacks.length > 0;
  const complete = (value) => value.governanceDepth === 'complete';
  const usage = (name) => (_config, snapshot) => hasGovernanceUsage(snapshot, name);
  // Adapter roots come from the agent registry, so a new client is one registry entry rather
  // than a new `clients.includes(...)` branch at every generator site.
  const adapterDirs = selectedSkillDirectories(config.clients);
  const addSkillAdapters = (legacyCanonicalPath, content, capability, requires) => {
    const skillPath = locate(legacyCanonicalPath);
    // Mark the canonical Skill so projections can derive the same discovery adapters.
    if (definitions.at(-1)?.path === skillPath) definitions.at(-1)[SKILL_ADAPTER_FLAG] = true;
    const suffix = skillPath.slice('docs/ai/skills/'.length);
    for (const directory of adapterDirs) {
      add(`${directory}/${suffix}`, capability, () => skillAdapterContent(skillPath, readText(path.join(scan.root, skillPath), content())), {
        requires, ownership: 'full', kind: 'adapter-skill', source: skillPath,
      });
    }
  };

  add(CONFIG_PATH, 'core', () => stableJson(config), { ...core, ownership: 'full', kind: 'configuration', source: 'confirmed-decisions' });
  add('AGENTS.md', 'core', () => rootInstructions(config), { ...core, ownership: 'managed-block', kind: 'entrypoint', source: 'template:agents', gateAssertions: ['shared-entrypoint'] });
  add('docs/ai/README.md', 'core', (selected) => governanceReadme(config, scan, packs, selected), { ...core, source: 'template:canon-readme' });
  add('docs/ai/context-map.yaml', 'core', (selected) => contextMap(config, selected), { ...core, source: 'template:context-map', gateAssertions: ['context-map'] });
  add('docs/ai/rules/00_always.mdc', 'core', () => alwaysRule(config), { ...core, source: 'template:always-rule' });
  add('docs/ai/verification-profiles.yaml', 'routing', () => verificationProfiles(config), { source: 'template:runtime-verification' });
  add('docs/ai/task-routing-policy.json', 'routing', () => stableJson(taskRoutingPolicy(config)), { ownership: 'full', kind: 'task-routing-policy', source: 'template:task-routing-policy' });
  // Skill management and the project agent team are governed surfaces that only belong to a
  // repository whose owner has opted into adaptive skill discovery and per-task role routing.
  // The Complete depth turns them on; Standard and Minimal never generate these artifacts, so
  // Standard produces a strictly smaller artifact set than Complete rather than sharing it.
  for (const name of ['skill-discovery', 'team-orchestrator']) {
    add(`docs/ai/skills/${name}/SKILL.md`, 'skill-management', () => managementSkill(config, name), {
      requires: [(value) => value.governanceDepth === 'complete'],
      ownership: 'full', kind: 'skill-management-skill', source: 'approved-skill-governance-plan', routeProfiles: [`behavior_change:${name.replaceAll('-', '_')}`, ...(name === 'team-orchestrator' && hasCompactManagement(config) && config.domainConstraints.length ? ['behavior_change:business'] : [])],
      gateAssertions: name === 'team-orchestrator' && hasCompactManagement(config) && config.domainConstraints.length ? ['business-skill-route'] : [],
    });
  }
  add('docs/ai/skill-index.json', 'skill-management', () => stableJson(config.skillDiscovery.decision), {
    requires: [(value) => value.governanceDepth === 'complete'],
    ownership: 'full', kind: 'skill-management-index', source: 'approved-skill-governance-plan', routeProfiles: ['behavior_change:skill_discovery'],
  });
  add('docs/ai/agent-team.json', 'skill-management', () => stableJson({ ...config.agentTeam, roles: config.agentTeam.roleProposals }), {
    requires: [(value) => value.governanceDepth === 'complete'],
    ownership: 'full', kind: 'project-agent-team', source: 'approved-skill-governance-plan', routeProfiles: ['behavior_change:team_orchestrator'],
  });
  add('docs/ai/decision-ledger.json', 'routing', () => stableJson(buildDecisionLedger(scan, config)), { ownership: 'full', source: 'project-classification-and-governance-config' });
  // The delivery loop is the requirement-to-convergence workflow (decomposition, assignment,
  // development, test-authoring, local-test, report, fix-loop): an entry Skill, one Skill per
  // phase, a runtime ledger and one discovery adapter per client directory. It is a default
  // part of Standard and Complete because a governed repository that cannot carry a change
  // from requirement to tested result is not governed. `minimal` stays a bootstrap-only preset
  // and never carries it. An owner who does not want it sets features.deliveryLoop to false,
  // which keeps that repository's artifact set — and therefore its recorded approval — intact.
  if (config.governanceDepth !== 'minimal' && config.features?.deliveryLoop !== false) {
    for (const artifact of buildDeliveryLoopArtifacts(config).artifacts) {
      const index = definitions.length;
      add(artifact.path, 'routing', () => artifact.content, {
        ownership: artifact.ownership, kind: artifact.kind, source: artifact.source,
        requires: [(value) => value.features?.deliveryLoop !== false],
      });
      definitions[index].build = () => artifact;
      if (artifact.path.endsWith('SKILL.md')) addSkillAdapters(artifact.path, () => artifact.content, 'routing', [(value) => value.features?.deliveryLoop !== false]);
    }
  }
  add('docs/ai/repository-family.json', 'routing', () => stableJson({
    schemaVersion: 1,
    role: 'orchestrator',
    observedTopology: {
      kind: scan.repositoryFamily?.kind ?? null,
      source: scan.repositoryFamily?.source ?? null,
    },
    authority: {
      root: 'orchestrator',
      members: 'autonomous',
    },
    members: stableFamilyMembers(scan.repositoryFamily, scan.governanceUnits),
    boundaries: {
      parentOwnsMemberFiles: false,
      memberFactsAreRuntimeEvidence: true,
    },
  }), { requires: [(value) => value.projectMode === 'repository-family'], ownership: 'full', kind: 'repository-family-index', source: 'repository-family-scan', routeProfiles: ['behavior_change:repository_family'] });
  add('docs/ai/bootstrap-prompt.md', 'routing', () => bootstrapPrompt(config), { requires: [(value) => !hasCompactManagement(value)], source: 'template:bootstrap-prompt' });
  add('.gitignore', 'routing', () => '!/reviews/\n/reviews/*\n!/reports/\n/reports/*', { ownership: 'gitignore-block', kind: 'local-output-ignore', source: 'template:local-output-layout' });

  // Development documentation explains code-backed behavior. A repository with neither
  // code nor a build manifest - a repository-family orchestrator parent, or a
  // documentation-only repository - has nothing to document, so no development artifacts
  // are generated. brownfieldProgress reports those contracts as not applicable instead
  // of demanding placeholder pages that describe the absence of the code.
  const existingDevelopment = config.initialization?.lifecycle === 'existing' && hasDocumentableDevelopmentUnit(scan);
  if (existingDevelopment) {
    const development = buildDevelopmentDocumentationArtifacts(config, scan);
    for (const artifact of development.artifacts) {
      const isSkill = artifact.kind.includes('skill');
      const isLocalGovernance = ['development-unit-rule', 'development-unit-skill', 'development-unit-entrypoint'].includes(artifact.kind);
      if (artifact.kind === 'brownfield-understanding-skill') assertSkillQuality(artifact.content, { profile: 'workflow', id: 'brownfield-understanding' });
      const isCanonicalRoute = artifact.path === 'docs/ai/development/index.json' || artifact.path === 'docs/ai/skills/brownfield-understanding/SKILL.md';
      const capability = isSkill && (artifact.path.startsWith('.agents/') || artifact.path.startsWith('.claude/')) ? 'integration' : 'core';
      add(artifact.path, capability, () => artifact.content, {
        requires: isSkill || isLocalGovernance ? [(value) => value.governanceDepth !== 'minimal'] : [],
        ownership: artifact.ownership,
        kind: artifact.kind,
        source: artifact.source,
        routeProfiles: isCanonicalRoute ? ['behavior_change:brownfield_understanding'] : [],
      });
      definitions.at(-1).build = () => artifact;
    }
  }

  {
    const layoutConfig = { ...config, initialization: { ...config.initialization, lifecycle: 'greenfield' } };
    for (const artifact of buildGreenfieldLayoutArtifacts(layoutConfig).artifacts) {
      add(artifact.path, 'core', () => artifact.content, {
        requires: [(value) => value.initialization?.lifecycle === 'greenfield' && value.governanceDepth !== 'minimal'],
        ownership: artifact.ownership,
        kind: artifact.kind,
        source: artifact.source,
        routeProfiles: artifact.path === 'docs/ai/development/index.json' ? ['behavior_change:architecture'] : [],
      });
      definitions.at(-1).build = () => artifact;
    }
  }

  const antiPatternsActive = (value, current) => !hasSkillManagement(value) || hasGovernanceUsage(current, 'anti-patterns') || hasArtifactEvidence(current, 'docs/ai/anti-patterns.md');
  add('docs/ai/anti-patterns.md', 'policy', () => antiPatterns(config), { requires: [antiPatternsActive], routeProfiles: ['behavior_change:anti_patterns'], source: 'template:anti-patterns' });
  add('docs/ai/stack-profile.json', 'policy', () => stableJson({ schemaVersion: 1, packs: packs.map((pack) => ({ id: pack.id, lifecycle: pack.lifecycle, evidence: pack.evidence, validationSources: pack.validation_sources })) }), { requires: [stack], ownership: 'full', source: 'capability-pack-registry', routeProfiles: ['behavior_change:stack'] });
  add('docs/ai/rules/20_stack.mdc', 'policy', () => stackRule(config, packs), { requires: [stack], source: 'capability-pack-registry', routeProfiles: ['behavior_change:stack'] });
  add('docs/ai/architecture-profile.json', 'policy', () => stableJson(architectureProfileDocument(config)), { requires: [architecture], ownership: 'full', kind: 'architecture-profile', source: 'architecture-profile-registry-and-initialization-decision', gateAssertions: ['architecture-placement', 'architecture-route'], routeProfiles: ['behavior_change:architecture'] });
  add('docs/ai/rules/15_architecture.mdc', 'policy', () => architectureRule(config), { requires: [architecture], ownership: 'full', kind: 'architecture-rule', source: 'architecture-profile-registry-and-initialization-decision', routeProfiles: ['behavior_change:architecture'] });
  add('docs/ai/module-graph.json', 'policy', () => stableJson(moduleGraphDeclaration(config)), { requires: [architecture, (value) => Boolean(moduleGraphDeclaration(value))], ownership: 'full', kind: 'architecture-module-graph', source: 'architecture-profile-registry-and-initialization-decision', gateAssertions: ['module-graph'] });
  add(BUSINESS_CONSTRAINTS_PATH, 'policy', () => businessConstraintRegistryContent(config), { requires: [business], ownership: 'full', kind: 'business-constraint-registry', source: 'owner-confirmed-config', gateAssertions: ['business-route'], routeProfiles: ['behavior_change:business'] });
  const separateBusinessSkill = (value) => !hasCompactManagement(value);
  add(BUSINESS_CONSTRAINT_SKILL_PATH, 'policy', () => businessConstraintSkill(config), { requires: [business, separateBusinessSkill], kind: 'canonical-skill', source: 'owner-confirmed-config', gateAssertions: ['business-skill-route'], routeProfiles: ['behavior_change:business'] });
  addSkillAdapters(BUSINESS_CONSTRAINT_SKILL_PATH, () => businessConstraintSkill(config), 'policy', [business, separateBusinessSkill]);

  // Discover metadata without rendering the bundle; only selected definitions call it.
  let standards;
  let standardRegistry;
  let technicalSelection = null;
  const standardArtifacts = () => (standards ??= buildTechnicalStandardArtifacts(config, scan, standardRegistry).artifacts);
  if (config.governanceDepth !== 'minimal') {
    // Selection and rendering share this invocation's validated snapshot, never a cross-call cache.
    standardRegistry = loadTechnicalStandardRegistry();
    const selection = selectTechnicalStandards(scan, config, standardRegistry);
    technicalSelection = selection;
    const standardManifestPath = locate('docs/ai/technical-standards.json');
    const standardPaths = [standardManifestPath];
    for (const { standard } of selection.selected) {
      standardPaths.push(`docs/ai/skills/standards/${standard.id}/SKILL.md`);
      for (const directory of adapterDirs) standardPaths.push(`${directory}/standards/${standard.id}/SKILL.md`);
    }
    for (const relative of standardPaths) {
      add(relative, 'policy', () => standardArtifacts().find((artifact) => artifact.path === relative).content, { requires: [stack], ownership: 'full', kind: relative === standardManifestPath ? 'technical-standard-manifest' : 'technical-standard-skill', source: 'technical-standard-registry', routeProfiles: relative.startsWith('docs/ai/') || relative.startsWith('.ai-governance/') ? ['behavior_change:stack'] : [] });
      definitions.at(-1).build = () => standardArtifacts().find((artifact) => artifact.path === relative);
    }
  }

  for (const pack of packs) {
    const canonicalPath = `docs/ai/skills/${pack.id}/SKILL.md`;
    // `generic-unknown` is the fallback orchestrator stack. Without an explicit stack
    // usage or a previously installed file we must still emit it under `complete`, so
    // the post-init tree stays byte-identical for any depth that opts in via planHash
    // approval. The repository-family migration check below re-trusts any adapter that
    // was installed before the topology change, so a single-repo install that later
    // migrates does not leave orphans behind.
    const stackGuidanceActive = (value, current) => value.projectMode !== 'repository-family'
      && (pack.id !== 'generic-unknown' || !hasSkillManagement(value) || hasGovernanceUsage(current, 'stack') || hasArtifactEvidence(current, canonicalPath));
    const selectedForPack = (technicalSelection?.selected ?? []).map((entry) => entry.standard);
    add(canonicalPath, 'policy', () => stackSkill(config, pack, scan, selectedForPack), { requires: [complete, stackGuidanceActive], routeProfiles: [`behavior_change:pack_${pack.id.replaceAll('-', '_')}`], kind: 'canonical-skill', source: 'capability-pack-registry' });
    addSkillAdapters(canonicalPath, () => stackSkill(config, pack, scan, selectedForPack), 'policy', [complete, stackGuidanceActive]);
  }

  let capabilities;
  const capabilityArtifacts = () => (capabilities ??= buildCapabilityArtifacts(config).artifacts);
  const capabilityPaths = ['docs/ai/capability-evolution.json'];
  for (const capability of (config.projectCapabilities ?? []).filter((entry) => ['candidate', 'adopted'].includes(entry.status))) {
    capabilityPaths.push(capability.skill);
    const suffix = path.basename(path.dirname(capability.skill));
    for (const directory of adapterDirs) capabilityPaths.push(`${directory}/project/${suffix}/SKILL.md`);
  }
  for (const relative of capabilityPaths) {
    add(relative, 'lifecycle', () => capabilityArtifacts().find((artifact) => artifact.path === relative).content, { ownership: 'full', kind: relative === 'docs/ai/capability-evolution.json' ? 'capability-evolution-catalog' : 'project-capability-skill', source: 'project-capability-harvest', gateAssertions: ['capability-evidence'] });
    definitions.at(-1).build = () => capabilityArtifacts().find((artifact) => artifact.path === relative);
  }
  add('docs/ai/lifecycle.md', 'lifecycle', () => config.artifactLanguage === 'zh-CN' ? '# 治理生命周期\n\n一个功能使用一个工作单元，包含页面、API、服务、数据和测试，不按端点拆分。L0 无工作单元；L1 保持轻量。L2/L3 生产交付使用 `aicg work-unit plan . --work-unit <relative-json>` 和 `status` 预览校验，然后 `aicg complete . --work-unit <relative-json>` 绑定精确批准与一次显式验证。\n\n需求、计划、初始测试、QA 补充案例、Memory 实体覆盖和 no-memory-impact 决策均绑定计划。验证输出逐项 `AICG_QA_RESULT`；缺失、重复、失败或 blocked 必需案例阻断完成。验证后把返回的 recordedEvidence 与 recordedResults 写回同一文档，hook 只检查当前输入绑定，不重复执行；重放为 operator-declared 结构证据。行为变更必须同步 Memory。\n\n将重复出现且有证据支持的指引提升为候选规则或技能；保留唯一维护者，不自动提升或执行。\n' : '# Governance lifecycle\n\nOne feature uses one work unit across pages, APIs, services, data and tests, never one task per endpoint. L0 has no unit; L1 stays lightweight. L2/L3 production delivery uses `aicg work-unit plan . --work-unit <relative-json>` and `status` for preview, then `aicg complete . --work-unit <relative-json>` with exact approval and one explicit verification run.\n\nRequirements, plan, initial tests, QA additions, canonical Memory coverage and no-memory-impact decisions bind the plan. Verification emits per-case `AICG_QA_RESULT` markers; missing, duplicate, failed or blocked required cases prevent completion. Copy returned recordedEvidence and recordedResults into the same document after verification. Hooks check current input bindings without rerunning; replay is operator-declared structural evidence. Behavior changes synchronize Memory.\n\nPromote repeated evidence-backed guidance as candidates with one owner; never auto-promote or execute.\n', { source: 'template:lifecycle' });
  if (config.features.knowledge) {
    const memory = buildMemoryArtifacts(config, scan);
    for (const artifact of memory.artifacts) add(artifact.path, 'core', () => artifact.content, {
      ownership: artifact.ownership, kind: artifact.kind, source: artifact.source,
      routeProfiles: artifact.path === 'docs/memory/INDEX.json' ? ['behavior_change:memory'] : [],
    });
    if (config.governanceDepth !== 'minimal') for (const artifact of buildProjectConventionArtifacts(config, scan, memory.discoveryFacts).artifacts) {
      add(artifact.path, 'core', () => artifact.content, {
        ownership: artifact.ownership, kind: artifact.kind, source: artifact.source,
        routeProfiles: artifact.path === 'docs/ai/project-conventions.json' || artifact.adopted === true ? ['behavior_change:project_conventions'] : [],
      });
      definitions.at(-1).build = () => artifact;
    }
  }
  add('docs/ai/long-running/README.md', 'lifecycle', () => config.artifactLanguage === 'zh-CN' ? '# 长期任务状态\n\n每项已批准的长期工作建立一个任务目录。运行时状态引用正典计划与外部变更，不复制这些内容。\n' : '# Long-running task state\n\nCreate one task directory per approved long-running effort. Runtime state references canonical plans and external changes instead of copying them.\n', { requires: [(value) => value.features.taskRuntime], source: 'template:task-runtime' });

  add('docs/ai/workflow-integrations.yaml', 'integration', () => 'schema_version: 1\nmode: project-native\nproviders: {}\nauthority:\n  current_product_behavior: project-code-and-tests\n  active_change: project-native\n  project_ai_governance: docs/ai\n  implementation_task_list: project-native\n  runtime_state: docs/ai/long-running\n  delivery_evidence: docs/ai/acceptance-results.json\n', { requires: [(value) => value.features.externalWorkflows] });
  add('docs/ai/hooks.md', 'integration', () => config.artifactLanguage === 'zh-CN' ? '# 钩子集成候选\n\n已选择安装钩子，但各代理使用不同的生命周期 API。在真实客户端入口调用项目交付检查、且负向与恢复探针通过前，保持此能力为 `unverified`。不得安装仅适用于特定 shell 的适配器或绕过既有钩子链。\n' : '# Hook integration candidate\n\nHook installation was selected, but each agent uses a different lifecycle API. Keep this capability `unverified` until a real client entrypoint calls the project delivery check and a negative/recovery probe passes. Do not install a shell-specific adapter or bypass an existing hook chain.\n', { requires: [(value) => value.features.hooks] });
  add('docs/ai/ci-integration.md', 'integration', () => config.artifactLanguage === 'zh-CN' ? `# CI 集成候选\n\n工具具备固定版本的安装来源后，才将 \`${governanceCommand(config, 'check .')}\` 加入仓库既有的 CI 任务执行器。在真实工作流完成重放、验证故意引入的漂移失败和恢复之前，将 CI 强制执行状态报告为 \`unverified\`。\n` : `# CI integration candidate\n\nAdd \`${governanceCommand(config, 'check .')}\` to the repository's existing CI task runner only after the tool has a pinned installation source. Until the real workflow is replayed with a deliberate drift failure and recovery, report CI enforcement as \`unverified\`.\n`, { requires: [(value) => value.features.ciIntegration] });

  const evidenceLocale = config.artifactLanguage === 'zh-CN' ? 'zh-CN/' : '';
  add('docs/ai/release-acceptance-policy.json', 'evidence', () => readText(path.join(PACKAGE_ROOT, `assets/policies/${evidenceLocale}release-acceptance-policy.json`)), { activation: 'first-use', requires: [usage('release')], ownership: 'full', kind: 'release-policy', source: 'asset:release-acceptance-policy', routeProfiles: ['release'], gateAssertions: ['release-route'] });
  add('docs/ai/surface-verification-profiles.json', 'evidence', () => stableJson(surfaceVerificationProfiles(config)), { activation: 'first-use', requires: [usage('surface')], ownership: 'full', kind: 'surface-verification-profiles', source: 'asset:surface-verification-contract' });
  add('docs/ai/acceptance-contract.json', 'evidence', () => readText(path.join(PACKAGE_ROOT, `assets/contracts/${evidenceLocale}acceptance-contract.json`)), { activation: 'first-use', requires: [usage('acceptance')], source: 'asset:acceptance-contract', gateAssertions: ['acceptance-evidence'] });
  for (const relative of ['docs/ai/acceptance-results.json', 'docs/ai/surface-results.json', 'docs/ai/certification-evidence.json']) add(relative, 'evidence', () => readText(path.join(scan.root, locate(relative))), { activation: 'evidence-produced', kind: 'evidence', source: 'runtime-evidence' });

  // Thin client projections come from the agent registry and the canonical definitions above.
  // Paths already generated by a module-level adapter (standards, development, capability) are
  // kept as-is so the projection step only fills genuine gaps.
  {
    const projected = clientProjectionDefinitions(config, definitions);
    const existing = new Set(definitions.map((definition) => definition.path));
    for (const definition of projected) {
      if (existing.has(definition.path)) continue;
      definitions.push(definition);
      existing.add(definition.path);
    }
  }
  return definitions;
}

export function selectedArtifactDefinitions(config, scan) {
  config = normalizeConfigDefaults(config, scan);
  return selectNormalizedArtifactDefinitions(config, scan);
}

function selectNormalizedArtifactDefinitions(config, scan) {
  return prepareArtifactDefinitions(config, scan).selected;
}

function prepareArtifactDefinitions(config, scan) {
  validateConfig(config);
  validateSkillGovernanceConfig(config, scan.root);
  const definitions = artifactDefinitions(config, scan);
  return { definitions, selected: selectArtifactDefinitions(config, scan, definitions) };
}

export function buildArtifacts(config, scan) {
  return buildArtifactsWithDefinitions(config, scan).artifacts;
}

/** Keep definition metadata and rendering in one invocation for callers that need both. */
export function buildArtifactsWithDefinitions(config, scan) {
  config = normalizeConfigDefaults(config, scan);
  const { definitions, selected } = prepareArtifactDefinitions(config, scan);
  const artifacts = renderDefinitions(selected, config.governanceFootprint ?? 'compact');
  let governanceCostDrift = null;
  if (hasSkillManagement(config) && rendersSkillManagementArtifacts(artifacts)) {
    const cost = skillGovernanceCost(scan.root, artifacts);
    const recorded = config.skillDiscovery.artifactPlan.cost;
    // The governed receipt is the Skill-governance increment plus the artifacts this
    // transaction generates. Both must match the approved receipt exactly, so a scan or
    // generator change that adds or removes artifacts still requires fresh approval. We
    // only enter this branch when the build actually emits the Skill-management tree
    // (i.e. `complete` depth with the artifacts' `requires` satisfied), so a `standard`
    // config that opts in but does not emit management artifacts carries no receipt
    // obligation.
    if (recorded?.managed) {
      const governed = (value) => stableJson({ increment: value.increment, managed: value.managed });
      if (governed(cost) !== governed(recorded)) throw usageError(`Skill governance costs changed; exact planHash approval is required again. Computed ${governed(cost)} but the approval recorded ${governed(recorded)}.`);
    } else if (stableJson(cost.total) !== stableJson(recorded?.total)) {
      // Receipts written before the retained/managed split folded the tree into `total`,
      // which this transaction moves by itself. Report the difference instead of blocking
      // every command, including read-only check; the next approved init or sync records
      // the current receipt and the strict comparison applies again.
      governanceCostDrift = { computed: cost.total, recorded: recorded?.total ?? null, migrated: true };
    }
    if (recorded?.managed && stableJson(cost.total) !== stableJson(recorded.total) && !governanceCostDrift) {
      governanceCostDrift = { computed: cost.total, recorded: recorded.total, migrated: false };
    }
  }
  return { artifacts, definitions, governanceCostDrift };
}

/**
 * An approved receipt binds the artifact set it was approved against. A tool upgrade or a
 * generator change can move that set without touching the configuration, which leaves the
 * receipt stale: buildArtifacts then throws for every caller and no command can re-approve.
 * Recomputing the receipt here turns that into an ordinary exact-planHash approval. The
 * caller must surface the returned refresh in the plan it asks the operator to approve.
 */
export function refreshSkillGovernanceReceipt(config, scan) {
  if (!hasSkillManagement(config) || !config.skillDiscovery.artifactPlan) return null;
  const previousCost = config.skillDiscovery.artifactPlan.cost ?? null;
  const approval = prepareSkillGovernancePlan(config, scan);
  if (stableJson(approval.cost.increment) === stableJson(previousCost?.increment)
    && stableJson(approval.cost.total) === stableJson(previousCost?.total)) return null;
  return {
    config: { ...config, skillDiscovery: { ...approval.skillDiscovery, approvalPlanHash: approval.planHash }, agentTeam: approval.agentTeam },
    refresh: { reason: 'skill-governance-receipt-refresh', previousCost, cost: approval.cost, planHash: approval.planHash },
  };
}

function hasSkillManagement(config) {
  // Skill management is opt-in for `standard` and `minimal`; `complete` carries it on by
  // default. The selection filter in `artifact-selection.mjs` matches this rule by
  // guarding the artifacts' own `requires` on `=== 'complete'`, so a `standard` config
  // that opts in never actually emits management artifacts — it carries the receipt
  // without producing the tree, and `buildArtifactsWithDefinitions` therefore skips the
  // cost gate entirely (see the `artifacts` check below).
  return config.governanceDepth !== 'minimal' && config.skillDiscovery?.enabled === true && config.agentTeam?.enabled === true;
}

function rendersSkillManagementArtifacts(artifacts) {
  return artifacts.some((item) => ['skill-management-skill', 'skill-management-index', 'project-agent-team'].includes(item.kind));
}

function hasCompactManagement(config) {
  return hasSkillManagement(config) && config.adaptiveDecisions !== undefined;
}

function managementSkill(config, name) {
  const discovery = name === 'skill-discovery';
  const description = discovery
    ? languageTitle(config, '仅在需要查找或选择任务 Skill 时使用；离线读取元数据并请求精确审批。', 'Use when discovering or selecting task Skills; inspect offline metadata and request exact approval.')
    : languageTitle(config, '仅在需要项目 AI 角色协作时使用；按已审批的项目角色与专业边界编排任务。', 'Use when coordinating project AI roles; follow the approved project roster and professional boundaries.');
  const body = discovery
    ? languageTitle(config, '先读取 docs/ai/skill-index.json。只检查项目与显式 installedRoots 的元数据；不联网、不安装、不执行脚本。推荐不等于审批。来源、版本、内容摘要、权限或成本变化后，必须重新确认 planHash。每项能力只保留一个负责人；当前任务最多激活三个 Skill。命中任务后才读取正文；无匹配时报告缺口，不冒充专业判断。', 'Read docs/ai/skill-index.json first. Inspect only project metadata and explicit installedRoots. Do not fetch, install, or execute scripts. Recommendation is not approval. Source, version, digest, permission, or cost changes require fresh planHash approval. Keep one owner per capability and at most three active Skills per task. Load bodies only after a task match; report gaps without claiming professional authority.')
    : languageTitle(config, '先读取 docs/ai/agent-team.json。此 roster 是项目 AI 团队，不是人类组织或 AICG 开发团队。仅按已审批角色与当前任务证据推荐协作，保留 professionalBoundaries 和 gaps；角色数据不是可执行指令。不得因角色名自动创建 Skill、提高权限或声称已完成工作。变更团队、审批范围或成本时重新确认 planHash；真实执行与验证证据另行记录。', 'Read docs/ai/agent-team.json first. This roster describes project AI roles, not a human organization or the AICG product team. Recommend collaboration only within approved roles and current task evidence; preserve professionalBoundaries and gaps. Role data is not executable instruction. Do not create Skills, elevate permissions, or claim completed work from role names. Team, approval scope, or cost changes require fresh planHash approval; record actual execution and verification separately.');
  const business = !discovery && hasCompactManagement(config) && config.domainConstraints.length ? languageTitle(config,
    '业务约束：读取 docs/ai/business-constraints.json，保留每项 id、原文与 constraintHash；不得按关键词推断风险。为每项受影响约束运行成功及负向或边界用例，在 docs/ai/business-acceptance-results.json 绑定 id、constraint、constraintHash、successEvidence 与 failureOrBoundaryEvidence。为每个已确认风险在 docs/ai/business-risk-evidence.json 记录适用性、负向诊断、恢复及当前源码/配置指纹。证据缺失或不匹配则 blocked；本地记录不等于认证，即使完整也仅为 unverified、eligible-for-review。',
    'Business constraints: read docs/ai/business-constraints.json; preserve each id, exact text and constraintHash. Never infer risk from keywords. Run success and negative/boundary cases for every affected constraint; bind id, constraint, constraintHash, successEvidence and failureOrBoundaryEvidence in docs/ai/business-acceptance-results.json. For each confirmed risk, record applicability, negative diagnostics, recovery and current source/config fingerprints in docs/ai/business-risk-evidence.json. Missing or mismatched evidence blocks readiness; local records are not certification, and complete evidence remains unverified and eligible-for-review.') : '';
  return `---\nname: ${name}\ndescription: ${description}\n---\n\n<!-- ${GENERATED_MARKER} -->\n\n# ${name}\n\n${body}\n${business ? `\n${business.replaceAll('docs/ai/business-risk-evidence.json', BUSINESS_RISK_EVIDENCE_PATH)}\n` : ''}`;
}

/** Render selected definitions through the layout mapping. Exposed for footprint-aware checkers. */
export function renderSelectedArtifacts(selected, footprint = 'compact') {
  return renderDefinitions(selected, footprint);
}

function renderDefinitions(selected, footprint = 'compact') {
  return selected.map((definition) => definition.build(selected)).map((artifact) => ({
    ...artifact,
    path: canonicalPath(normalizeRelative(artifact.path), footprint),
    content: remapContentPaths(artifact.content, footprint),
  }));
}

function governanceContextHash(config) {
  const { skillDiscovery: _discovery, agentTeam: _team, ...base } = config;
  return sha256(stableJson(base));
}

function skillGovernanceHash(config, artifactPlan) {
  return sha256(stableJson({ schemaVersion: 1, contextHash: artifactPlan.contextHash, decision: config.skillDiscovery.decision, agentTeam: config.agentTeam, cost: artifactPlan.cost }));
}

function validateSkillGovernanceConfig(config, root = null) {
  for (const key of ['skillDiscovery', 'agentTeam']) {
    if (config[key] !== undefined && (!config[key] || typeof config[key] !== 'object' || typeof config[key].enabled !== 'boolean')) throw usageError(`${key}.enabled must be an explicit boolean.`);
  }
  if (config.agentTeam?.enabled) validateApprovedAgentTeam(config.agentTeam);
  if (config.governanceDepth !== 'complete' || (!config.skillDiscovery?.enabled && !config.agentTeam?.enabled)) return;
  if (!hasSkillManagement(config)) throw usageError('Skill management requires both an approved discovery decision and project agent team.');
  validateSkillDecision(config.skillDiscovery.decision, { root });
  const plan = config.skillDiscovery.artifactPlan;
  if (!plan || plan.contextHash !== governanceContextHash(config) || plan.planHash !== skillGovernanceHash(config, plan)
    || config.skillDiscovery.approvalPlanHash !== plan.planHash) throw usageError('Skill governance requires exact artifact planHash approval for the current config, decisions, team and costs.');
}

function skillGovernanceCost(root, artifacts) {
  const transaction = planArtifacts(root, artifacts);
  if (transaction.conflicts.length) throw usageError(`Skill governance planning conflict: ${transaction.conflicts.join('; ')}`);
  // Budget by load class rather than by total size. The always-on set is read for every
  // Skill-management decision, the delivery entry is read once per delivery, and the phase
  // Skills are read only while their phase is active. Folding all three into one ceiling
  // would either starve the entry or leave the on-demand phases unbudgeted.
  const managers = artifacts.filter((item) => item.kind === 'skill-management-skill');
  const managerTokens = Math.ceil(managers.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) / 4);
  const deliveryEntry = artifacts.filter((item) => item.kind === DELIVERY_LOOP_ENTRY_KIND);
  const deliveryEntryTokens = Math.ceil(deliveryEntry.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0) / 4);
  const deliveryPhaseBytes = artifacts
    .filter((item) => item.kind === DELIVERY_LOOP_PHASE_KIND)
    .reduce((sum, item) => sum + Buffer.byteLength(item.content), 0);
  // The increment is the Skill-management increment and nothing else. The delivery loop is
  // a separate feature with its own two ceilings above; folding its artifacts in here both
  // duplicated those ceilings and made the approved Skill-governance receipt move when an
  // operator toggled `features.deliveryLoop`, forcing fresh Skill approval for a feature the
  // approval never covered. Counting it here also contradicted the load-class rule stated
  // below the ceilings, which exists precisely to keep these three classes apart.
  const extra = artifacts.filter((item) => ['skill-management-skill', 'skill-management-index', 'project-agent-team'].includes(item.kind));
  let retainedBytes = 0;
  let retainedFiles = 0;
  const config = JSON.parse(artifacts.find((item) => item.path === CONFIG_PATH).content);
  const accounted = new Set([...transaction.operations, ...transaction.retained].map((item) => item.path));
  // Seed ownership is intentionally absent from manifests. Omitted historical seeds still cost context/storage.
  const seedPaths = COMPACTED_SEED_PATHS.map((relative) => canonicalPath(relative, config.governanceFootprint ?? 'compact'));
  if (hasCompactManagement(config)) for (const relative of seedPaths) {
    if (accounted.has(relative)) continue;
    let stat;
    try { stat = fs.lstatSync(path.join(root, relative)); } catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    assertNoLinkAncestor(root, relative);
    if (!stat.isFile() || stat.isSymbolicLink()) throw usageError('Historical seed budget cannot be verified.');
    retainedFiles += 1;
    retainedBytes += stat.size;
  }
  // A retained entry that the new manifest omits is dropped from governance by this very
  // transaction, so counting it here made the receipt depend on the manifest the same
  // transaction rewrites. The pre-apply total then differed from the post-apply total and
  // every plan that changed the managed set failed its own verification with
  // "Skill governance costs changed". Account against the projected manifest instead.
  const projectedManifest = new Set((transaction.manifest.value?.files ?? []).map((entry) => entry.path));
  for (const entry of transaction.retained) {
    if (!projectedManifest.has(entry.path)) continue;
    const absolute = path.join(root, entry.path);
    if (!fs.existsSync(absolute)) continue;
    const stat = fs.lstatSync(absolute);
    if (!stat.isFile() || stat.isSymbolicLink()) throw usageError('Retained Skill governance budget cannot be verified.');
    retainedBytes += stat.size;
    retainedFiles += 1;
  }
  const managed = {
    files: transaction.operations.length + 1,
    bytes: transaction.operations.reduce((sum, item) => sum + Buffer.byteLength(item.desired), 0) + Buffer.byteLength(transaction.manifest.content),
  };
  const cost = {
    increment: { files: extra.length, bytes: extra.reduce((sum, item) => sum + Buffer.byteLength(item.content), 0), managerTokens, deliveryEntryTokens, deliveryPhaseBytes },
    // The governed footprint is what this transaction generates. `retained` is reported
    // separately because the transaction rewrites the manifest that produces it, so it
    // cannot be part of the receipt the same transaction has to satisfy.
    managed,
    total: { files: managed.files + retainedFiles, bytes: managed.bytes + retainedBytes },
    retained: { files: retainedFiles, bytes: retainedBytes },
  };
  // Skill governance budgets the increment it introduces, not the tree it lives in.
  // `cost.total` counts every canonical artifact, retained historical seed and the
  // manifest; all of those are produced by the approved governance depth rather than by
  // Skill adoption. Comparing that tree against a fixed allowance made adoption
  // unreachable for every existing repository whose approved depth already exceeded it,
  // which permanently blocked the brownfield "no evidence-backed project Skill" gap.
  const maximumFiles = 30;
  const maximumBytes = (config.governanceDepth === 'standard' ? 96 : 128) * 1024;
  const maximumManagerTokens = 800;
  // The delivery entry is read once per delivery rather than for every Skill decision, so it
  // gets its own ceiling instead of competing with the always-on management budget. The cap
  // exists to stop unbounded growth, not to squeeze the entry: a phase dispatch table and the
  // eight contract sections already cost most of it in the two-byte-per-character zh-CN form.
  const maximumDeliveryEntryTokens = 1000;
  const maximumDeliveryPhaseBytes = 24 * 1024;
  if (cost.increment.files > maximumFiles || cost.increment.bytes > maximumBytes
    || managerTokens > maximumManagerTokens
    || deliveryEntryTokens > maximumDeliveryEntryTokens
    || deliveryPhaseBytes > maximumDeliveryPhaseBytes) {
    const error = usageError('Approved Skill governance exceeds the Skill management increment, byte, manager token, delivery entry token or on-demand phase byte budget.');
    error.budgetCost = cost;
    error.budgetLimits = { maximumFiles, maximumBytes, maximumManagerTokens, maximumDeliveryEntryTokens, maximumDeliveryPhaseBytes };
    throw error;
  }
  return cost;
}

/** Preview only: the caller must explicitly approve the returned hash before normal generation. */
export function prepareSkillGovernancePlan(config, scan) {
  config = normalizeConfigDefaults(structuredClone(config), scan);
  validateConfig({ ...config, skillDiscovery: { enabled: false }, agentTeam: { enabled: false } });
  if (!hasSkillManagement(config)) throw usageError('Skill governance approval is available only for enabled Standard/Complete decisions and team.');
  validateSkillDecision(config.skillDiscovery.decision, { root: scan.root });
  validateApprovedAgentTeam(config.agentTeam);
  config.skillDiscovery = { enabled: true, decision: config.skillDiscovery.decision, artifactPlan: {
    contextHash: governanceContextHash(config), planHash: '0'.repeat(64),
    cost: { increment: { files: 0, bytes: 0, managerTokens: 0 }, total: { files: 0, bytes: 0 } },
  }, approvalPlanHash: '0'.repeat(64) };
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const selected = selectArtifactDefinitions(config, scan, artifactDefinitions(config, scan));
    const cost = skillGovernanceCost(scan.root, renderDefinitions(selected, config.governanceFootprint ?? 'compact'));
    if (stableJson(cost) === stableJson(config.skillDiscovery.artifactPlan.cost)) {
      const planHash = skillGovernanceHash(config, config.skillDiscovery.artifactPlan);
      config.skillDiscovery.artifactPlan.planHash = planHash;
      // A placeholder cannot authorize buildArtifacts; only the user's exact hash may do so.
      return { planHash, cost, skillDiscovery: config.skillDiscovery, agentTeam: config.agentTeam, actionsPerformed: [] };
    }
    config.skillDiscovery.artifactPlan.cost = cost;
  }
  throw usageError('Skill governance cost calculation did not stabilize.');
}

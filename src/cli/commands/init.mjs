import path from 'node:path';
import { deriveArchitectureDecision } from '../../architecture-policy.mjs';
import { initializationForArchitectureOption, resolveArchitectureApproval } from '../../architecture-assessment.mjs';
import { runAssist, assistCandidates } from '../../assist.mjs';
import { checkProject, printCheck } from '../../checker.mjs';
import { buildArtifacts, defaultConfig, prepareSkillGovernancePlan, validateConfig } from '../../generator.mjs';
import { buildApprovedProjectAgentTeam, proposeProjectAgentTeam, validateApprovedProjectAgentTeam } from '../../project-agent-team.mjs';
import { adaptiveDecisionEvidenceHash, decideSkillCandidates, discoverSkills, reconcileAdaptiveDecisions, serializeSkillDiscovery, validateAdaptiveDecisions } from '../../modules/skills/index.mjs';
import { isSafeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { chooseAssistAgent, confirmPlan, promptAdaptiveDecisions, promptConfig, promptGuidedConfig } from '../prompts.mjs';
import { adaptivePreviewGuidance, initSuccessGuidance, printHumanGuidance } from '../read-only-guidance.mjs';
import { buildDecisionLedger, classifyProject, resolveInitializationDecision } from '../../project-assessment.mjs';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from '../../execution-plan.mjs';
import { SUPPORTED_CONFIRMED_RISK_SIGNALS, TOOL_VERSION } from '../../constants.mjs';
import { scanProject } from '../../scanner.mjs';
import { readJson, readText } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { assertManagedArchitectureConfigTrusted, clientSupportFromClients, loadExistingConfig, mergeConfig, normalizeClientSupport, printScan } from '../shared.mjs';

const GOVERNANCE_WRITE_PREFIXES = ['.ai-governance/', 'docs/ai/', 'docs/memory/', '.cursor/', '.claude/', '.agents/'];
const GOVERNANCE_WRITE_FILES = new Set(['.gitignore', 'AGENTS.md', 'CLAUDE.md', 'reports/.gitkeep', 'reviews/.gitkeep']);

function requireConfiguredChoices(supplied) {
  for (const key of ['stacks', 'governanceDepth', 'artifactLanguage']) {
    if (supplied[key] === undefined) throw usageError(`--config must provide ${key} unless --yes is also used.`);
  }
}

function clientsFromOption(value) {
  if (value === 'all') return ['codex', 'claude-code', 'cursor'];
  const clients = [...new Set(String(value ?? '').split(',').map((item) => item.trim()).filter(Boolean))];
  if (clients.length === 0) throw usageError('--clients requires all or a comma-separated client list.');
  return clients;
}

function initIntent() {
  return { id: 'governance.initialize', handler: 'init', mode: 'write' };
}

function sameInitialization(left, right) {
  return Boolean(
    left?.lifecycle
    && left.lifecycle === right?.lifecycle
    && (left.existingCodeStrategy ?? null) === (right?.existingCodeStrategy ?? null),
  );
}

function recordArchitectureDecisionGap(config) {
  if (config.initialization?.lifecycle !== 'greenfield') return config;
  const requiredDecisions = [...config.initialClassification.requiredDecisions];
  if (!requiredDecisions.some((decision) => decision.id === 'architecture-not-established')) {
    requiredDecisions.push({
      id: 'architecture-not-established',
      status: 'not-established',
      question: 'Architecture is not established until implementation evidence exists and the owner confirms a stable pattern.',
      options: [],
    });
  }
  return {
    ...config,
    initialClassification: { ...config.initialClassification, requiredDecisions },
  };
}

function assertInitializationWriteBoundary(plan) {
  const unexpected = plan.operations
    .map((operation) => operation.path)
    .filter((relative) => !GOVERNANCE_WRITE_FILES.has(relative) && !GOVERNANCE_WRITE_PREFIXES.some((prefix) => relative.startsWith(prefix)));
  if (unexpected.length > 0) {
    throw usageError(`Initialization plan attempted to modify a non-governance path: ${unexpected.sort((left, right) => left.localeCompare(right)).join(', ')}.`);
  }
}

function adaptiveChoices(items, choices = []) {
  if (!Array.isArray(choices) || choices.length > items.length || new Set(choices.map((entry) => entry.id)).size !== choices.length
    || choices.some((entry) => !items.some((item) => item.id === entry.id) || !['add', 'defer', 'reject'].includes(entry.action)
      || Object.keys(entry).some((key) => !['id', 'action'].includes(key)))) throw usageError('Adaptive decisions require unique known ids and add, defer or reject.');
  return choices;
}

function prepareAdaptiveGovernance(config, scan, request, rememberedConfig) {
  const baseConfig = config;
  const rememberedTeam = rememberedConfig?.agentTeam;
  if (config.agentTeam?.enabled) validateApprovedProjectAgentTeam(config.agentTeam);
  if (!request || typeof request !== 'object' || Array.isArray(request) || Buffer.byteLength(stableJson(request)) > 32768
    || Object.keys(request).some((key) => !['installedRoots', 'curatedCatalog', 'requiredCapabilities', 'projectTeam', 'domainCandidates', 'decisions', 'activation'].includes(key))
    || !Array.isArray(request.installedRoots)) throw usageError('adaptiveGovernance requires bounded metadata and explicit installedRoots.');
  const discoveryInput = { root: scan.root, installedRoots: request.installedRoots, curatedCatalog: request.curatedCatalog ?? [], requiredCapabilities: request.requiredCapabilities ?? [] };
  const discovery = serializeSkillDiscovery(discoverSkills(discoveryInput));
  const sourceSnapshot = stableJson(discovery);
  const projectMode = config.initialization.lifecycle === 'greenfield' ? 'greenfield' : 'brownfield';
  const team = proposeProjectAgentTeam({ ...(request.projectTeam ?? {
    evidence: [{ id: 'owner.required-capabilities', kind: 'user-confirmed-project' }], confirmedDomainNeeds: [],
    confirmedProjectFacts: [...new Set(request.requiredCapabilities ?? [])].slice(0, 5).map((id) => ({
      id, label: `${id} delivery`, capabilities: [id], evidenceIds: ['owner.required-capabilities'],
    })),
  }), projectMode });
  const domainCandidates = request.domainCandidates ?? [];
  if (!Array.isArray(domainCandidates) || domainCandidates.length > 16 || domainCandidates.some((entry) => !entry || typeof entry.id !== 'string' || typeof entry.label !== 'string'
    || entry.label.length > 512 || !Array.isArray(entry.evidenceIds) || entry.evidenceIds.some((id) => !request.projectTeam?.evidence?.some((item) => item.id === id)))) throw usageError('Domain candidates must cite existing evidence and remain unconfirmed.');
  if (request.decisions && Object.keys(request.decisions).some((key) => !['skills', 'roles'].includes(key))) throw usageError('Unknown adaptive decision kind.');
  const previous = config.adaptiveDecisions === undefined ? { schemaVersion: 1, skills: [], roles: [] } : validateAdaptiveDecisions(config.adaptiveDecisions);
  const decisions = {
    skills: reconcileAdaptiveDecisions(discovery.candidates, adaptiveChoices(discovery.candidates, request.decisions?.skills), previous.skills),
    roles: reconcileAdaptiveDecisions(team.roleProposals, adaptiveChoices(team.roleProposals, request.decisions?.roles), previous.roles),
  };
  const suppressed = (kind, item) => !request.decisions?.[kind]?.some((entry) => entry.id === item.id)
    && previous[kind].some((entry) => entry.id === item.id && entry.action === 'reject' && entry.evidenceHash === adaptiveDecisionEvidenceHash(item));
  const hiddenSkills = new Set(discovery.candidates.filter((item) => suppressed('skills', item)).map((item) => item.id));
  const hiddenRoles = new Set(team.roleProposals.filter((item) => suppressed('roles', item)).map((item) => item.id));
  const receipts = { schemaVersion: 1 };
  for (const kind of ['skills', 'roles']) receipts[kind] = [...previous[kind].filter((entry) => !decisions[kind].some((current) => current.id === entry.id)), ...decisions[kind]].sort((a, b) => a.id.localeCompare(b.id));
  if (receipts.skills.length || receipts.roles.length || config.adaptiveDecisions !== undefined) config = { ...config, adaptiveDecisions: validateAdaptiveDecisions(receipts) };
  const selectedSkills = decisions.skills.filter((entry) => entry.action === 'add').map((entry) => entry.id);
  const selectedRoles = decisions.roles.filter((entry) => entry.action === 'add').map((entry) => entry.id);
  let activation = request.activation ?? {};
  if (request.activation === undefined && rememberedTeam?.enabled && selectedRoles.length) {
    validateApprovedProjectAgentTeam(rememberedTeam);
    activation = Object.fromEntries(rememberedTeam.roleProposals.filter((role) => role.activation && selectedRoles.includes(role.id)
      && previous.roles.some((receipt) => receipt.id === role.id && receipt.action === 'add' && decisions.roles.some((current) => current.id === role.id && current.evidenceHash === receipt.evidenceHash))).map((role) => [role.id, role.activation]));
  }
  if (!activation || typeof activation !== 'object' || Array.isArray(activation) || Object.keys(activation).some((id) => !selectedRoles.includes(id))) throw usageError('Activation must refer to explicitly selected project roles.');
  for (const role of team.roleProposals.filter((entry) => selectedRoles.includes(entry.id))) {
    const mapping = activation[role.id];
    if (!mapping && !role.professionalBoundaries?.length) continue;
    if (!mapping || Object.keys(mapping).some((key) => !['signals', 'paths'].includes(key))
      || !Array.isArray(mapping.signals) || !mapping.signals.length || mapping.signals.length > 16
      || mapping.signals.some((signal) => !SUPPORTED_CONFIRMED_RISK_SIGNALS.includes(signal) || !config.confirmedRiskSignals.includes(signal))
      || !Array.isArray(mapping.paths) || !mapping.paths.length || mapping.paths.length > 32
      || mapping.paths.some((relative) => typeof relative !== 'string' || relative.length > 256 || !isSafeRelative(relative))) throw usageError('Professional activation requires explicit owner-confirmed signals and safe repository paths.');
  }
  if (config.artifactLanguage === 'zh-CN') {
    for (const candidate of discovery.candidates) candidate.reason = '离线元数据候选；实际加载与执行尚未验证。';
    const localize = (boundary) => ({ ...boundary, reason: '此 AI 角色仅提供辅助；最终专业判断必须由符合资格的真人审核。' });
    team.professionalBoundaries = team.professionalBoundaries.map(localize);
    team.roleProposals = team.roleProposals.map((role) => ({ ...role,
      ...(role.professionalBoundaries ? { professionalBoundaries: role.professionalBoundaries.map(localize) } : {}),
      ...(role.professionalBoundary ? { professionalBoundary: localize(role.professionalBoundary) } : {}),
    }));
  }
  const summary = {
    schemaVersion: 1, status: 'recommendation', skills: { ...discovery, candidates: discovery.candidates.filter((item) => !hiddenSkills.has(item.id)) }, team: { ...team, roleProposals: team.roleProposals.filter((item) => !hiddenRoles.has(item.id)) }, decisions,
    domainCandidates: domainCandidates.map((entry) => ({ ...entry, status: 'proposed-unconfirmed' })),
    professionalReviewGaps: team.professionalBoundaries,
    skillGaps: discoveryInput.requiredCapabilities.filter((capability) => !discovery.candidates.some((entry) => entry.capabilities.includes(capability))),
    permissionGaps: discovery.candidates.filter((entry) => selectedSkills.includes(entry.id)).map(({ id, permissions }) => ({ id, permissions, status: 'requires-separate-runtime-approval' })),
    actionsPerformed: [],
  };
  const hasSelection = selectedSkills.length > 0 || selectedRoles.length > 0;
  if (!hasSelection && (rememberedTeam?.enabled || rememberedConfig?.skillDiscovery?.enabled)) {
    validateApprovedProjectAgentTeam(rememberedTeam);
    summary.status = 'decision-refresh-required';
    summary.invalidatedDecisions = ['skills', 'roles'].flatMap((kind) => previous[kind].filter((receipt) => receipt.action === 'add').map((receipt) => ({
      kind, id: receipt.id, previousEvidenceHash: receipt.evidenceHash,
      currentEvidenceHash: decisions[kind].find((entry) => entry.id === receipt.id)?.evidenceHash ?? null,
      reason: 'previous-add-no-longer-selected-for-current-evidence',
    })));
    summary.existingGovernance = 'unchanged';
    summary.refreshRequired = config.artifactLanguage === 'zh-CN'
      ? '旧 add 授权不适用于当前候选。现有治理保持不变；重新选择并精确审批后才能原子刷新，当前预览不能授权写入。'
      : 'Previous add approval does not cover the current candidates. Existing governance stays unchanged; select again and exactly approve an atomic refresh. This blocked preview cannot authorize writes.';
    config = rememberedConfig;
  }
  if (config.governanceDepth !== 'minimal' && hasSelection) {
    const evidenceId = `approval.${sha256(stableJson({ discovery, team, decisions, activation }))}`;
    const recommended = decideSkillCandidates(discovery, { selectedIds: selectedSkills });
    config = { ...config,
      skillDiscovery: { enabled: true, decision: decideSkillCandidates(discovery, { selectedIds: selectedSkills, approvalPlanHash: recommended.planHash }) },
      agentTeam: buildApprovedProjectAgentTeam(team, { selectedIds: selectedRoles, approvalEvidenceId: evidenceId, activation }),
    };
    try {
      const approval = prepareSkillGovernancePlan(config, scan);
      config = { ...config, skillDiscovery: { ...approval.skillDiscovery, approvalPlanHash: approval.planHash }, agentTeam: approval.agentTeam };
    } catch (error) {
      if (!error.budgetCost) throw error;
      config = baseConfig;
      summary.status = 'budget-blocked';
      summary.budget = { proposedCost: error.budgetCost, maximumFiles: 26, maximumBytes: (config.governanceDepth === 'standard' ? 64 : 96) * 1024, maximumManagerTokens: 800 };
      summary.manualCleanup = {
        paths: scan.files.map((entry) => entry.relative).filter((relative) => ['docs/ai/bootstrap-prompt.md', 'reviews/.gitkeep', 'reports/.gitkeep', 'docs/ai/skills/business-constraints/SKILL.md', '.agents/skills/business-constraints/SKILL.md', '.claude/skills/business-constraints/SKILL.md'].includes(relative)),
        authorization: 'separate-explicit-approval-required', automaticDeletion: false,
        reason: config.artifactLanguage === 'zh-CN' ? '历史种子或漂移文件仍计入预算；先人工审查并另行批准清理，再重新预览。' : 'Retained seeds and drifted files still count toward the budget; review and separately authorize cleanup, then preview again.',
      };
    }
  }
  return { config, summary, assertSourcesFresh: () => {
    if (sourceSnapshot !== stableJson(serializeSkillDiscovery(discoverSkills(discoveryInput)))) throw usageError('Adaptive Skill sources changed; preview and approve a new exact plan.');
  } };
}

export async function prepareInit(target, options, { allowDefaults = false } = {}) {
  if (options.assist && options['no-assist']) throw usageError('--assist and --no-assist cannot be used together.');
  if (options.guided && options.yes) throw usageError('--guided is interactive and cannot be combined with --yes.');
  if (options.guided && options.config) throw usageError('--guided cannot be combined with --config; answer the guided choices instead.');
  const scan = scanProject(target, { probeEnvironment: false });
  const rawExisting = loadExistingConfig(scan.root);
  const existing = rawExisting ? normalizeClientSupport(rawExisting, { source: 'legacy-config' }) : null;
  assertManagedArchitectureConfigTrusted(scan.root, existing);
  let config = mergeConfig(defaultConfig(scan), existing ?? {});
  let codeDocumentationPolicyExplicit = existing?.codeDocumentationPolicy !== undefined;
  let decisionSource = existing?.initialization?.source ?? (existing?.initialization?.lifecycle ? 'existing-governance' : null);
  let prompted = false;
  if (options.config) {
    const supplied = readJson(path.resolve(options.config));
    if (Object.hasOwn(supplied, 'adaptiveDecisions') && (!existing?.adaptiveDecisions || stableJson(supplied.adaptiveDecisions) !== stableJson(existing.adaptiveDecisions))) throw usageError('adaptiveDecisions must come from the trusted managed config; submit new decisions through adaptiveGovernance and exact approval.');
    if (supplied.codeDocumentationPolicy !== undefined) codeDocumentationPolicyExplicit = true;
    if (!options.yes && !allowDefaults) requireConfiguredChoices(supplied);
    const { initialClassification: _ignoredClassification, architecture: _ignoredArchitecture, projectMode: _ignoredProjectMode, ...safeSupplied } = supplied;
    const normalizedSupplied = safeSupplied.clientSupport
      ? { ...safeSupplied, clients: safeSupplied.clientSupport.selectedClients }
      : Array.isArray(safeSupplied.clients) && safeSupplied.clients.length > 0
        ? normalizeClientSupport(safeSupplied, { source: 'config' })
        : safeSupplied;
    config = mergeConfig(config, normalizedSupplied);
    if (safeSupplied.initialization?.lifecycle !== undefined && !sameInitialization(existing?.initialization, safeSupplied.initialization)) {
      decisionSource = 'config';
    }
  }
  if (options.clients) {
    const clients = clientsFromOption(options.clients);
    config = { ...config, clients, clientSupport: clientSupportFromClients(clients, 'cli') };
  }
  if (options.guided) {
    if (allowDefaults) throw usageError('--guided is available only for the interactive init command.');
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Guided init requires a TTY. Run it in an interactive terminal, or use explicit --clients and --config values for automation.');
    config = await promptGuidedConfig(scan, config, {
      locale: options.locale,
      preserveDepth: Boolean(existing),
      preserveArtifactLanguage: Boolean(existing),
      preserveCodeDocumentationPolicy: codeDocumentationPolicyExplicit,
      preserveInvocation: Boolean(existing),
    });
    prompted = true;
    if (!sameInitialization(existing?.initialization, config.initialization)) decisionSource = 'interactive';
  } else if (!options.yes && !options.config && !allowDefaults) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Interactive init requires a TTY. Use --yes or --config <json>.');
    config = await promptConfig(scan, config, {
      locale: options.locale,
      preserveCodeDocumentationPolicy: codeDocumentationPolicyExplicit,
    });
    prompted = true;
    if (!sameInitialization(existing?.initialization, config.initialization)) decisionSource = 'interactive';
  }
  if (options.locale) config.interactionLanguage = options.locale;
  if (!config.clientSupport) {
    const locale = config.interactionLanguage === 'zh-CN' || options.locale === 'zh-CN';
    throw usageError(locale
      ? '必须显式选择客户端支持范围。使用 --clients all、--clients codex,cursor，或在 --config 中提供 clientSupport。'
      : 'Client support scope must be explicit. Use --clients all, --clients codex,cursor, or provide clientSupport in --config.');
  }
  config = { ...config, projectMode: scan.projectMode, projectName: scan.projectName, toolVersion: TOOL_VERSION, invocationMode: config.invocationMode ?? 'npm-exec-pinned' };
  if (options['no-assist']) config.features.aiAssist = false;
  if (options.assist) config.features.aiAssist = true;
  if (options.assist && !config.clients.includes(options.assist)) {
    throw usageError(`AI completion agent ${options.assist} was not selected in config.clients.`);
  }
  const currentAssessment = classifyProject(scan);
  try {
    if (config.architectureApproval) {
      const approval = resolveArchitectureApproval(scan, config.architectureApproval);
      const approvedInitialization = initializationForArchitectureOption(approval.optionId);
      if (config.initialization?.lifecycle && (
        config.initialization.lifecycle !== approvedInitialization.lifecycle
        || (config.initialization.existingCodeStrategy ?? null) !== approvedInitialization.existingCodeStrategy
      )) throw new Error('architectureApproval conflicts with initialization lifecycle or existing-code strategy.');
      config = { ...config, architectureApproval: approval, initialization: { ...approvedInitialization } };
      decisionSource = 'config';
    }
    config = {
      ...config,
      initialization: resolveInitializationDecision(scan, config, {
        source: decisionSource ?? (allowDefaults ? 'chat-plan' : options.yes ? 'yes-greenfield' : prompted ? 'interactive' : null),
        allowGreenfieldDefault: Boolean(options.yes || options.config || allowDefaults || prompted),
        allowRecordedGreenfield: Boolean(existing?.initialization?.lifecycle === 'greenfield' && sameInitialization(existing.initialization, config.initialization)),
      }),
    };
    config = recordArchitectureDecisionGap(config);
    config = {
      ...config,
      architecture: deriveArchitectureDecision(scan, config, existing?.architecture ?? null, { legacyGovernance: Boolean(existing && !existing.architecture) }),
    };
  } catch (error) {
    throw usageError(error.message);
  }
  if (!codeDocumentationPolicyExplicit) {
    config = {
      ...config,
      codeDocumentationPolicy: currentAssessment.codebase.lifecycle.value === 'existing' || config.initialization.lifecycle === 'existing'
        ? 'inherit-existing'
        : 'en',
    };
  }
  if (config.features.aiAssist && currentAssessment.codebase.lifecycle.value !== 'greenfield') {
    throw usageError('AI assist is unavailable when the repository has existing or ambiguous product evidence; deterministic initialization must not modify business code.');
  }
  let request = config.adaptiveGovernance;
  const explicitAdaptiveRequest = Object.hasOwn(config, 'adaptiveGovernance');
  if (explicitAdaptiveRequest && (!request || typeof request !== 'object' || Array.isArray(request))) throw usageError('adaptiveGovernance must be an object with explicit installedRoots.');
  delete config.adaptiveGovernance;
  if (!request && (options['dry-run'] || options.approve || prompted)) request = { installedRoots: [] };
  let adaptive;
  try {
    adaptive = request ? prepareAdaptiveGovernance(config, scan, request, existing) : null;
    if (prompted && adaptive) {
      request = { ...request, decisions: await promptAdaptiveDecisions(adaptive.summary, { locale: config.interactionLanguage }) };
      adaptive = prepareAdaptiveGovernance(config, scan, request, existing);
    }
  } catch (error) {
    throw error.code === 'AICG_USAGE' ? error : usageError(error.message);
  }
  if (adaptive) config = adaptive.config;
  validateConfig(config);
  if (adaptive?.summary.status === 'decision-refresh-required') {
    // A blocked preview never recompiles stale approvals or proposes governance mutations.
    const plan = planArtifacts(scan.root, []);
    plan.manifest = { ...plan.manifest, content: readText(path.join(scan.root, '.ai-governance/manifest.json')), changed: false };
    plan.adaptiveGovernance = adaptive.summary;
    plan.requireAdaptiveApproval = true;
    plan.contextCost = { status: 'not-recomputed-blocked', proposedIncrement: { files: 0, bytes: 0, managerTokens: 0 }, previouslyApprovedManagement: config.skillDiscovery?.artifactPlan?.cost ?? null };
    return { scan, config, plan, assertSourcesFresh: adaptive.assertSourcesFresh };
  }
  const artifacts = buildArtifacts(config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force, migrateLinks: options['migrate-links'] });
  if (adaptive) {
    plan.adaptiveGovernance = adaptive.summary;
    plan.requireAdaptiveApproval = true;
    const ordinary = artifacts.filter((item) => ['AGENTS.md', 'docs/ai/rules/00_always.mdc'].includes(item.path)).map((item) => item.content);
    const contextMap = artifacts.find((item) => item.path === 'docs/ai/context-map.yaml').content;
    const ordinaryMap = contextMap.slice(0, contextMap.indexOf('profiles:')) + 'profiles:\n' + (contextMap.match(/^  ordinary:[\s\S]*?(?=^  [a-z_]+:|$(?![\s\S]))/m)?.[0] ?? '');
    plan.contextCost = { ordinary: { files: 3, estimatedTokens: Math.ceil([...ordinary, ordinaryMap].join('\n').length / 4) }, management: config.skillDiscovery?.artifactPlan?.cost ?? { increment: { files: 0, bytes: 0, managerTokens: 0 } } };
  }
  assertInitializationWriteBoundary(plan);
  return { scan, config, plan, assertSourcesFresh: adaptive?.assertSourcesFresh };
}

export async function initCommand(target, options) {
  const { scan, config, plan, assertSourcesFresh } = await prepareInit(target, options);
  const needsApproval = Boolean(plan.requireAdaptiveApproval || options.requireApproval || config.skillDiscovery?.enabled || config.agentTeam?.enabled);
  // Plain legacy --yes initialization does not expose or consume an execution digest.
  const executionPlan = options['dry-run'] || options.approve || needsApproval
    ? buildExecutionPlan({ intent: options.sync ? { id: 'governance.sync', handler: 'sync', mode: 'write' } : initIntent(), scan, artifactPlan: plan, config })
    : null;
  if (options.approve && plan.adaptiveGovernance?.status === 'decision-refresh-required') throw usageError('Adaptive decisions require a fresh selection before exact approval; existing governance is unchanged.');
  if (!options.guided) printScan(scan);
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely initialize:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (!options.yes && !options['dry-run'] && !needsApproval) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Applying an initialization plan requires a TTY confirmation or --yes.');
    const ledger = buildDecisionLedger(scan, config);
    const boundary = ledger.decisions.find((decision) => decision.id === 'implementation-boundary')?.value ?? null;
    const confirmed = await confirmPlan(plan.operations, null, config.initialization, boundary);
    if (!confirmed) throw usageError('Initialization cancelled without writing files.');
  }
  if (options['dry-run'] || (needsApproval && !options.approve)) {
    const ledger = buildDecisionLedger(scan, config);
    console.log(JSON.stringify({
      dryRun: true,
      approvalRequired: needsApproval,
      guidance: adaptivePreviewGuidance(config.interactionLanguage),
      initialization: config.initialization,
      implementationBoundary: ledger.decisions.find((decision) => decision.id === 'implementation-boundary')?.value ?? null,
      files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })),
      linksToMigrate: plan.links.map((link) => path.relative(scan.root, link)),
      planHash: executionPlan.planHash,
      ...(plan.adaptiveGovernance ? { adaptiveGovernance: plan.adaptiveGovernance, contextCost: plan.contextCost } : {}),
      requiredPermissions: executionPlan.requiredPermissions,
      operations: executionPlan.operations,
    }, null, 2));
    return;
  }

  if (options.approve) {
    if (plan.adaptiveGovernance?.status === 'budget-blocked') throw usageError('Adaptive governance is budget-blocked; cleanup needs separate explicit authorization before a new preview.');
    if (options.approve !== executionPlan.planHash) throw usageError(`Approval does not match the current plan hash ${executionPlan.planHash}. Re-run init --dry-run and approve the displayed hash.`);
    // Freshness is checked once in the transaction's beforeApply callback, before any mutation.
  }

  const applied = applyArtifactPlan(scan.root, plan, {
    migrateLinks: options['migrate-links'],
    transactional: true,
    beforeApply: options.approve ? () => {
      assertPlanFresh(executionPlan);
      assertArtifactPlanMatches(executionPlan, scan.root, plan);
      assertSourcesFresh?.();
    } : undefined,
    verify: () => checkProject(scanProject(scan.root)),
  });
  if (!options.guided) console.log(`initialized=${scan.root} changed_files=${applied.changed.length}`);
  let result = applied.verification;
  if (!options.guided) printCheck(result, false);
  if (!result.ok) {
    const error = new Error('Initialization wrote files but post-generation validation failed.');
    error.exitCode = 1;
    throw error;
  }

  if (config.features.aiAssist && !options['no-assist']) {
    const candidates = assistCandidates(config);
    let agentId = options.assist ?? null;
    if (!agentId && process.stdin.isTTY && process.stdout.isTTY) agentId = await chooseAssistAgent(candidates);
    if (!agentId) {
      console.warn('WARN: AI completion remains unverified because no selected installed agent was chosen.');
    } else {
      const assist = runAssist(agentId, scan.root);
      console.log(`ai_assist=${assist.status} reason=${assist.reason}`);
      if (!assist.ok) console.log(`retry=${assist.retry}`);
      const refreshed = scanProject(scan.root);
      result = checkProject(refreshed);
      if (!options.guided) printCheck(result, false);
      if (!result.ok) process.exitCode = 1;
    }
  }
  if (options.guided) printHumanGuidance(initSuccessGuidance(config));
}

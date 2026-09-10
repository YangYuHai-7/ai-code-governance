import path from 'node:path';
import { deriveArchitectureDecision } from '../../architecture-policy.mjs';
import { initializationForArchitectureOption, resolveArchitectureApproval } from '../../architecture-assessment.mjs';
import { runAssist, assistCandidates } from '../../assist.mjs';
import { checkProject, printCheck } from '../../checker.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from '../../generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { chooseAssistAgent, confirmPlan, promptConfig, promptGuidedConfig } from '../prompts.mjs';
import { initSuccessGuidance, printHumanGuidance } from '../read-only-guidance.mjs';
import { buildDecisionLedger, classifyProject, resolveInitializationDecision } from '../../project-assessment.mjs';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from '../../execution-plan.mjs';
import { TOOL_VERSION } from '../../constants.mjs';
import { scanProject } from '../../scanner.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { assertManagedArchitectureConfigTrusted, clientSupportFromClients, loadExistingConfig, mergeConfig, normalizeClientSupport, printScan } from '../shared.mjs';

const GOVERNANCE_WRITE_PREFIXES = ['.ai-governance/', 'docs/ai/', 'docs/memory/', '.cursor/', '.claude/', '.agents/'];
const GOVERNANCE_WRITE_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);

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

function assertInitializationWriteBoundary(plan) {
  const unexpected = plan.operations
    .map((operation) => operation.path)
    .filter((relative) => !GOVERNANCE_WRITE_FILES.has(relative) && !GOVERNANCE_WRITE_PREFIXES.some((prefix) => relative.startsWith(prefix)));
  if (unexpected.length > 0) {
    throw usageError(`Initialization plan attempted to modify a non-governance path: ${unexpected.sort((left, right) => left.localeCompare(right)).join(', ')}.`);
  }
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
  let decisionSource = existing?.initialization?.source ?? (existing?.initialization?.lifecycle ? 'existing-governance' : null);
  let prompted = false;
  if (options.config) {
    const supplied = readJson(path.resolve(options.config));
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
      preserveInvocation: Boolean(existing),
    });
    prompted = true;
    if (!sameInitialization(existing?.initialization, config.initialization)) decisionSource = 'interactive';
  } else if (!options.yes && !options.config && !allowDefaults) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Interactive init requires a TTY. Use --yes or --config <json>.');
    config = await promptConfig(scan, config, { locale: options.locale });
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
    config = {
      ...config,
      architecture: deriveArchitectureDecision(scan, config, existing?.architecture ?? null, { legacyGovernance: Boolean(existing && !existing.architecture) }),
    };
  } catch (error) {
    throw usageError(error.message);
  }
  if (config.features.aiAssist && currentAssessment.codebase.lifecycle.value !== 'greenfield') {
    throw usageError('AI assist is unavailable when the repository has existing or ambiguous product evidence; deterministic initialization must not modify business code.');
  }
  validateConfig(config);
  const artifacts = buildArtifacts(config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force, migrateLinks: options['migrate-links'] });
  assertInitializationWriteBoundary(plan);
  return { scan, config, plan };
}

export async function initCommand(target, options) {
  const { scan, config, plan } = await prepareInit(target, options);
  const executionPlan = buildExecutionPlan({ intent: initIntent(), scan, artifactPlan: plan, config });
  if (!options.guided) printScan(scan);
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely initialize:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (!options.yes && !options['dry-run']) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Applying an initialization plan requires a TTY confirmation or --yes.');
    const ledger = buildDecisionLedger(scan, config);
    const boundary = ledger.decisions.find((decision) => decision.id === 'implementation-boundary')?.value ?? null;
    const confirmed = await confirmPlan(plan.operations, null, config.initialization, boundary);
    if (!confirmed) throw usageError('Initialization cancelled without writing files.');
  }
  if (options['dry-run']) {
    const ledger = buildDecisionLedger(scan, config);
    console.log(JSON.stringify({
      dryRun: true,
      initialization: config.initialization,
      implementationBoundary: ledger.decisions.find((decision) => decision.id === 'implementation-boundary')?.value ?? null,
      files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })),
      linksToMigrate: plan.links.map((link) => path.relative(scan.root, link)),
      planHash: executionPlan.planHash,
    }, null, 2));
    return;
  }

  if (options.approve) {
    if (options.approve !== executionPlan.planHash) throw usageError(`Approval does not match the current plan hash ${executionPlan.planHash}. Re-run init --dry-run and approve the displayed hash.`);
    assertPlanFresh(executionPlan);
    assertArtifactPlanMatches(executionPlan, scan.root, plan);
  }

  const applied = applyArtifactPlan(scan.root, plan, {
    migrateLinks: options['migrate-links'],
    transactional: true,
    beforeApply: options.approve ? () => {
      assertPlanFresh(executionPlan);
      assertArtifactPlanMatches(executionPlan, scan.root, plan);
    } : undefined,
    verify: () => checkProject(scanProject(scan.root)),
  });
  if (!options.guided) console.log(`initialized=${scan.root} changed_files=${applied.changed.length}`);
  let refreshed = scanProject(scan.root);
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
      refreshed = scanProject(scan.root);
      result = checkProject(refreshed);
      if (!options.guided) printCheck(result, false);
      if (!result.ok) process.exitCode = 1;
    }
  }
  if (options.guided) printHumanGuidance(initSuccessGuidance(config));
}

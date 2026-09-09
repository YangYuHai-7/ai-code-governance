import path from 'node:path';
import { deriveArchitectureDecision } from '../../architecture-policy.mjs';
import { runAssist, assistCandidates } from '../../assist.mjs';
import { checkProject, printCheck } from '../../checker.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from '../../generator.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { chooseAssistAgent, confirmPlan, promptConfig } from '../prompts.mjs';
import { buildDecisionLedger, classifyProject, resolveInitializationDecision } from '../../project-assessment.mjs';
import { scanProject } from '../../scanner.mjs';
import { readJson, usageError } from '../../utils.mjs';
import { assertManagedArchitectureConfigTrusted, loadExistingConfig, mergeConfig, printScan } from '../shared.mjs';

const GOVERNANCE_WRITE_PREFIXES = ['.ai-governance/', 'docs/ai/', 'docs/memory/', '.cursor/', '.claude/', '.agents/'];
const GOVERNANCE_WRITE_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);

function requireConfiguredChoices(supplied) {
  for (const key of ['clients', 'stacks', 'governanceDepth', 'artifactLanguage']) {
    if (supplied[key] === undefined) throw usageError(`--config must provide ${key} unless --yes is also used.`);
  }
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
  const scan = scanProject(target, { probeEnvironment: false });
  const existing = loadExistingConfig(scan.root);
  assertManagedArchitectureConfigTrusted(scan.root, existing);
  let config = mergeConfig(defaultConfig(scan), existing ?? {});
  let decisionSource = existing?.initialization?.source ?? (existing?.initialization?.lifecycle ? 'existing-governance' : null);
  let prompted = false;
  if (options.config) {
    const supplied = readJson(path.resolve(options.config));
    if (!options.yes && !allowDefaults) requireConfiguredChoices(supplied);
    const { initialClassification: _ignoredClassification, architecture: _ignoredArchitecture, projectMode: _ignoredProjectMode, ...safeSupplied } = supplied;
    config = mergeConfig(config, safeSupplied);
    if (safeSupplied.initialization?.lifecycle !== undefined && !sameInitialization(existing?.initialization, safeSupplied.initialization)) {
      decisionSource = 'config';
    }
  }
  if (!options.yes && !options.config && !allowDefaults) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Interactive init requires a TTY. Use --yes or --config <json>.');
    config = await promptConfig(scan, config);
    prompted = true;
    if (!sameInitialization(existing?.initialization, config.initialization)) decisionSource = 'interactive';
  }
  config = { ...config, projectMode: scan.projectMode, projectName: scan.projectName };
  if (options['no-assist']) config.features.aiAssist = false;
  if (options.assist) config.features.aiAssist = true;
  if (options.assist && !config.clients.includes(options.assist)) {
    throw usageError(`AI completion agent ${options.assist} was not selected in config.clients.`);
  }
  const currentAssessment = classifyProject(scan);
  try {
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
  printScan(scan);
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
    }, null, 2));
    return;
  }

  const applied = applyArtifactPlan(scan.root, plan, {
    migrateLinks: options['migrate-links'],
    transactional: true,
    verify: () => checkProject(scanProject(scan.root)),
  });
  console.log(`initialized=${scan.root} changed_files=${applied.changed.length}`);
  let refreshed = scanProject(scan.root);
  let result = applied.verification;
  printCheck(result, false);
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
      printCheck(result, false);
      if (!result.ok) process.exitCode = 1;
    }
  }
}

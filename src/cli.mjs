import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { parseArgs, HELP } from './args.mjs';
import { assessArchitecture } from './architecture-assessment.mjs';
import { deriveArchitectureDecision } from './architecture-policy.mjs';
import { runAssist, assistCandidates } from './assist.mjs';
import { capabilityHarvestSummary, prepareCapabilityHarvest, prepareCapabilityPromotion } from './capability-harvest.mjs';
import { checkProject, printCheck } from './checker.mjs';
import { assertCommitHookPlanFresh, inspectCommitHook, installCommitHook, prepareCommitHookInstall, runCompletion } from './commit-completion.mjs';
import { CONFIG_PATH, TOOL_VERSION } from './constants.mjs';
import { doctor, printDoctor } from './doctor.mjs';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from './execution-plan.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from './generator.mjs';
import { resolveIntent } from './intents.mjs';
import { applyArtifactPlan, loadManifest, planArtifacts } from './managed-files.mjs';
import { chooseAssistAgent, confirmPlan, promptConfig } from './prompts.mjs';
import { assessmentSummary, buildDecisionLedger, classifyProject, resolveInitializationDecision } from './project-assessment.mjs';
import { runReleaseAcceptance } from './release-acceptance.mjs';
import { scanProject, scanSummary } from './scanner.mjs';
import { technicalStandardsSummary } from './technical-standards.mjs';
import { readTeamContext, teamRecommendation } from './team-recommendation.mjs';
import { readJson, readText, sha256, usageError } from './utils.mjs';

function mergeConfig(base, supplied) {
  return {
    ...base,
    ...supplied,
    features: { ...base.features, ...(supplied.features ?? {}) },
  };
}

function loadExistingConfig(root) {
  try {
    return readJson(path.join(root, CONFIG_PATH));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw new Error(`Cannot read existing ${CONFIG_PATH}: ${error.message}`);
  }
}

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

const GOVERNANCE_WRITE_PREFIXES = ['.ai-governance/', 'docs/ai/', 'docs/memory/', '.cursor/', '.claude/', '.agents/'];
const GOVERNANCE_WRITE_FILES = new Set(['AGENTS.md', 'CLAUDE.md']);

function assertInitializationWriteBoundary(plan) {
  const unexpected = plan.operations
    .map((operation) => operation.path)
    .filter((relative) => !GOVERNANCE_WRITE_FILES.has(relative) && !GOVERNANCE_WRITE_PREFIXES.some((prefix) => relative.startsWith(prefix)));
  if (unexpected.length > 0) {
    throw usageError(`Initialization plan attempted to modify a non-governance path: ${unexpected.sort((left, right) => left.localeCompare(right)).join(', ')}.`);
  }
}

function printScan(scan) {
  console.log(JSON.stringify(scanSummary(scan), null, 2));
}

function configForStandards(scan) {
  const existing = loadExistingConfig(scan.root);
  return validateConfig(mergeConfig(defaultConfig(scan), existing ?? {}));
}

function assertManagedArchitectureConfigTrusted(root, config) {
  if (!config?.architecture) return;
  const manifest = loadManifest(root);
  const entry = manifest?.files?.find((candidate) => candidate?.path === CONFIG_PATH && candidate.ownership === 'full');
  const content = readText(path.join(root, CONFIG_PATH), '');
  if (!entry || !/^[a-f0-9]{64}$/.test(entry.sha256 ?? '') || sha256(content) !== entry.sha256) {
    throw usageError('The managed architecture configuration drifted from its recorded manifest. Refuse to reuse or rewrite its baseline; restore the known-good config before running aicg write commands.');
  }
}

function loadConfiguredGovernance(scan) {
  const existing = loadExistingConfig(scan.root);
  if (!existing) throw usageError('Capability harvest requires an initialized governance configuration. Run aicg init first.');
  const config = validateConfig(mergeConfig(defaultConfig(scan), existing));
  assertManagedArchitectureConfigTrusted(scan.root, config);
  return config;
}

function promotionInputFromOptions(options) {
  if (!options.id || !options.entrypoint || !options.verify) {
    throw usageError('Capability promotion requires --id, --entrypoint, and --verify.');
  }
  return {
    capabilityId: options.id,
    publicEntrypoints: [options.entrypoint],
    consumerPaths: options.consumer ? [options.consumer] : [],
    verificationCommand: options.verify,
  };
}

function promotionInputFromChatConfig(options) {
  if (!options.config) {
    throw usageError('Chat capability promotion requires --config with capabilityId, publicEntrypoints, and verificationCommand.');
  }
  const supplied = readJson(path.resolve(options.config));
  const input = supplied.capabilityPromotion ?? supplied;
  return {
    capabilityId: input.capabilityId,
    publicEntrypoints: input.publicEntrypoints,
    consumerPaths: input.consumerPaths ?? [],
    verificationCommand: input.verificationCommand,
  };
}

function completionInputFromChatConfig(options) {
  if (!options.config) return null;
  const supplied = readJson(path.resolve(options.config));
  const input = supplied.completion ?? supplied;
  if (input.verificationCommand === undefined) return null;
  if (typeof input.verificationCommand !== 'string' || !input.verificationCommand.trim()) {
    throw usageError('Chat completion config verificationCommand must be a non-empty discovered npm script command.');
  }
  return input.verificationCommand;
}

function releaseAcceptanceInputFromChatConfig(options) {
  if (!options.config) throw usageError('Chat release acceptance requires --config with releaseAcceptance.changeType and optional evidencePath.');
  const supplied = readJson(path.resolve(options.config));
  const input = supplied.releaseAcceptance ?? supplied;
  return {
    changeType: input.changeType,
    evidencePath: input.evidencePath ?? null,
    replayCommands: input.replayCommands === true,
    replayApproval: options.approve ?? null,
  };
}

function runPromotionVerification(scan, command) {
  const selected = scan.commands.find((candidate) => candidate.command === command);
  if (!selected || selected.source !== 'package.json' || !/^[A-Za-z0-9][A-Za-z0-9._:@/-]*$/.test(selected.name)) {
    throw usageError('Capability promotion currently executes only an exact, safely named npm script discovered from package.json.');
  }
  const executable = process.platform === 'win32' ? 'npm.cmd' : 'npm';
  const result = spawnSync(executable, ['run', selected.name], {
    cwd: scan.root,
    encoding: 'utf8',
    timeout: 300000,
    maxBuffer: 4 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`Capability promotion verification failed for ${command}; no governance files were written.`);
    error.exitCode = 1;
    throw error;
  }
  return { command, status: 'passed' };
}

async function prepareInit(target, options, { allowDefaults = false } = {}) {
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

async function initCommand(target, options) {
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

function printRequest(payload, json) {
  if (json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (payload.result?.mode === 'read-only-advice') {
    console.log(JSON.stringify(payload.result, null, 2));
    return;
  }
  console.log(`intent=${payload.intent.id} mode=${payload.intent.mode}`);
  if (payload.plan) {
    const operations = Array.isArray(payload.plan.operations) ? payload.plan.operations.filter((operation) => operation.action !== 'keep').length : null;
    console.log(`plan_hash=${payload.plan.planHash}${operations === null ? '' : ` operations=${operations}`}`);
  }
  if (typeof payload.result?.ok === 'boolean') console.log(`verification=${payload.result.ok ? 'pass' : 'fail'}`);
  if (payload.result?.replayPlan?.planHash) console.log(`replay_plan_hash=${payload.result.replayPlan.planHash}`);
}

async function requestCommand(target, options) {
  const intent = resolveIntent(options.text);
  if (intent.handler === 'team') {
    if (options.approve || options['dry-run']) throw usageError('Team recommendations are already read-only and do not accept --approve or --dry-run.');
    const root = path.resolve(target);
    const context = readTeamContext(root, options.config);
    const result = teamRecommendation(root, context);
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    return;
  }
  if (intent.handler === 'doctor') {
    const result = doctor(scanProject(target, { probeEnvironment: false }));
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (intent.handler === 'release-check') {
    if (options['dry-run']) throw usageError('Release acceptance previews command execution whenever replay approval is absent; --dry-run is unnecessary.');
    const input = releaseAcceptanceInputFromChatConfig(options);
    const result = runReleaseAcceptance(target, input);
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const scan = scanProject(target);
  if (intent.handler === 'check') {
    const result = checkProject(scan);
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (intent.handler === 'assess') {
    const result = assessmentSummary(scan);
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    return;
  }
  if (intent.handler === 'architecture') {
    const result = assessArchitecture(scan);
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    return;
  }
  if (intent.handler === 'standards') {
    const result = technicalStandardsSummary(scan, configForStandards(scan));
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    return;
  }
  if (intent.handler === 'complete') {
    if (options.approve || options['dry-run']) throw usageError('Manual completion validation is read-only and does not accept --approve or --dry-run. Use aicg complete --verify for an explicit project command.');
    const result = runCompletion(target, { verificationCommand: completionInputFromChatConfig(options) });
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (intent.handler === 'hook-status') {
    if (options.approve || options['dry-run'] || options.config) throw usageError('Git pre-commit status is read-only and does not accept --approve, --dry-run, or --config.');
    const result = inspectCommitHook(target);
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    return;
  }
  if (intent.handler === 'hook-install') {
    if (options.config) throw usageError('Installing a Git pre-commit hook does not accept --config. Inspect the generated plan and approve it directly.');
    const plan = prepareCommitHookInstall(target);
    const payload = { intent: { id: intent.id, mode: intent.mode }, plan };
    if (options['dry-run']) {
      printRequest({ ...payload, dryRun: true }, Boolean(options.json));
      return;
    }
    if (!options.approve) throw usageError('Installing a Git pre-commit hook from chat requires --approve <planHash> from a current dry-run plan.');
    if (options.approve !== plan.planHash) throw usageError(`Approval does not match the current plan hash ${plan.planHash}. Re-run dry-run and approve the displayed hash.`);
    assertCommitHookPlanFresh(plan);
    const installed = installCommitHook(plan);
    printRequest({ ...payload, installed }, Boolean(options.json));
    return;
  }

  let config;
  let promotion = null;
  let artifactPlan;
  if (intent.handler === 'init') {
    const prepared = await prepareInit(
      target,
      { ...options, assist: undefined, yes: false, force: false, 'migrate-links': false },
      { allowDefaults: true },
    );
    if (prepared.config.features.aiAssist) throw usageError('Chat requests do not invoke an AI agent. Use the explicit init command to request AI assist.');
    config = prepared.config;
    artifactPlan = prepared.plan;
  } else if (intent.handler === 'harvest') {
    config = prepareCapabilityHarvest(loadConfiguredGovernance(scan), scan).config;
    artifactPlan = planArtifacts(scan.root, buildArtifacts(config, scan));
  } else if (intent.handler === 'promote') {
    promotion = prepareCapabilityPromotion(loadConfiguredGovernance(scan), scan, promotionInputFromChatConfig(options));
    config = promotion.config;
    artifactPlan = planArtifacts(scan.root, buildArtifacts(config, scan));
  } else {
    config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
    assertManagedArchitectureConfigTrusted(scan.root, config);
    artifactPlan = planArtifacts(scan.root, buildArtifacts(config, scan));
  }
  const executionPlan = buildExecutionPlan({ intent, scan, artifactPlan, config });
  const payload = { intent: { id: intent.id, mode: intent.mode }, plan: executionPlan };
  if (artifactPlan.conflicts.length > 0) {
    printRequest(payload, Boolean(options.json));
    const error = new Error(`Cannot safely apply requested governance work:\n- ${artifactPlan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (options['dry-run']) {
    printRequest({ ...payload, promotion: promotion?.promotion, dryRun: true }, Boolean(options.json));
    return;
  }
  if (executionPlan.requiredPermissions.length > 0) {
    if (options.approve) {
      if (options.approve !== executionPlan.planHash) throw usageError(`Approval does not match the current plan hash ${executionPlan.planHash}. Re-run dry-run and approve the displayed hash.`);
    } else throw usageError('Applying a chat governance request requires --approve <planHash> from a current dry-run plan.');
  }
  assertPlanFresh(executionPlan);
  assertArtifactPlanMatches(executionPlan, scan.root, artifactPlan);
  const commandVerification = promotion ? runPromotionVerification(scan, promotion.promotion.verificationCommand) : null;
  const applied = applyArtifactPlan(scan.root, artifactPlan, {
    transactional: true,
    beforeApply: () => {
      assertPlanFresh(executionPlan);
      assertArtifactPlanMatches(executionPlan, scan.root, artifactPlan);
    },
    verify: () => checkProject(scanProject(scan.root)),
  });
  const result = applied.verification;
  printRequest({ ...payload, promotion: promotion?.promotion, commandVerification, applied: { changed: applied.changed }, result }, Boolean(options.json));
  if (!result.ok) process.exitCode = 1;
}

async function syncCommand(target, options) {
  const scan = scanProject(target);
  const config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
  assertManagedArchitectureConfigTrusted(scan.root, config);
  const artifacts = buildArtifacts(config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force, migrateLinks: options['migrate-links'] });
  const result = applyArtifactPlan(scan.root, plan, {
    dryRun: options['dry-run'],
    migrateLinks: options['migrate-links'],
    transactional: !options['dry-run'],
    verify: options['dry-run'] ? undefined : () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({ dryRun: Boolean(options['dry-run']), changed: result.changed }, null, 2));
  if (!options['dry-run']) {
    printCheck(result.verification, false);
    if (!result.verification.ok) process.exitCode = 1;
  }
}

async function harvestCommand(target, options) {
  const scan = scanProject(target);
  const prepared = prepareCapabilityHarvest(loadConfiguredGovernance(scan), scan);
  const artifacts = buildArtifacts(prepared.config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force });
  const preview = capabilityHarvestSummary(loadConfiguredGovernance(scan), scan);
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely harvest capabilities:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (options['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, harvest: preview, files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })) }, null, 2));
    return;
  }
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Applying a capability harvest requires --yes or a TTY confirmation.');
    const confirmed = await confirmPlan(plan.operations);
    if (!confirmed) throw usageError('Capability harvest cancelled without writing files.');
  }
  const applied = applyArtifactPlan(scan.root, plan, {
    transactional: true,
    verify: () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({ dryRun: false, harvest: preview, changed: applied.changed, verification: applied.verification }, null, 2));
  if (!applied.verification.ok) process.exitCode = 1;
}

async function promoteCommand(target, options) {
  const scan = scanProject(target);
  const promotion = prepareCapabilityPromotion(loadConfiguredGovernance(scan), scan, promotionInputFromOptions(options));
  const plan = planArtifacts(scan.root, buildArtifacts(promotion.config, scan));
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely promote capability:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (options['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, promotion: promotion.promotion, files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })) }, null, 2));
    return;
  }
  if (!options.yes) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Applying a capability promotion requires --yes or a TTY confirmation.');
    const confirmed = await confirmPlan(plan.operations);
    if (!confirmed) throw usageError('Capability promotion cancelled without running verification or writing files.');
  }
  const commandVerification = runPromotionVerification(scan, promotion.promotion.verificationCommand);
  const applied = applyArtifactPlan(scan.root, plan, {
    transactional: true,
    verify: () => checkProject(scanProject(scan.root)),
  });
  console.log(JSON.stringify({ dryRun: false, promotion: promotion.promotion, commandVerification, changed: applied.changed, verification: applied.verification }, null, 2));
  if (!applied.verification.ok) process.exitCode = 1;
}

function teamCommand(target, options) {
  const root = path.resolve(target);
  const context = readTeamContext(root, options.config);
  console.log(JSON.stringify(teamRecommendation(root, context), null, 2));
}

function printCompletion(result, json) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`completion_gate=${result.ok ? 'pass' : 'fail'} mode=${result.mode}`);
  if (result.stagedFiles.length > 0) console.log(`staged_files=${result.stagedFiles.join(',')}`);
  console.log(`governance=${result.governance.ok ? 'pass' : 'fail'} project_verification=${result.projectVerification.status}`);
  for (const warning of result.governance.warnings) console.warn(`WARN: ${warning}`);
  for (const error of result.governance.errors) console.error(`FAIL: ${error}`);
  for (const boundary of result.boundaries) console.log(`BOUNDARY: ${boundary}`);
  console.log(`GENERATION: ${result.generation.boundary}`);
}

function completeCommand(target, options) {
  const result = runCompletion(target, { fromGitHook: Boolean(options['from-git-hook']), verificationCommand: options.verify ?? null });
  printCompletion(result, Boolean(options.json));
  if (!result.ok) process.exitCode = 1;
}

function hookCommand(target, action, options) {
  if (action === 'status') {
    const inspected = inspectCommitHook(target);
    console.log(JSON.stringify({ target: inspected.targetRoot, hookPath: inspected.hookPath, status: inspected.hookStatus, marker: 'ai-code-governance:pre-commit-v1' }, null, 2));
    return;
  }
  const plan = prepareCommitHookInstall(target);
  if (!options.yes) throw usageError('Installing a Git pre-commit hook requires --yes. Run aicg hook status first to inspect the target hook path.');
  const installed = installCommitHook(plan);
  console.log(JSON.stringify({ planHash: plan.planHash, installed, verification: plan.verification, boundaries: plan.boundaries }, null, 2));
}

function releaseCheckCommand(target, options) {
  if (!options.type) throw usageError('release-check requires --type bugfix, feature, or major.');
  const result = runReleaseAcceptance(target, {
    changeType: options.type,
    evidencePath: options.evidence ?? null,
    replayCommands: Boolean(options.replay),
    replayApproval: options.approve ?? null,
  });
  console.log(JSON.stringify(result, null, 2));
  if (!result.ok) process.exitCode = 1;
}

export async function run(argv) {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) throw new Error(`Node.js 22 or newer is required; current version is ${process.versions.node}.`);
  const { command, action, target, options } = parseArgs(argv);
  if (command === 'help' || options.help) {
    console.log(HELP);
    return;
  }
  if (command === 'version') {
    console.log(TOOL_VERSION);
    return;
  }
  if (command === 'request') return requestCommand(target, options);
  if (command === 'init') return initCommand(target, options);
  if (command === 'team') return teamCommand(target, options);
  if (command === 'complete') return completeCommand(target, options);
  if (command === 'hook') return hookCommand(target, action, options);
  if (command === 'release-check') return releaseCheckCommand(target, options);
  if (command === 'doctor') {
    const result = doctor(scanProject(target, { probeEnvironment: false }));
    printDoctor(result, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  const scan = scanProject(target);
  if (command === 'assess') {
    const result = assessmentSummary(scan);
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'architecture') {
    console.log(JSON.stringify(assessArchitecture(scan), null, 2));
    return;
  }
  if (command === 'standards') {
    console.log(JSON.stringify(technicalStandardsSummary(scan, configForStandards(scan)), null, 2));
    return;
  }
  if (command === 'harvest') return harvestCommand(target, options);
  if (command === 'promote') return promoteCommand(target, options);
  if (command === 'check') {
    const result = checkProject(scan);
    printCheck(result, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'sync') return syncCommand(target, options);
}

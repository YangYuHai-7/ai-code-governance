import path from 'node:path';
import { parseArgs, HELP } from './args.mjs';
import { assessArchitecture } from './architecture-assessment.mjs';
import { runAssist, assistCandidates } from './assist.mjs';
import { checkProject, printCheck } from './checker.mjs';
import { CONFIG_PATH, TOOL_VERSION } from './constants.mjs';
import { doctor, printDoctor } from './doctor.mjs';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from './execution-plan.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from './generator.mjs';
import { resolveIntent } from './intents.mjs';
import { applyArtifactPlan, planArtifacts } from './managed-files.mjs';
import { chooseAssistAgent, confirmPlan, promptConfig } from './prompts.mjs';
import { assessmentSummary } from './project-assessment.mjs';
import { scanProject, scanSummary } from './scanner.mjs';
import { technicalStandardsSummary } from './technical-standards.mjs';
import { readJson, usageError } from './utils.mjs';

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

function printScan(scan) {
  console.log(JSON.stringify(scanSummary(scan), null, 2));
}

function configForStandards(scan) {
  const existing = loadExistingConfig(scan.root);
  return validateConfig(mergeConfig(defaultConfig(scan), existing ?? {}));
}

async function prepareInit(target, options, { allowDefaults = false } = {}) {
  if (options.assist && options['no-assist']) throw usageError('--assist and --no-assist cannot be used together.');
  const scan = scanProject(target);
  const existing = loadExistingConfig(scan.root);
  let config = mergeConfig(defaultConfig(scan), existing ?? {});
  if (options.config) {
    const supplied = readJson(path.resolve(options.config));
    if (!options.yes) requireConfiguredChoices(supplied);
    config = mergeConfig(config, supplied);
  }
  if (!options.yes && !options.config && !allowDefaults) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) throw usageError('Interactive init requires a TTY. Use --yes or --config <json>.');
    config = await promptConfig(scan, config);
  }
  if (options['no-assist']) config.features.aiAssist = false;
  if (options.assist) config.features.aiAssist = true;
  if (options.assist && !config.clients.includes(options.assist)) {
    throw usageError(`AI completion agent ${options.assist} was not selected in config.clients.`);
  }
  validateConfig(config);
  const artifacts = buildArtifacts(config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force, migrateLinks: options['migrate-links'] });
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
    const confirmed = await confirmPlan(plan.operations);
    if (!confirmed) throw usageError('Initialization cancelled without writing files.');
  }
  if (options['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })), linksToMigrate: plan.links.map((link) => path.relative(scan.root, link)) }, null, 2));
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
  console.log(`intent=${payload.intent.id} mode=${payload.intent.mode}`);
  if (payload.plan) console.log(`plan_hash=${payload.plan.planHash} operations=${payload.plan.operations.filter((operation) => operation.action !== 'keep').length}`);
  if (typeof payload.result?.ok === 'boolean') console.log(`verification=${payload.result.ok ? 'pass' : 'fail'}`);
}

async function requestCommand(target, options) {
  const intent = resolveIntent(options.text);
  const scan = scanProject(target);
  if (intent.handler === 'doctor') {
    const result = doctor(scan);
    printRequest({ intent: { id: intent.id, mode: intent.mode }, result }, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
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

  let config;
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
  } else {
    config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
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
    printRequest({ ...payload, dryRun: true }, Boolean(options.json));
    return;
  }
  if (executionPlan.requiredPermissions.length > 0) {
    if (options.approve) {
      if (options.approve !== executionPlan.planHash) throw usageError(`Approval does not match the current plan hash ${executionPlan.planHash}. Re-run dry-run and approve the displayed hash.`);
    } else throw usageError('Applying a chat governance request requires --approve <planHash> from a current dry-run plan.');
  }
  const applied = applyArtifactPlan(scan.root, artifactPlan, {
    transactional: true,
    beforeApply: () => {
      assertPlanFresh(executionPlan);
      assertArtifactPlanMatches(executionPlan, scan.root, artifactPlan);
    },
    verify: () => checkProject(scanProject(scan.root)),
  });
  const result = applied.verification;
  printRequest({ ...payload, applied: { changed: applied.changed }, result }, Boolean(options.json));
  if (!result.ok) process.exitCode = 1;
}

async function syncCommand(target, options) {
  const scan = scanProject(target);
  const config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
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

export async function run(argv) {
  const major = Number.parseInt(process.versions.node.split('.')[0], 10);
  if (major < 22) throw new Error(`Node.js 22 or newer is required; current version is ${process.versions.node}.`);
  const { command, target, options } = parseArgs(argv);
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
  const scan = scanProject(target);
  if (command === 'doctor') {
    const result = doctor(scan);
    printDoctor(result, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
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
  if (command === 'check') {
    const result = checkProject(scan);
    printCheck(result, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
    return;
  }
  if (command === 'sync') return syncCommand(target, options);
}

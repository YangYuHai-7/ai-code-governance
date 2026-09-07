import path from 'node:path';
import { parseArgs, HELP } from './args.mjs';
import { runAssist, assistCandidates } from './assist.mjs';
import { checkProject, printCheck } from './checker.mjs';
import { CONFIG_PATH, TOOL_VERSION } from './constants.mjs';
import { doctor, printDoctor } from './doctor.mjs';
import { buildArtifacts, defaultConfig, validateConfig } from './generator.mjs';
import { applyArtifactPlan, planArtifacts } from './managed-files.mjs';
import { chooseAssistAgent, confirmPlan, promptConfig } from './prompts.mjs';
import { scanProject, scanSummary } from './scanner.mjs';
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

async function initCommand(target, options) {
  if (options.assist && options['no-assist']) throw usageError('--assist and --no-assist cannot be used together.');
  const scan = scanProject(target);
  const existing = loadExistingConfig(scan.root);
  let config = mergeConfig(defaultConfig(scan), existing ?? {});
  if (options.config) {
    const supplied = readJson(path.resolve(options.config));
    if (!options.yes) requireConfiguredChoices(supplied);
    config = mergeConfig(config, supplied);
  }
  if (!options.yes && !options.config) {
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
  printScan(scan);
  if (plan.conflicts.length > 0) {
    const error = new Error(`Cannot safely initialize:\n- ${plan.conflicts.join('\n- ')}`);
    error.exitCode = 2;
    throw error;
  }
  if (!options.yes && !options.config && !options['dry-run']) {
    const confirmed = await confirmPlan(plan.operations);
    if (!confirmed) throw usageError('Initialization cancelled without writing files.');
  }
  if (options['dry-run']) {
    console.log(JSON.stringify({ dryRun: true, files: plan.operations.map(({ path: relative, changed }) => ({ path: relative, changed })), linksToMigrate: plan.links.map((link) => path.relative(scan.root, link)) }, null, 2));
    return;
  }

  const applied = applyArtifactPlan(scan.root, plan, { migrateLinks: options['migrate-links'] });
  console.log(`initialized=${scan.root} changed_files=${applied.changed.length}`);
  let refreshed = scanProject(scan.root);
  let result = checkProject(refreshed);
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

async function syncCommand(target, options) {
  const scan = scanProject(target);
  const config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
  const artifacts = buildArtifacts(config, scan);
  const plan = planArtifacts(scan.root, artifacts, { force: options.force, migrateLinks: options['migrate-links'] });
  const result = applyArtifactPlan(scan.root, plan, { dryRun: options['dry-run'], migrateLinks: options['migrate-links'] });
  console.log(JSON.stringify({ dryRun: Boolean(options['dry-run']), changed: result.changed }, null, 2));
  if (!options['dry-run']) {
    const checked = checkProject(scanProject(scan.root));
    printCheck(checked, false);
    if (!checked.ok) process.exitCode = 1;
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
  if (command === 'init') return initCommand(target, options);
  const scan = scanProject(target);
  if (command === 'doctor') {
    const result = doctor(scan);
    printDoctor(result, Boolean(options.json));
    if (!result.ok) process.exitCode = 1;
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

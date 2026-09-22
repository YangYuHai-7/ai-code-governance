import path from 'node:path';
import { createExclusiveFile, lstatSafe, readJson, readText, writeGateReport } from '../../adapters/filesystem/index.mjs';
import { defaultConfig } from '../../generator.mjs';
import { classifyProject } from '../../project-assessment.mjs';
import { scanProject } from '../../scanner.mjs';
import { isSafeRelative, normalizeRelative, stableJson } from '../../shared/index.mjs';
import { assertNoLinkAncestor } from '../../preconditions.mjs';
import { usageError } from '../../kernel/index.mjs';
import { clientSupportFromClients } from '../shared.mjs';
import { prepareInit } from './init.mjs';

const DEFAULT_OUTPUT = 'aicg.config.json';

export function safeOutput(root, relative) {
  if (typeof relative !== 'string' || !relative.endsWith('.json') || !isSafeRelative(relative)
    || normalizeRelative(relative) !== relative || relative.split('/').some((part) => part.toLowerCase() === '.git')) {
    throw usageError('--output must be a safe repository-relative JSON file outside .git.');
  }
  try { assertNoLinkAncestor(root, relative); }
  catch (error) { throw usageError(`Unsafe configuration output: ${error.message}`); }
  return path.join(root, relative);
}

function initializationTemplate(assessment) {
  if (assessment.codebase.lifecycle.value === 'existing') {
    return { lifecycle: 'existing', existingCodeStrategy: 'keep-existing' };
  }
  if (assessment.codebase.lifecycle.value === 'greenfield') return { lifecycle: 'greenfield' };
  return undefined;
}

export function buildTemplate(scan, locale) {
  const defaults = defaultConfig(scan);
  const assessment = classifyProject(scan);
  const clients = ['codex'];
  const initialization = initializationTemplate(assessment);
  return {
    schemaVersion: defaults.schemaVersion,
    clients,
    clientSupport: clientSupportFromClients(clients, 'config'),
    stacks: defaults.stacks,
    governanceDepth: defaults.governanceDepth,
    governanceFootprint: defaults.governanceFootprint,
    artifactLanguage: defaults.artifactLanguage,
    interactionLanguage: locale === 'zh-CN' ? 'zh-CN' : 'en',
    codeDocumentationPolicy: assessment.codebase.lifecycle.value === 'existing' ? 'inherit-existing' : 'en',
    testing: defaults.testing,
    supportedOs: defaults.supportedOs,
    features: defaults.features,
    domainConstraints: [],
    confirmedRiskSignals: [],
    ...(initialization ? { initialization } : {}),
  };
}

function print(payload, json) {
  if (json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log(`configuration=${payload.file ?? payload.config} status=${payload.status ?? (payload.valid ? 'valid' : 'invalid')}`);
    if (payload.next) console.log(`next=${payload.next}`);
    for (const error of payload.errors ?? []) console.warn(`WARN: ${error}`);
    if (payload.reportPath) console.log(`report=${payload.reportPath}`);
  }
}

function initConfiguration(root, options) {
  if (!options.yes) throw usageError('config init creates a file and requires --yes.');
  const relative = options.output ?? DEFAULT_OUTPUT;
  const absolute = safeOutput(root, relative);
  const scan = scanProject(root, { probeEnvironment: false });
  const assessment = classifyProject(scan);
  const content = stableJson(buildTemplate(scan, options.locale));
  const current = lstatSafe(absolute);
  if (current) {
    if (!current.isFile() || current.isSymbolicLink()) throw usageError(`Refuse to replace non-regular configuration output: ${relative}.`);
    if (readText(absolute) !== content) throw usageError(`Refuse to replace existing configuration with different content: ${relative}.`);
    return print({ status: 'unchanged', file: relative, lifecycle: assessment.codebase.lifecycle.value, requiredDecisions: assessment.requiredDecisions, next: `Review the file, then run aicg config validate . --config ${relative}.` }, options.json);
  }
  if (!createExclusiveFile(absolute, content)) {
    const raced = lstatSafe(absolute);
    if (!raced?.isFile() || raced.isSymbolicLink() || readText(absolute) !== content) throw usageError(`Refuse to replace concurrently created configuration: ${relative}.`);
    return print({ status: 'unchanged', file: relative, lifecycle: assessment.codebase.lifecycle.value, requiredDecisions: assessment.requiredDecisions, next: `Review the file, then run aicg config validate . --config ${relative}.` }, options.json);
  }
  return print({ status: 'created', file: relative, lifecycle: assessment.codebase.lifecycle.value, requiredDecisions: assessment.requiredDecisions, next: `Review the file, then run aicg config validate . --config ${relative}.` }, options.json);
}

async function validateConfiguration(root, options) {
  if (!options.config) throw usageError('config validate requires --config <json>.');
  let result;
  try {
    const supplied = readJson(path.resolve(options.config));
    const prepared = await prepareInit(root, { yes: true, 'dry-run': true, 'no-assist': true }, { suppliedConfig: supplied });
    result = {
      ok: true, valid: true, config: options.config,
      lifecycle: prepared.config.initialization.lifecycle,
      governanceDepth: prepared.config.governanceDepth,
      clients: prepared.config.clients,
      stacks: prepared.config.stacks,
      operationCount: prepared.plan.operations.length + (prepared.plan.manifest?.changed ? 1 : 0),
      requiresExactApproval: Boolean(prepared.plan.requireAdaptiveApproval || prepared.plan.requireTopologyApproval),
      next: `Preview with aicg init . --config ${options.config} --yes --dry-run.`,
    };
  } catch (error) {
    result = { ok: false, valid: false, config: options.config, errors: [error.message] };
  }
  const reportPath = writeGateReport(root, 'config', result);
  print({ ...result, reportPath, gateMode: options.enforce ? 'enforce' : 'report' }, options.json);
  if (options.enforce && !result.ok) process.exitCode = 1;
}

export async function configurationCommand(target, action, options) {
  const root = target === null ? null : path.resolve(target);
  if (action === 'init') return initConfiguration(root, options);
  if (action === 'validate') return validateConfiguration(root, options);
  if (action === 'open') {
    const { openConfigurationPage } = await import('./configuration-web.mjs');
    return openConfigurationPage(root, options);
  }
  if (action === 'launcher') {
    if (!options.yes) throw usageError('config launcher creates desktop files and requires --yes.');
    const { installConfigurationLauncher } = await import('../../adapters/filesystem/launcher.mjs');
    const result = installConfigurationLauncher({ directory: options.output });
    if (options.json) console.log(JSON.stringify(result));
    else console.log(`launcher=${result.path} status=${result.status}\nDrag a project folder onto this launcher to open its configuration page.`);
    return result;
  }
  throw usageError('config requires init, validate, open, or launcher.');
}

import path from 'node:path';
import { assessArchitecture } from '../../architecture-assessment.mjs';
import { prepareCapabilityHarvest, prepareCapabilityPromotion } from '../../capability-harvest.mjs';
import { checkProject } from '../../checker.mjs';
import { assertCommitHookPlanFresh, inspectCommitHook, installCommitHook, prepareCommitHookInstall, runCompletion } from '../../commit-completion.mjs';
import { CONFIG_PATH } from '../../constants.mjs';
import { doctor } from '../../doctor.mjs';
import { assertArtifactPlanMatches, assertPlanFresh, buildExecutionPlan } from '../../execution-plan.mjs';
import { buildArtifacts, validateConfig } from '../../generator.mjs';
import { resolveIntent } from '../../intents.mjs';
import { applyArtifactPlan, planArtifacts } from '../../managed-files.mjs';
import { assessmentSummary } from '../../project-assessment.mjs';
import { runReleaseAcceptance } from '../../release-acceptance.mjs';
import { scanProject } from '../../scanner.mjs';
import { technicalStandardsSummary } from '../../technical-standards.mjs';
import { readTeamContext, teamRecommendation } from '../../team-recommendation.mjs';
import { readJson, usageError } from '../../utils.mjs';
import { runPromotionVerification } from './capabilities.mjs';
import { prepareInit } from './init.mjs';
import { assertManagedArchitectureConfigTrusted, configForStandards, loadConfiguredGovernance } from '../shared.mjs';

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

export async function requestCommand(target, options) {
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

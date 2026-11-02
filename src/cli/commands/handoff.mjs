import path from 'node:path';
import { CONFIG_PATH } from '../../constants.mjs';
import { lstatSafe, readJson } from '../../adapters/filesystem/index.mjs';
import { defaultConfig, validateConfig } from '../../generator.mjs';
import { usageError } from '../../kernel/index.mjs';
import { buildGovernanceHandoff } from '../../modules/governance/handoff-prompt.mjs';
import { scanProject } from '../../scanner.mjs';
import { loadExistingConfig, mergeConfig, normalizeClientSupport } from '../shared.mjs';
import { planTask, classifyTaskTextIntent } from './task-plan.mjs';
import { buildTaskHandoff } from '../../modules/governance/task-handoff.mjs';
import { classifyTaskRoute } from '../../modules/governance/task-routing.mjs';
import { buildDeliveryCapabilityPlan } from '../../modules/governance/delivery-capabilities.mjs';

function configuredInput(root, options, allowMissing = false) {
  if (options.config) {
    const absolute = path.isAbsolute(options.config) ? options.config : path.join(root, options.config);
    return { raw: readJson(absolute), phase: absolute === path.join(root, CONFIG_PATH) ? 'applied' : 'configured', configPath: path.relative(root, absolute) || CONFIG_PATH };
  }
  const managed = loadExistingConfig(root);
  if (managed) return { raw: managed, phase: 'applied', configPath: CONFIG_PATH };
  const draft = path.join(root, 'aicg.config.json');
  if (!lstatSafe(draft)?.isFile()) {
    if (allowMissing) return null;
    throw usageError('Governance handoff requires an applied .ai-governance/config.json or a saved aicg.config.json. Complete the base configuration first.');
  }
  return { raw: readJson(draft), phase: 'configured', configPath: 'aicg.config.json' };
}

export function handoffCommand(target, options = {}) {
  const root = path.resolve(target);
  const scan = scanProject(root, { probeEnvironment: false });
  if (options.text !== undefined) {
    if (typeof options.text !== 'string' || !options.text.trim() || options.text.length > 4000) throw usageError('handoff --text requires a nonempty task of at most 4000 characters.');
    if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(options.scope ?? '')) throw usageError('Task handoff requires --scope with 1-64 uppercase letters, digits, underscores or dashes.');
    const paths = options.paths?.split(',').map((value) => value.trim()).filter(Boolean) ?? [];
    const input = configuredInput(scan.root, options, true);
    const config = input ? validateConfig(mergeConfig(defaultConfig(scan), normalizeClientSupport(input.raw))) : null;
    let bugfix = null;
    if (options.bugfix !== undefined) {
      try { bugfix = JSON.parse(options.bugfix); } catch { throw usageError('handoff --bugfix must be a JSON object of booleans.'); }
    }
    let task = input?.phase === 'applied' ? planTask(scan.root, { text: options.text, paths, taskKind: options['task-kind'] ?? 'feature', bugfix }) : null;
    // Explicit read-only questions need no bootstrap configuration. Ambiguity or changed
    // paths retain the normal setup boundary instead of silently downgrading business work.
    if (!task && !paths.length && classifyTaskTextIntent(options.text).classification === 'read-only') {
      const route = classifyTaskRoute({ mutation: 'none', scope: 'single-file', risk: 'low', clarity: 'clear' });
      task = { route, delivery: buildDeliveryCapabilityPlan({ route }) };
    }
    const result = buildTaskHandoff({ root: scan.root, config, phase: input?.phase, configPath: input?.configPath, task, text: options.text, scope: options.scope, paths, locale: options.locale,
      approvalEvidence: options['approval-evidence'], approve: options.approve });
    console.log(options.json ? JSON.stringify(result, null, 2) : result.prompt);
    return result;
  }
  const input = configuredInput(scan.root, options);
  const config = validateConfig(mergeConfig(defaultConfig(scan), normalizeClientSupport(input.raw)));
  const handoff = buildGovernanceHandoff({ root: scan.root, config, scan, phase: input.phase, configPath: input.configPath, locale: options.locale });
  if (options.json) console.log(JSON.stringify(handoff, null, 2));
  else console.log(`handoff_status=${handoff.status} framework_status=${handoff.frameworkStatus}\n${handoff.prompt}`);
  return handoff;
}

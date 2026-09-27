import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { exists, readJson, writeAtomicFile } from '../../adapters/filesystem/index.mjs';
import { planTask } from './task-plan.mjs';

// The ledger is footprint-aware: compact keeps it under .ai-governance/state/, a preserve
// tree keeps docs/ai/flow-state.json. `flow` edits the seed ledger exactly where it lives.
const LEDGER_CANDIDATES = ['.ai-governance/state/flow-state.json', 'docs/ai/flow-state.json'];

function existingLedger(root) {
  return LEDGER_CANDIDATES.map((relative) => path.join(root, relative)).find((absolute) => exists(absolute)) ?? null;
}

function readLedger(root) {
  const absolute = existingLedger(root);
  if (!absolute) throw usageError('No flow ledger found. Run aicg init or aicg sync first.');
  try {
    return { absolute, ledger: readJson(absolute) };
  } catch {
    throw usageError('The flow ledger is unreadable; regenerate it with aicg sync before continuing.');
  }
}

function summary(ledger) {
  return {
    phase: ledger.phase ?? null,
    route: ledger.route ?? null,
    requirement: ledger.requirement ?? null,
    plan: ledger.plan ?? null,
    report: ledger.report ?? null,
    openFindings: ledger.openFindings ?? [],
    blockedOnOwner: ledger.blockedOnOwner ?? [],
  };
}

export function flowCommand(target, action, options) {
  const root = path.resolve(target);
  if (action === 'status') {
    const result = summary(readLedger(root).ledger);
    if (options.json) { console.log(JSON.stringify(result, null, 2)); return result; }
    console.log(`flow_phase=${result.phase ?? 'unset'}`);
    console.log(`route_level=${result.route?.level ?? 'unset'} task=${result.route?.text ?? 'unset'}`);
    console.log(`requirement=${result.requirement?.path ?? 'unset'} plan=${result.plan?.path ?? 'unset'} report=${result.report?.path ?? 'unset'}`);
    return result;
  }
  if (action !== 'start') throw usageError('flow requires an action: start|status.');
  if (!options.text) throw usageError('flow start requires --text with the task description.');
  const paths = options.paths ? options.paths.split(',').map((value) => value.trim()).filter(Boolean) : [];
  const taskKind = options['task-kind'] ?? 'feature';
  const routed = planTask(root, { text: options.text, paths, taskKind });
  const { absolute, ledger } = readLedger(root);
  const route = {
    text: routed.task,
    level: routed.route.level,
    taskKind,
    recommendedRoles: routed.roles?.recommendedRoles ?? routed.roles?.roles ?? [],
    status: routed.status,
    startedAt: new Date().toISOString(),
  };
  // Starting a flow records the declared route and resets nothing an owner already bound:
  // requirement, design, plan and report stay untouched so a re-run cannot erase evidence.
  const next = { ...ledger, phase: 'requirements', route };
  writeAtomicFile(absolute, `${JSON.stringify(next, null, 2)}\n`);
  const result = {
    phase: next.phase,
    route,
    process: routed.process[routed.route.level],
    requiredDecisions: routed.route.level === 'L2' || routed.route.level === 'L3' ? ['requirements', 'plan', 'report'] : [],
    status: routed.status,
    boundary: 'flow start records the declared task route and required process. It writes no code, approves no plan, and does not satisfy any owner confirmation.',
  };
  if (options.json) { console.log(JSON.stringify(result, null, 2)); return result; }
  console.log(`flow_phase=${result.phase} route_level=${route.level} status=${result.status}`);
  console.log(`process=${result.process}`);
  console.log(`ledger=${path.relative(root, absolute)}`);
  return result;
}

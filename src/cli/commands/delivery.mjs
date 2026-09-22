import { usageError } from '../../kernel/index.mjs';
import { workUnitCommand } from './work-unit.mjs';
import { testCaseCommand } from './testing.mjs';
import { completeCommand, hookCommand, releaseCheckCommand } from './completion.mjs';

// The governed delivery loop is one agent-runtime namespace instead of five top-level
// commands, so the human-facing surface stays three entries wide while every original
// action keeps a stable, discoverable path. The old names remain as deprecated aliases.
export const DELIVERY_ACTIONS = Object.freeze({
  'work-unit': (target, subAction, options) => workUnitCommand(target, subAction, options),
  'test-case': (target, subAction, options) => testCaseCommand(target, subAction, options),
  complete: (target, _subAction, options) => completeCommand(target, options),
  hook: (target, subAction, options) => hookCommand(target, subAction, options),
  'release-check': (target, _subAction, options) => releaseCheckCommand(target, options),
});

export async function deliveryCommand(target, action, options, subAction = null) {
  const run = DELIVERY_ACTIONS[action];
  if (!run) throw usageError('delivery requires an action: work-unit, test-case, complete, hook, or release-check.');
  return run(target, subAction, options);
}

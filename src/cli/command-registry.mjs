import { TOOL_VERSION } from '../constants.mjs';
import { harvestCommand, promoteCommand } from './commands/capabilities.mjs';
import { completeCommand, hookCommand, releaseCheckCommand } from './commands/completion.mjs';
import { syncCommand } from './commands/governance.mjs';
import { initCommand } from './commands/init.mjs';
import { enrichCommand } from './commands/enrich.mjs';
import { evidenceCommand } from './commands/evidence.mjs';
import { architectureCommand, assessCommand, checkCommand, doctorCommand, standardsCommand, teamCommand } from './commands/read-only.mjs';
import { requestCommand } from './commands/request.mjs';
import { helpFor } from './help.mjs';

export const COMMAND_REGISTRY = Object.freeze({
  help: ({ options }) => console.log(helpFor(options.locale)),
  version: () => console.log(TOOL_VERSION),
  request: ({ target, options }) => requestCommand(target, options),
  init: ({ target, options }) => initCommand(target, options),
  enrich: ({ target, options }) => enrichCommand(target, options),
  evidence: ({ target, action, options }) => evidenceCommand(target, action, options),
  team: ({ target, options }) => teamCommand(target, options),
  complete: ({ target, options }) => completeCommand(target, options),
  hook: ({ target, action, options }) => hookCommand(target, action, options),
  'release-check': ({ target, options }) => releaseCheckCommand(target, options),
  doctor: ({ target, options }) => doctorCommand(target, options),
  assess: ({ target, options }) => assessCommand(target, options),
  architecture: ({ target, options }) => architectureCommand(target, options),
  standards: ({ target }) => standardsCommand(target),
  harvest: ({ target, options }) => harvestCommand(target, options),
  promote: ({ target, options }) => promoteCommand(target, options),
  check: ({ target, options }) => checkCommand(target, options),
  sync: ({ target, options }) => syncCommand(target, options),
});

export function dispatchCommand(parsed) {
  const command = parsed.options.help ? 'help' : parsed.command;
  return COMMAND_REGISTRY[command](parsed);
}

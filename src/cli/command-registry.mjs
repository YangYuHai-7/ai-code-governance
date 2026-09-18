import { TOOL_VERSION } from '../constants.mjs';
import { helpFor } from './help.mjs';

function handler(module, exportName, argumentKeys = ['target', 'options']) {
  return Object.freeze({ module, exportName, argumentKeys: Object.freeze(argumentKeys) });
}

// Declarative dispatch metadata is checked against every real module export in the fast suite.
export const COMMAND_HANDLERS = Object.freeze({
  request: handler('./commands/request.mjs', 'requestCommand'),
  init: handler('./commands/init.mjs', 'initCommand'),
  enrich: handler('./commands/enrich.mjs', 'enrichCommand'),
  evidence: handler('./commands/evidence.mjs', 'evidenceCommand', ['target', 'action', 'options']),
  team: handler('./commands/read-only.mjs', 'teamCommand'),
  complete: handler('./commands/completion.mjs', 'completeCommand'),
  'work-unit': handler('./commands/work-unit.mjs', 'workUnitCommand', ['target', 'action', 'options']),
  'test-case': handler('./commands/testing.mjs', 'testCaseCommand', ['target', 'action', 'options']),
  hook: handler('./commands/completion.mjs', 'hookCommand', ['target', 'action', 'options']),
  'release-check': handler('./commands/completion.mjs', 'releaseCheckCommand'),
  doctor: handler('./commands/read-only.mjs', 'doctorCommand'),
  assess: handler('./commands/read-only.mjs', 'assessCommand'),
  architecture: handler('./commands/read-only.mjs', 'architectureCommand'),
  standards: handler('./commands/read-only.mjs', 'standardsCommand', ['target']),
  harvest: handler('./commands/capabilities.mjs', 'harvestCommand'),
  promote: handler('./commands/capabilities.mjs', 'promoteCommand'),
  check: handler('./commands/read-only.mjs', 'checkCommand'),
  sync: handler('./commands/governance.mjs', 'syncCommand'),
});

export const COMMAND_REGISTRY = Object.freeze({
  help: ({ options }) => console.log(helpFor(options.locale)),
  version: () => console.log(TOOL_VERSION),
  ...Object.fromEntries(Object.entries(COMMAND_HANDLERS).map(([command, definition]) => [command, async (context) => {
    const module = await import(definition.module);
    return module[definition.exportName](...definition.argumentKeys.map((key) => context[key]));
  }])),
});

export function dispatchCommand(parsed) {
  const command = parsed.options.help ? 'help' : parsed.command;
  return COMMAND_REGISTRY[command](parsed);
}

import { TOOL_VERSION } from '../constants.mjs';
import { helpFor } from './help.mjs';

function handler(module, exportName, argumentKeys = ['target', 'options']) {
  return Object.freeze({ module, exportName, argumentKeys: Object.freeze(argumentKeys) });
}

// Declarative dispatch metadata is checked against every real module export in the fast suite.
//
// The user-facing surface is intentionally small: configuration (the recommended entry point,
// including `aicg config open`), one-shot apply (`init`), incremental alignment (`sync`),
// verification (`check`), task completion (`complete`), diagnostics (`doctor`), chat-driven
// governance (`request`), and task routing for the agent runtime (`route`). The retired
// commands below stay wired to their original implementations so older scripts keep working;
// their names are no longer printed in `aicg --help` or any user-facing copy, and each
// invocation emits one deprecation line on stderr (see RETIRED_COMMANDS) that names the
// surviving command the operator should use instead.
export const COMMAND_HANDLERS = Object.freeze({
  request: handler('./commands/request.mjs', 'requestCommand'),
  route: handler('./commands/task-plan.mjs', 'taskPlanCommand'),
  init: handler('./commands/init.mjs', 'initCommand'),
  config: handler('./commands/configuration.mjs', 'configurationCommand', ['target', 'action', 'options']),
  delivery: handler('./commands/delivery.mjs', 'deliveryCommand', ['target', 'action', 'options', 'subAction']),
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

// A retired command either has a real replacement on the surviving surface (`replacement`)
// or it does not. When it does not, the notice names the capability that left the command
// surface instead of pointing at `doctor`, because `doctor` only reports environment and
// repository diagnostics: it does not expose these assessments. Claiming otherwise would
// make the notice advertise a capability the surviving command does not actually have.
export const RETIRED_COMMANDS = Object.freeze({
  'work-unit': { replacement: 'aicg delivery work-unit' },
  'test-case': { replacement: 'aicg delivery test-case' },
  complete: { replacement: 'aicg delivery complete' },
  hook: { replacement: 'aicg delivery hook' },
  'release-check': { replacement: 'aicg delivery release-check' },
  request: { capability: 'one-line chat governance routing; use your coding agent with the AICG Skill' },
  enrich: { replacement: 'aicg config open <path>' },
  evidence: { replacement: 'aicg complete <path> --approval-evidence <file>' },
  assess: { capability: 'the repository assessment summary' },
  architecture: { capability: 'the architecture assessment' },
  standards: { capability: 'the technical-standards snapshot' },
  team: { capability: 'human-role team advice' },
  harvest: { capability: 'capability harvesting' },
  promote: { capability: 'capability promotion' },
});

export function deprecationNotice(command) {
  const retired = RETIRED_COMMANDS[command];
  if (!retired) return null;
  const head = `aicg: "${command}" is retired and is no longer listed in "aicg --help".`;
  if (retired.replacement) return `${head} Use ${retired.replacement} instead.`;
  return `${head} No surviving command exposes ${retired.capability}; "aicg doctor <path> --json" is the supported read-only diagnostics entry point.`;
}

export const COMMAND_REGISTRY = Object.freeze({
  help: ({ options }) => console.log(helpFor(options.locale)),
  version: () => console.log(TOOL_VERSION),
  ...Object.fromEntries(Object.entries(COMMAND_HANDLERS).map(([command, definition]) => [command, async (context) => {
    const notice = deprecationNotice(command);
    // stderr keeps stdout byte-for-byte parseable for `--json` consumers of retired commands.
    if (notice) process.stderr.write(`${notice}\n`);
    const module = await import(definition.module);
    return module[definition.exportName](...definition.argumentKeys.map((key) => context[key]));
  }])),
});

export function dispatchCommand(parsed) {
  const command = parsed.options.help ? 'help' : parsed.command;
  return COMMAND_REGISTRY[command](parsed);
}

import { usageError } from './utils.mjs';

const VALUE_FLAGS = new Set(['config', 'assist', 'text', 'approve', 'id', 'entrypoint', 'verify', 'consumer']);
const BOOLEAN_FLAGS = new Set(['yes', 'dry-run', 'force', 'json', 'no-assist', 'migrate-links', 'from-git-hook', 'help', 'version']);
const COMMAND_FLAGS = {
  init: new Set(['config', 'assist', 'yes', 'dry-run', 'force', 'no-assist', 'migrate-links', 'help']),
  check: new Set(['json', 'help']),
  sync: new Set(['dry-run', 'force', 'migrate-links', 'help']),
  doctor: new Set(['json', 'help']),
  assess: new Set(['json', 'help']),
  architecture: new Set(['json', 'help']),
  standards: new Set(['json', 'help']),
  team: new Set(['config', 'json', 'help']),
  harvest: new Set(['yes', 'dry-run', 'force', 'json', 'help']),
  promote: new Set(['id', 'entrypoint', 'verify', 'consumer', 'yes', 'dry-run', 'json', 'help']),
  complete: new Set(['verify', 'json', 'from-git-hook', 'help']),
  hook: new Set(['yes', 'json', 'help']),
  request: new Set(['text', 'config', 'approve', 'dry-run', 'json', 'help']),
  help: new Set(['help']),
};

export function parseArgs(argv) {
  const args = [...argv];
  if (args.length === 0) return { command: 'help', target: '.', options: {} };
  if (args[0] === '--help' || args[0] === '-h') return { command: 'help', target: '.', options: {} };
  if (args[0] === '--version' || args[0] === '-V') return { command: 'version', target: '.', options: {} };

  const command = args.shift();
  if (!['init', 'check', 'sync', 'doctor', 'assess', 'architecture', 'standards', 'team', 'harvest', 'promote', 'complete', 'hook', 'request', 'help'].includes(command)) {
    throw usageError(`Unknown command: ${command}`);
  }

  let action = null;
  if (command === 'hook') {
    action = args.shift() ?? null;
    if (!['install', 'status'].includes(action)) throw usageError('hook requires an action: install or status.');
  }

  let target = '.';
  let targetSet = false;
  const options = {};
  while (args.length > 0) {
    const token = args.shift();
    if (!token.startsWith('-')) {
      if (targetSet) throw usageError(`Unexpected positional argument: ${token}`);
      target = token;
      targetSet = true;
      continue;
    }
    const normalized = token.replace(/^--?/, '');
    const equals = normalized.indexOf('=');
    const name = equals === -1 ? normalized : normalized.slice(0, equals);
    const inlineValue = equals === -1 ? undefined : normalized.slice(equals + 1);
    if (!VALUE_FLAGS.has(name) && !BOOLEAN_FLAGS.has(name)) throw usageError(`Unknown option: ${token}`);
    if (VALUE_FLAGS.has(name)) {
      const value = inlineValue ?? args.shift();
      if (!value || value.startsWith('--')) throw usageError(`Option --${name} requires a value.`);
      options[name] = value;
    } else {
      if (inlineValue !== undefined) throw usageError(`Option --${name} does not accept a value.`);
      options[name] = true;
    }
  }
  for (const name of Object.keys(options)) {
    if (!COMMAND_FLAGS[command].has(name)) throw usageError(`Option --${name} is not valid for ${command}.`);
  }
  return action ? { command, action, target, options } : { command, target, options };
}

export const HELP = `AI Code Governance CLI

Usage:
  aicg init [path] [--config answers.json] [--yes] [--dry-run] [--no-assist]
                  [--assist codex|claude-code|cursor] [--migrate-links] [--force]
  aicg check [path] [--json]
  aicg sync [path] [--dry-run] [--force] [--migrate-links]
  aicg doctor [path] [--json]
  aicg assess [path] [--json]
  aicg architecture [path] [--json]
  aicg standards [path] [--json]
  aicg team [path] [--config team-context.json] [--json]
  aicg harvest [path] [--dry-run] [--yes] [--force] [--json]
  aicg promote [path] --id <capabilityId> --entrypoint <path> --verify <discovered-command> [--consumer <path>] [--dry-run] [--yes] [--json]
  aicg complete [path] [--verify <discovered-command>] [--json]
  aicg hook <install|status> [path] [--yes] [--json]
  aicg request [path] --text <exact-supported-request> [--config answers.json] [--dry-run] [--approve planHash] [--json]
  aicg --version

Commands:
  init    Inspect a repository and initialize tailored AI governance.
  check   Validate configuration, managed files, drift, and reachability.
  sync    Regenerate managed adapters from canonical governance sources.
  doctor  Inspect the local environment without changing the repository.
  assess  Classify the project and report its decision ledger without changing the repository.
  architecture  Assess source structure and present bounded migration choices without changing the repository.
  standards  Preview the selected technical-standard Skills and their audited source snapshot without changing the repository.
  team  Recommend human delivery and governance responsibility coverage without creating people, agents, tasks, or files.
  harvest  Detect reusable project capabilities and generate candidate Skills only after confirmation.
  promote  Run a discovered verification command and adopt one confirmed capability after confirmation.
  complete  Manually run the completion gate; a selected project verification command is explicit and never inferred.
  hook  Install or inspect the managed Git pre-commit completion gate. Installation requires --yes.
  request Route an exact Chinese or English governance request through a safe plan and verification workflow.
`;

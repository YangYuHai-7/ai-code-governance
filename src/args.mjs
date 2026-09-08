import { usageError } from './utils.mjs';

const VALUE_FLAGS = new Set(['config', 'assist', 'text', 'approve']);
const BOOLEAN_FLAGS = new Set(['yes', 'dry-run', 'force', 'json', 'no-assist', 'migrate-links', 'help', 'version']);
const COMMAND_FLAGS = {
  init: new Set(['config', 'assist', 'yes', 'dry-run', 'force', 'no-assist', 'migrate-links', 'help']),
  check: new Set(['json', 'help']),
  sync: new Set(['dry-run', 'force', 'migrate-links', 'help']),
  doctor: new Set(['json', 'help']),
  assess: new Set(['json', 'help']),
  request: new Set(['text', 'config', 'approve', 'dry-run', 'json', 'help']),
  help: new Set(['help']),
};

export function parseArgs(argv) {
  const args = [...argv];
  if (args.length === 0) return { command: 'help', target: '.', options: {} };
  if (args[0] === '--help' || args[0] === '-h') return { command: 'help', target: '.', options: {} };
  if (args[0] === '--version' || args[0] === '-V') return { command: 'version', target: '.', options: {} };

  const command = args.shift();
  if (!['init', 'check', 'sync', 'doctor', 'assess', 'request', 'help'].includes(command)) {
    throw usageError(`Unknown command: ${command}`);
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
  return { command, target, options };
}

export const HELP = `AI Code Governance CLI

Usage:
  aicg init [path] [--config answers.json] [--yes] [--dry-run] [--no-assist]
                  [--assist codex|claude-code|cursor] [--migrate-links] [--force]
  aicg check [path] [--json]
  aicg sync [path] [--dry-run] [--force] [--migrate-links]
  aicg doctor [path] [--json]
  aicg assess [path] [--json]
  aicg request [path] --text <exact-supported-request> [--config answers.json] [--dry-run] [--approve planHash] [--json]
  aicg --version

Commands:
  init    Inspect a repository and initialize tailored AI governance.
  check   Validate configuration, managed files, drift, and reachability.
  sync    Regenerate managed adapters from canonical governance sources.
  doctor  Inspect the local environment without changing the repository.
  assess  Classify the project and report its decision ledger without changing the repository.
  request Route an exact Chinese or English governance request through a safe plan and verification workflow.
`;

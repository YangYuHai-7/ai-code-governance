export const VALUE_FLAGS = new Set(['config', 'assist', 'text', 'approve', 'id', 'entrypoint', 'verify', 'consumer', 'type', 'evidence']);

export const BOOLEAN_FLAGS = new Set(['yes', 'dry-run', 'force', 'json', 'no-assist', 'migrate-links', 'from-git-hook', 'replay', 'help', 'version']);

export const COMMAND_FLAGS = Object.freeze({
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
  'release-check': new Set(['type', 'evidence', 'replay', 'approve', 'json', 'help']),
  request: new Set(['text', 'config', 'approve', 'dry-run', 'json', 'help']),
  help: new Set(['help']),
});

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMAND_FLAGS));

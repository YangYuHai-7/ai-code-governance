export const VALUE_FLAGS = new Set(['config', 'assist', 'text', 'approve', 'id', 'entrypoint', 'verify', 'consumer', 'type', 'evidence', 'clients', 'locale']);

export const BOOLEAN_FLAGS = new Set(['yes', 'dry-run', 'force', 'json', 'no-assist', 'migrate-links', 'from-git-hook', 'replay', 'help', 'version']);

export const COMMAND_FLAGS = Object.freeze({
  init: new Set(['config', 'assist', 'yes', 'dry-run', 'force', 'no-assist', 'migrate-links', 'approve', 'clients', 'locale', 'help']),
  check: new Set(['json', 'help']),
  sync: new Set(['dry-run', 'force', 'migrate-links', 'help']),
  doctor: new Set(['json', 'locale', 'help']),
  assess: new Set(['json', 'locale', 'help']),
  architecture: new Set(['json', 'locale', 'help']),
  enrich: new Set(['config', 'json', 'locale', 'help']),
  evidence: new Set(['config', 'yes', 'json', 'help']),
  standards: new Set(['json', 'help']),
  team: new Set(['config', 'json', 'help']),
  harvest: new Set(['yes', 'dry-run', 'force', 'json', 'help']),
  promote: new Set(['id', 'entrypoint', 'verify', 'consumer', 'yes', 'dry-run', 'json', 'help']),
  complete: new Set(['verify', 'json', 'from-git-hook', 'help']),
  hook: new Set(['yes', 'json', 'help']),
  'release-check': new Set(['type', 'evidence', 'replay', 'approve', 'json', 'help']),
  request: new Set(['text', 'config', 'approve', 'dry-run', 'json', 'clients', 'locale', 'help']),
  help: new Set(['locale', 'help']),
});

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMAND_FLAGS));

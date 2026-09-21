export const VALUE_FLAGS = new Set(['config', 'assist', 'text', 'paths', 'approve', 'id', 'entrypoint', 'verify', 'consumer', 'type', 'evidence', 'clients', 'locale', 'task-level', 'review-mode', 'approval-evidence', 'work-unit', 'scope', 'format', 'output', 'manifest', 'cases', 'priorities', 'tags', 'drivers', 'packet', 'results', 'ledger', 'report']);

export const BOOLEAN_FLAGS = new Set(['yes', 'dry-run', 'force', 'json', 'guided', 'family', 'no-family', 'no-assist', 'review', 'migrate-links', 'prune', 'from-git-hook', 'replay', 'no-open', 'auto-exit', 'enforce', 'help', 'version']);

// The retired commands stay in `COMMAND_FLAGS` for two reasons: (1) their existing flags
// must still parse, so dropping the spec silently breaks every old CI invocation; (2) the
// command registry above keeps them wired to their original implementations, which in turn
// print a deprecation line that points at the surviving replacement. New flags belong on
// the surviving commands, not on the retired ones.
export const COMMAND_FLAGS = Object.freeze({
  init: new Set(['config', 'assist', 'yes', 'dry-run', 'force', 'guided', 'family', 'no-family', 'no-assist', 'review', 'migrate-links', 'approve', 'clients', 'locale', 'help']),
  config: new Set(['config', 'output', 'yes', 'json', 'locale', 'no-open', 'auto-exit', 'enforce', 'help']),
  check: new Set(['json', 'enforce', 'help']),
  sync: new Set(['dry-run', 'force', 'migrate-links', 'prune', 'approve', 'config', 'help']),
  doctor: new Set(['json', 'locale', 'enforce', 'help']),
  assess: new Set(['json', 'locale', 'help']),
  architecture: new Set(['json', 'locale', 'help']),
  enrich: new Set(['config', 'json', 'locale', 'help']),
  evidence: new Set(['config', 'yes', 'json', 'help']),
  standards: new Set(['json', 'help']),
  team: new Set(['config', 'json', 'help']),
  harvest: new Set(['yes', 'dry-run', 'force', 'json', 'help']),
  promote: new Set(['id', 'entrypoint', 'verify', 'consumer', 'yes', 'dry-run', 'json', 'help']),
  complete: new Set(['verify', 'task-level', 'review-mode', 'approval-evidence', 'approve', 'json', 'from-git-hook', 'work-unit', 'enforce', 'help']),
  'work-unit': new Set(['work-unit', 'json', 'enforce', 'help']),
  'test-case': new Set(['scope', 'format', 'output', 'manifest', 'cases', 'priorities', 'tags', 'drivers', 'packet', 'results', 'ledger', 'report', 'yes', 'json', 'enforce', 'help']),
  hook: new Set(['yes', 'json', 'help']),
  'release-check': new Set(['type', 'evidence', 'replay', 'approve', 'json', 'enforce', 'help']),
  request: new Set(['text', 'config', 'approve', 'dry-run', 'json', 'clients', 'locale', 'enforce', 'help']),
  route: new Set(['text', 'paths', 'json', 'help']),
  help: new Set(['locale', 'help']),
});

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMAND_FLAGS));

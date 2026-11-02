export const VALUE_FLAGS = new Set(['config', 'assist', 'text', 'paths', 'approve', 'id', 'entrypoint', 'verify', 'consumer', 'type', 'evidence', 'clients', 'locale', 'task-level', 'review-mode', 'approval-evidence', 'work-unit', 'scope', 'format', 'output', 'manifest', 'cases', 'priorities', 'tags', 'drivers', 'packet', 'results', 'ledger', 'report', 'task-kind', 'bugfix', 'session', 'agent', 'profile', 'requirement', 'architecture', 'matrix', 'probes', 'pack']);

export const BOOLEAN_FLAGS = new Set(['yes', 'dry-run', 'force', 'json', 'guided', 'family', 'no-family', 'no-assist', 'review', 'migrate-links', 'adopt-foreign-governance', 'prune', 'from-git-hook', 'replay', 'no-open', 'auto-exit', 'enforce', 'regenerate', 'help', 'version', 'live-agent']);

// The retired commands stay in `COMMAND_FLAGS` for two reasons: (1) their existing flags
// must still parse, so dropping the spec silently breaks every old CI invocation; (2) the
// command registry above keeps them wired to their original implementations, which in turn
// print a deprecation line that points at the surviving replacement. New flags belong on
// the surviving commands, not on the retired ones.
export const COMMAND_FLAGS = Object.freeze({
  init: new Set(['config', 'assist', 'yes', 'dry-run', 'force', 'guided', 'family', 'no-family', 'no-assist', 'review', 'migrate-links', 'adopt-foreign-governance', 'approve', 'clients', 'locale', 'help']),
  handoff: new Set(['config', 'text', 'scope', 'paths', 'task-kind', 'bugfix', 'json', 'locale', 'approval-evidence', 'approve', 'help']),
  config: new Set(['config', 'output', 'yes', 'json', 'locale', 'no-open', 'auto-exit', 'enforce', 'help']),
  studio: new Set(['no-open', 'json', 'help']),
  delivery: new Set(['paths', 'task-kind', 'bugfix', 'work-unit', 'json', 'enforce', 'help', 'scope', 'format', 'output', 'manifest', 'cases', 'priorities', 'tags', 'drivers', 'packet', 'results', 'ledger', 'report', 'yes', 'verify', 'task-level', 'review-mode', 'approval-evidence', 'approve', 'from-git-hook', 'type', 'evidence', 'replay', 'session', 'agent', 'profile', 'requirement', 'text']),
  evaluation: new Set(['golden-path', 'held-out', 'pack', 'requirement', 'architecture', 'matrix', 'probes', 'agent', 'live-agent', 'output', 'json', 'help']),
  candidate: new Set(['review', 'observe', 'text', 'id', 'project', 'json', 'help']),
  review: new Set(['evidence', 'session', 'json', 'help']),
  check: new Set(['json', 'enforce', 'help']),
  sync: new Set(['dry-run', 'force', 'migrate-links', 'prune', 'approve', 'config', 'help']),
  doctor: new Set(['json', 'locale', 'enforce', 'help']),
  assess: new Set(['json', 'locale', 'help']),
  architecture: new Set(['json', 'locale', 'help']),
  enrich: new Set(['config', 'assist', 'regenerate', 'json', 'locale', 'enforce', 'help']),
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
  route: new Set(['text', 'paths', 'task-kind', 'bugfix', 'json', 'help']),
  flow: new Set(['text', 'paths', 'task-kind', 'json', 'help']),
  telemetry: new Set(['task-level', 'json', 'help']),
  help: new Set(['locale', 'help']),
});

export const COMMAND_NAMES = Object.freeze(Object.keys(COMMAND_FLAGS));

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
  aicg release-check [path] --type <bugfix|feature|major> [--evidence <repository-relative-json>] [--replay --approve planHash] [--json]
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
  release-check  Apply the risk-tiered acceptance policy; replay requires approval of the exact command plan hash.
  request Route an exact Chinese or English governance request through a safe plan and verification workflow.
`;

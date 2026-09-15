# AICG initializer contract

`aicg init [path]` compiles filesystem evidence and owner decisions into governance. Node.js 22+ is required. Deterministic generation works without a model, network, or Agent login. Optional AI assistance is a separate high-confidence greenfield phase; missing/unavailable Agents leave it unverified.

## Agent-first, artifact-language-second

Scan before asking. Read lifecycle/topology, manifests/lockfiles, stacks, scripts, existing governance/workflows, OS, and legacy links. This discovery does not run Git, Agent executables, or project commands; `doctor` reports executable availability separately.

The visible order is:

1. Supported Agents: Codex, Claude Code, Cursor, generic, or a combination. Codex is the interactive default. `--clients all` selects the three built-in clients; config may record a selected scope. Neither installed tools nor `--yes` decide scope.
2. Governance language: `artifactLanguage: en` is default/recommended; `zh-CN` explicitly generates Chinese governance prose. `--locale`/`interactionLanguage` controls interaction independently. Legacy `bilingual` configuration remains supported, without becoming the onboarding default. Schema keys, IDs, commands, and filenames stay English.
3. Lifecycle: confirm greenfield or existing. Existing source requires an explicit existing decision; ambiguous scaffolds need confirmation.
4. Stack: existing projects confirm/correct detected stacks and their evidence; greenfield selects target stacks. Unknown remains `generic-unknown`/unverified. Greenfield architecture is `not-established` until implementation and owner confirmation provide evidence.
5. Existing-code strategy: `keep-existing`, `new-code-standard`, or `staged-migration`; no strategy authorizes initialization to rewrite/move/format product code.
6. Depth/options: recommend Minimal or Standard from scan evidence and owner needs. Guided defaults to Minimal; advanced/config defaults retain Standard. Complete is an explicit choice. Guided memory/runtime/hooks/CI/external workflows/AI assist stay off; advanced prompts/config may explicitly select them.
7. Invocation and plan: choose a usable installation, inspect the write/keep/conflict/retention plan, then approve.

`codeDocumentationPolicy` defaults to `inherit-existing` for existing projects and `en` for greenfield. The AICG repository's documentation/comments remain English according to its instructions; selecting Chinese governance in a target project is a separate product decision.

## Commands and authority

| Command | Contract |
| --- | --- |
| `aicg init [path] --guided` | Scan, collect decisions, preview, generate, check |
| `aicg check [path] --json` | Read-only config, manifest, ownership/hash, link and structural route checks |
| `aicg sync [path]` | Refresh selected managed artifacts from canonical sources; zero-delete ordinary sync |
| `aicg doctor [path] --json` | Read-only environment/Agent availability diagnosis |
| `aicg assess [path] --json` | Lifecycle/topology, current evidence, decision gaps |
| `aicg architecture [path] --json` | Architecture advice and bounded policy evidence; does not migrate code |
| `aicg standards [path] --json` | Preview packaged technical source snapshots |
| `aicg complete [path] --task-level L2 --verify "npm run test" --json` | Compare Git minimum to declaration; run only the explicitly selected discovered npm script |
| `aicg harvest [path] --dry-run --json` | Read-only candidate discovery; does not claim verification ran |
| `aicg promote [path] --id <id> --entrypoint <path> --verify "npm run <script>" --yes` | Explicit candidate adoption with current implementation and successful command evidence |
| `aicg hook status [path]` | Read-only hook state |
| `aicg hook install [path] --yes` | Separately approved pre-commit installation; rejects foreign hooks |
| `aicg request [path] --text <alias>` | Exact registered intent routed to the same command kernel |

Exit codes: `0` success, `1` check/execution failure, `2` usage, missing input, cancellation, or safety conflict.

For `init`, `--config <json>` supplies reproducible decisions; without `--yes` its required inputs must be complete. With `--yes`, permitted defaults can fill missing values, but client scope and required lifecycle/existing-code decisions remain explicit. No TTY means writes require `--yes`, even with configuration. `--dry-run` writes nothing. `--no-assist` disables assistance; `--assist <agent>` selects only a supported/available Agent and is rejected for existing or ambiguous source evidence. `--force` only restores tool-owned content. `--migrate-links` explicitly permits removal of the link object at a known adapter boundary, never its target tree.

`request` matches exact registered aliases, not arbitrary shell or prose. Zero/multiple matches stop with exit 2. Writes require `--dry-run` plan inspection and a matching `--approve <planHash>`; configuration is not approval. Read-only completion can select `verificationCommand` in config, and the project script's effects remain explicit. Release replay and hooks retain their separate permission boundaries.

## Daily invocation

Project-local mode is recommended only when a valid package/executable is found. Generated guidance uses `npm exec -- aicg ...` with that installation; global mode uses an installed `aicg`. Pinned bootstrap uses `npm exec --yes --package=ai-code-governance@<version> -- aicg ...` and can resolve a package. Bootstrap does not install a daily CLI: install locally/globally before corresponding daily use. Existing configured invocation modes remain compatible. This checkout can always use `node bin/aicg.js ...` directly.

## Presets and dynamic tasks

Minimal generates the kernel and chosen client adapters. Standard adds routing, policy/standard Skills, decision ledger, verification profiles, and local `reviews/`/`reports/` placeholders. Complete adds selected stack Skills; lifecycle features remain explicit. Evidence policies activate on first use and receipts only when produced. Generator and checker use the same artifact selection definitions.

Ordinary context is `AGENTS.md`, the selected context-map slice, and always rules. Behavior profiles conditionally add confirmed architecture, stack, and business material. Release policy belongs only to explicit release work. Historical twelve-layer documentation describes capabilities, not an unconditional flow.

- L0: read-only work, direct answer, zero governance subprocesses and no harvest.
- L1: local low-risk non-production change, targeted verification and one completion check; no formal plan approval.
- L2: product behavior/business/public contract/multi-module scope; requirements and plan approval, then behavior verification.
- L3: multiple surfaces, architecture/migration/external action or high-consequence risk; requirements, design, and plan approval, then integrated verification.

The classifier takes the maximum impact/risk evidence; clarity adds discovery instead of inventing scope. Current generic production-source diffs impose at least L2. `complete --task-level` cannot lower that minimum. Under-declaration blocks project verification; omission remains `unverified-declaration`. A route cannot silently downgrade after stronger evidence/approval. Release requires explicit intent plus separate replay approval.

Completion does not write governance state. Verified eligible source changes may return a candidate-only harvest summary bound to stable verification inputs; no automatic promotion occurs. Skipped changes need no candidate write. See [continuous skill evolution](continuous-skill-evolution.md).

The optional Git hook materializes only the exact index in a temporary checkout, runs structural completion, and never runs product scripts or writes Skill/memory/manifest state. It does not stage files. Ordinary Agent conversations do not trigger completion automatically.

## Ownership, retention, and pruning

`.ai-governance/config.json` records decisions; `.ai-governance/manifest.json` records versioned ownership/provenance and SHA-256. Human canonical seed files are maintained after initial creation, not reset to templates by `sync --force`. Shared entry blocks preserve all bytes outside stable markers. Unknown paths, damaged markers, and untrusted ownership fail closed.

Ordinary sync is zero-delete on upgrade/downgrade, retaining unused adapters, historical artifacts, seeds, drift, and evidence. For physical pruning:

```bash
aicg sync . --prune --dry-run
aicg sync . --prune --approve <planHash>
```

Review every action, reason, protected path, and the exact planHash. Only trusted unchanged fully managed current/historical artifacts qualify. Unknown/seed/drifted/evidence content is retained. Plan approval binds current config/manifest, provenance, tree contents and permissions; a changed input invalidates it. `--force` or unrelated approval cannot bypass pruning. Apply/check failure restores prior files, metadata, links, and manifest transactionally.

Adapters are ordinary generated files or native imports: Claude Code's managed `CLAUDE.md` imports `@AGENTS.md`; selected client rules/Skills resolve to canonical sources. No symlink/junction adapter is created. Link migration requires explicit authorization; controlled rollback may restore the user's original link only.

## Architecture and local output

Existing-code baseline decisions persist through sync; later source growth does not change the recorded lifecycle. `new-code-standard` can govern new paths without retroactively rewriting baseline sources; `keep-existing` and `staged-migration` remain advisory. Unconfigured legacy architecture and unconfirmed monorepo package scopes remain gaps/advisory. Structural path checks do not prove dependency direction, cohesion, or successful architecture migration. A future greenfield layout policy is not evidence that the architecture already exists.

Routing-enabled presets create `reviews/.gitkeep` and `reports/.gitkeep` and merge a scoped local-output `.gitignore` block. Their working contents stay local; formal specs/ADRs and release evidence remain tracked. Minimal omits these placeholders. Sync never guesses which historical `docs/` files should move.

## Release and validation boundaries

`aicg release-check . --type <bugfix|feature|major> --evidence <repository-relative-json>` preflights current candidate, policy, risk, reviews, and receipts. `--replay --approve <planHash>` executes only the exact replay plan after every other prerequisite passes. Project overrides may tighten policy. Install/publish lifecycle scripts and implicit pre/post hooks are not admissible replay evidence. See [release acceptance](release-acceptance.md).

Report `stated`, `reachable`, `enforced`, and `verified` separately. `check` proves named structural assertions; successful project verification proves only that command. Real Agent loading needs an actual client session. A macOS run is not Windows/Linux evidence: each remains `not yet verified` for this candidate until its current run exists. Negative probes, paths with Unicode/spaces, LF/CRLF, drive/UNC fixtures and installed-package smoke extend machine coverage, not client certification.

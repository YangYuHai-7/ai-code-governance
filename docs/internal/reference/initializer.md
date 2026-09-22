# AICG initializer contract

`aicg init [path]` compiles filesystem evidence and owner decisions into governance. Node.js 22+ is required. Deterministic generation works without a model, network, or Agent login. Optional AI assistance supports high-confidence greenfield and existing repositories with a selected Agent; missing/unavailable Agents leave it unverified. Existing-repository assistance completes code-backed development docs, records business behavior in Memory, and proposes project Skills for approval. `aicg check --json` reports remaining `brownfield.gaps`.

## Agent-first, artifact-language-second

Scan before asking. Read lifecycle/topology, manifests/lockfiles, stacks, scripts, existing governance/workflows, OS, and legacy links. This discovery does not run Git, Agent executables, or project commands; `doctor` reports executable availability separately.

The visible order is:

1. Supported Agents: Codex, Claude Code, Cursor, generic, or a combination. Codex is the interactive default. `--clients all` selects the three built-in clients; config may record a selected scope. Neither installed tools nor `--yes` decide scope.
2. Governance language: `artifactLanguage: en` is default/recommended; `zh-CN` explicitly generates Chinese governance prose. `--locale`/`interactionLanguage` controls interaction independently. Legacy `bilingual` configuration remains supported, without becoming the onboarding default. Schema keys, IDs, commands, and filenames stay English.
3. Test-case output: choose `aicg-json-v2` (recommended) or `markdown-plus-json`, then choose a safe repository-relative case directory. Reports retain a separately configured directory and language.
4. Lifecycle: confirm greenfield or existing. Existing source requires an explicit existing decision; ambiguous scaffolds need confirmation.
5. Stack: existing projects confirm/correct detected stacks and their evidence; greenfield selects target stacks. Unknown remains `generic-unknown`/unverified. Greenfield architecture is `not-established` until implementation and owner confirmation provide evidence.
6. Existing-code strategy: `keep-existing`, `new-code-standard`, or `staged-migration`; no strategy authorizes initialization to rewrite/move/format product code.
7. Depth/options: recommend Minimal or Standard from scan evidence and owner needs. Guided defaults to Minimal; advanced/config defaults retain Standard. Complete is an explicit choice. Memory ownership/index foundations default on at all depths; no module semantics are invented. Runtime/hooks/CI/external workflows/AI assist stay off unless explicitly selected.
8. Invocation and plan: choose a usable installation, inspect the write/keep/conflict/retention plan, then approve.

`codeDocumentationPolicy` defaults to `inherit-existing` for existing projects and `en` for greenfield. The AICG repository's documentation/comments remain English according to its instructions; selecting Chinese governance in a target project is a separate product decision.

## Commands and authority

### Reusable configuration file

Use one editable JSON file when a project has too many choices for repeated interactive setup:

```bash
aicg config init . --output aicg.config.json --yes
aicg config validate . --config aicg.config.json --json
aicg config open
aicg config open /absolute/path/to/project
aicg config launcher --yes
aicg init . --config aicg.config.json --yes --dry-run
```

The generated file contains owner-editable initialization input, not the final managed `.ai-governance/config.json`. It uses conservative scan-backed defaults, selects only Codex initially, preserves existing code by default, and leaves ambiguous lifecycle decisions unresolved. Generation is create-only: identical retries converge to `unchanged`, while different existing content, links, unsafe paths, and `.git` destinations fail closed. Validation uses the same `prepareInit` path as initialization and writes a local JSON report. The local visual editor reads and writes this same contract, offers JSON import/export, and requires a fresh exact-plan preview before applying governance. Without a path, `aicg config open` shows a project picker with recent projects, an absolute-path field, and folder browsing; an explicit path opens that project directly. After directory selection, a complete high-confidence existing-project scan presents its evidence and recorded or scan-backed choices without requiring each field again. The owner can adjust those choices, or save the suggested configuration and preview in one action. Greenfield, ambiguous, and incomplete scans keep the full choices visible; ambiguous lifecycle requires an explicit selection. An existing managed configuration supplies recorded choices when no editable configuration file exists. Switching projects invalidates the previous preview. It binds to loopback and uses a per-session token and origin check. Interactive npm installation (project-local or global) attempts to open the picker automatically. `AICG_NO_AUTO_OPEN=1` disables the installation attempt.

The visual editor's exact-plan preview identifies existing governance paths that will be replaced. Confirmed application may replace only those selected generated or canonical seed paths; unrelated repository files, product code, links, and unsafe ancestors remain protected. This overwrite policy is specific to the visual editor and does not weaken CLI defaults. Declared but uninitialized repository-family members are skipped with a warning, without fetching or changing them; unreadable or incomplete initialized members still fail verification. During application the editor disables conflicting controls and shows a processing state. If post-apply verification fails, the response includes the concrete check errors and the transaction restores its preimages.

### Adaptive governance input

Use the existing `--config` JSON, alongside normal client, stack, lifecycle and depth decisions:

```json
{
  "clients": ["codex"],
  "stacks": ["generic-unknown"],
  "governanceDepth": "standard",
  "artifactLanguage": "en",
  "testing": {
    "schemaVersion": 1,
    "caseFormat": "aicg-json-v2",
    "caseRoot": "docs/ai/testing",
    "reportRoot": "reports/testing",
    "reportLanguage": "en",
    "humanPerspective": "ask"
  },
  "adaptiveGovernance": {
    "installedRoots": [],
    "curatedCatalog": [],
    "requiredCapabilities": [],
    "projectTeam": {
      "evidence": [{ "id": "owner.scope", "kind": "user-confirmed-project" }],
      "confirmedDomainNeeds": [],
      "roleNeeds": []
    },
    "decisions": { "skills": [], "roles": [] },
    "activation": {}
  }
}
```

`installedRoots` is mandatory and contains only explicitly supplied absolute directories. Offline discovery returns at most five metadata candidates, deduplicates capability owners, and preserves every `sourceStatus` diagnostic; unavailable/unsafe sources must not be described as simply "no matches". Curated records are offline snapshots, not a promise of current remote availability. No scripts, network discovery, installation or global/home traversal run.

`projectTeam` uses `proposeProjectAgentTeam`'s evidence-bound input contract: bounded role IDs, titles, capabilities, responsibilities, outOfScope, domainNeedIds, evidenceIds, skillIds and mustRemainIndependentFrom. It describes project AI agents, not human staffing or the AICG development team. Greenfield and brownfield produce the same schema; repository facts and optional `domainCandidates` remain unconfirmed and cannot substitute for `user-confirmed-domain` or `user-confirmed-project` evidence. Domain candidates require id, label and evidenceIds. Do not infer licensed roles from a restaurant website or from job titles.

Each decision is `{ "id": "<displayed-id>", "action": "add|defer|reject" }`; absent entries default to defer. Guided metadata inspection is not approval. For each selected professional role, `activation[roleId]` must explicitly provide nonempty `signals` from the owner-confirmed `confirmedRiskSignals` and safe repository-relative `paths`/globs. Titles and descriptions never define activation. Human-review qualification, jurisdiction, boundaries and approval references remain in the full-ownership roster.

Run `aicg init . --yes --config decisions.json --dry-run`, inspect all recommendations, diagnostics, professional gaps, file actions, context/permission costs and the single exact `planHash`, then repeat without `--dry-run` using `--approve <planHash>`. With adaptive inputs, omitting approval previews and writes nothing even with `--yes`. Existing governance uses `aicg sync . --config decisions.json` and then `aicg sync . --config decisions.json --approve <planHash>`; config-less ordinary sync retains its existing behavior. Config changes and prune are separate approvals. All candidate snapshots, including unselected indexed candidates, source diagnostics, decisions, explicit activation, files and costs are hash-bound; stale approval writes nothing.

Minimal emits zero management artifacts. Exact-approved Standard/Complete emits `docs/ai/skills/skill-discovery/SKILL.md`, `docs/ai/skills/team-orchestrator/SKILL.md`, `docs/ai/skill-index.json`, and `docs/ai/agent-team.json` through the existing transaction and post-apply checker. The approved projection omits bootstrap prompts and empty reports/reviews placeholders. If business constraints are selected, their machine registry remains and the team manager carries the business evidence workflow; no redundant business Skill/adapter is generated. Defaults without this approved selection remain unchanged. Ordinary context stays 3 files / 900 estimated tokens, two manager bodies stay within 800 tokens, and the Skill management increment itself stays within 30 files and 96 KiB Standard / 128 KiB Complete; the retained governance tree and manifest are budgeted by the approved governance depth instead, so an existing Complete repository can still adopt skills. `budget-blocked` explicitly lists retained cleanup candidates; seeds, drifted files and protected content require separate manual review and explicit cleanup authorization. Repeated prune never authorizes automatic seed deletion.

Generation uses English by default; explicit `artifactLanguage: "zh-CN"` localizes generated manager and professional-boundary prose without translating machine keys, IDs, qualifications or paths. Owner-supplied text remains owner evidence. Generated availability is not task activation, independent-review evidence, real-client loading, or professional certification.

| Command | Contract |
| --- | --- |
| `aicg config init|validate|open|launcher [path] ...` | Create or validate initialization input, open its local visual editor, or install an OS-native Desktop folder-drop launcher |
| `aicg init [path] --guided` | Scan, collect decisions, preview, generate, check |
| `aicg check [path] --json` | Read-only config, manifest, ownership/hash, link and structural route checks |
| `aicg sync [path]` | Refresh selected managed artifacts from canonical sources; zero-delete ordinary sync |
| `aicg doctor [path] --json` | Read-only environment/Agent availability diagnosis |
| `aicg assess [path] --json` | Lifecycle/topology, current evidence, decision gaps |
| `aicg architecture [path] --json` | Architecture advice and bounded policy evidence; does not migrate code |
| `aicg standards [path] --json` | Preview packaged technical source snapshots |
| `aicg test-case init|validate|select|record [path] ...` | Scaffold schema-v2 cases, emit minimal AI packets, and record evidence-bound idempotent sessions |
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

Minimal generates the kernel, memory ownership/index foundation, and chosen client adapters. Existing projects additionally receive one code-scan development baseline and README entrypoint per detected development unit. Standard adds routing, policy/standard Skills, the `brownfield-understanding` Skill for existing projects, decision ledger, verification profiles, and scoped local-output ignore rules. The professional-testing Skill uses configured schema-v2 cases, stable Case IDs, minimal execution packets, evidence hashing, an idempotent session ledger, `NOT_RUN` completion, and ledger-derived reports. Automated, AI-simulated-human, and real-user evidence remain separate. Fresh installs do not spend artifacts on empty `reviews/`/`reports/` placeholders; tools create actual local outputs on first use. Approved dynamic team and Skill metadata use the exact-plan transaction. Complete adds selected stack Skills; lifecycle features remain explicit. Evidence policies activate on first use and receipts only when produced. Generator and checker use the same artifact selection definitions.

Scanner dependency facts report `ecosystem`, `name`, `declaredVersion`, `resolvedVersion`, `sourcePath`, and `evidenceLevel: stated`. Supported literal npm, Maven, Gradle, Go, and Python declarations and local supported lockfiles are never installed or executed. Unresolved expressions remain declared, and ambiguous lock versions are not guessed. Root and nested worktree/cache directories are excluded from project facts. Agent executable availability remains `not-probed` until `doctor` performs its separate probe.

`adaptiveGovernance.projectTeam.confirmedProjectFacts` can derive role proposals from bounded `{ id, label, capabilities, evidenceIds }` facts citing `user-confirmed-project` evidence. Proposals remain unapproved and follow existing add/defer/reject decisions. No industry roster is inferred from business text. Task risks apply only through matching approved role activation paths/signals. Ordinary source features require a quick independent review; public contracts and broader scopes keep stronger review floors.

Task approval hashes also bind sorted, normalized receipt records and every referenced artifact digest, including Git-ignored references. Replacing referenced requirements, design, plans, or test cases requires a fresh preview and exact approval; updating the receipt's declared digest alone cannot reuse the old approval.

Quick review requires both `implementation` and `targeted-review` approval records. Each record supplies an operator-declared `participantId`, a safe artifact `reference`, and its `sha256`; the two participants, paths, and content digests must all differ. Both records are bound into the receipt hash. This enforces distinct declared evidence, while real participant identity remains unverified.

Structured dependency detection also recognizes Composer requirements, .NET SDK/package/framework references, Android and Java Gradle plugins, Swift framework declarations, CocoaPods, Pipfile packages, Flutter dependencies, and Qt `find_package` declarations. Python arrays are parsed with string/comment boundaries; extras and environment markers remain explicit facts. `go.sum` is checksum history and never proves a selected/resolved dependency version.

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

Seed, drifted, and protected files are retained and listed only as manual cleanup candidates; cleanup requires a separate human review, and repeated prune approvals never delete them automatically.

Adapters are ordinary generated files or native imports: Claude Code's managed `CLAUDE.md` imports `@AGENTS.md`; selected client rules/Skills resolve to canonical sources. No symlink/junction adapter is created. Link migration requires explicit authorization; controlled rollback may restore the user's original link only.

## Foreign governance adoption

A repository that already carries executable governance under AICG's canonical roots (`docs/ai/skills/**/SKILL.md` and the declared client Skill directories) but has no `.ai-governance/manifest.json` cannot be taken over silently. `prepareInit` detects those files before it builds a plan and stops with one actionable conflict that names them and offers exactly two choices:

- `aicg init . --config aicg.config.json --yes --adopt-foreign-governance` records the files under `config.externalGovernance` (`schemaVersion: 1`, `strategy: "adopt"`, `adopted: [...]`). Adopted paths join the checker's registered set, so `aicg check` and post-apply verification never report them as orphans again, and they are never overwritten: adoption drops any caller-supplied `replaceExisting` for the whole plan.
- Running without the flag cancels before any write; nothing is created, changed, or deleted.

Adoption also extends a pre-existing `docs/ai/context-map.yaml` instead of replacing it. When the existing file uses a single `profiles:` container but has none of AICG's required `base`/`ordinary`/`behavior_change`/`release` routing, the required layout is prepended and every owner-authored top-level key and profile is preserved. The decision is recorded in `.ai-governance/config.json`, so later non-interactive runs and the visual editor reuse it without a flag.

This is adoption, not migration: AICG does not rewrite foreign Skills, does not merge conflicting `ordinary`/`behavior_change`/`release` profiles it did not generate, and does not consolidate a foreign canonical root. The visual editor surfaces the same conflict and disables apply. Files under `docs/ai/` that are not executable governance (for example a foreign `docs/ai/agents/` tree) remain ordinary unmanaged-content warnings; they are reported but never block.

## Architecture and local output

Existing-code baseline decisions persist through sync; later source growth does not change the recorded lifecycle. `new-code-standard` can govern new paths without retroactively rewriting baseline sources; `keep-existing` and `staged-migration` remain advisory. Unconfigured legacy architecture and unconfirmed monorepo package scopes remain gaps/advisory. Structural path checks do not prove dependency direction, cohesion, or successful architecture migration. A generated greenfield layout policy is not evidence that the architecture already exists.

For a greenfield Standard/Complete plan with a selected known stack, the compiler now projects a stack-specific development design, module/plugin/shared directory entrypoints, architecture rules, and canonical plus selected-client adapter Skills. Multiple selected stacks receive separate `apps/<frontend-stack>` or `services/<backend-stack>` child roots and a cross-project contract policy. The index records `active-template`, `planned-template`, or `roadmap-template` coverage and unresolved stacks. These are design proposals; they do not create executable manifests or certify production readiness. The decision ledger separately records pending architecture adoption until owner approval and implementation evidence exist. Generic-unknown alone keeps the compact baseline.

For an existing Standard/Complete project, every discovered development unit receives a code-scan development baseline, local rule, local workflow Skill, selected-client adapter, and child `AGENTS.md` where applicable. The baseline and generated Skill are explicitly unverified until code and tests are reviewed. Business Memory remains evidence-bound, and project-specific Skill growth requires owner approval.

The visual editor applies only an exact previewed plan. It writes a local structural check report and a multi-dimensional score report; when AI assistance is selected, it requests a fresh read-only Codex review. If no verified review adapter is selected or the review fails, the report remains `pending-unverified`. A low score returns remediation actions for a newly previewed and approved plan; it does not silently rewrite user or product files. The `aicg route . --text <task> [--paths <paths>]` command provides read-only L0-L3 process and approved-role advice. Role advice never launches an Agent or substitutes for qualified human legal review. The project entrypoint requires user confirmation before governance application and before business-code implementation, then applicable tests and a result report.

Routing-enabled presets merge a scoped local-output `.gitignore` block. Fresh installs omit empty `reviews/.gitkeep` and `reports/.gitkeep` projections; actual local outputs create their directories on first use. Existing historical placeholders remain zero-delete and count toward cost. Working contents stay local; formal specs/ADRs and release evidence remain tracked. Sync never guesses which historical `docs/` files should move.

## Release and validation boundaries

### One vertical feature and one verification boundary

With approved adaptive management, the separate anti-patterns document and generic-unknown pack projections are lazy guidance. Existing core rules and the software-design-and-verification Skill retain their shared guidance; no capability is deleted. A matching first-use `governanceUsage` route or an existing canonical artifact selects these projections. Their materialization changes the exact artifact cost/approval. Existing files remain retained and counted; an upgrade that still exceeds the unchanged cap stays budget-blocked until separately authorized cleanup.

Use `aicg work-unit plan . --work-unit docs/ai/feature.json --json` for a bounded preview and `status` for structural validation. The document follows `assets/contracts/work-unit-schema.json`; it includes requirements/acceptance, required design, scope groups, risks/professional boundaries, selected approved project roles and missing recommendations, implementation plan, stable test cases, canonical Memory API/public-method coverage, QA applicability/additions/results, command evidence, memory impact and reference digests. A login feature keeps its page, registration/login/reset APIs, service, schema, migration, clients and tests in one document.

For L2/L3 production delivery, pass `--work-unit` to completion alongside the existing approval evidence/hash. Reference replacement, scope/requirements/test/command changes invalidate approval. Run the selected discovered npm script once with `--verify`; emit one `AICG_QA_RESULT {"schemaVersion":1,"workUnitId":"feature","caseId":"case-success","status":"passed"}` line per case after its actual check. Required cases must pass. Non-applicability is explicit and reasoned; unknown/duplicate/missing IDs and failed/blocked required results fail closed. Results bind the command output and unchanged inputs. Unsupported semantic coverage remains an unverified boundary; mapping a test file does not prove its assertions are sufficient.

Copy returned `workUnit.recordedEvidence` to `verification.evidence` and `recordedResults` to `qa.results` in the same work unit, then stage it and the exact approval references. Re-preview the staged approval and set `AICG_WORK_UNIT`, `AICG_TASK_LEVEL`, `AICG_REVIEW_MODE`, `AICG_APPROVAL_EVIDENCE` and `AICG_APPROVE`. The hook checks recorded evidence against current contents, command, immutable plan and exact case set without running a second command. Recorded provenance is operator-declared and structurally checked, not cryptographically authenticated. Plan hashes exclude runtime results/status; the evidence separately carries digests. Actual behavior changes still require synchronized canonical Memory; `no-memory-impact` only describes genuinely inapplicable scope and never suppresses stale owning-code errors. L0/L1, docs, test-only and formatting-only work do not acquire a feature workflow.

Production delivery detection does not depend on the Memory scanner's supported extensions: C, JSON configuration and unknown production formats still require a work unit on L2/L3. Unknown formatting is not assumed behavior-neutral. Verification fingerprints read bounded raw bytes, including binary assets; Memory and JSON readers remain UTF-8-only.

Scope-local scanner gaps (unsupported or dynamic syntax, missing facts or scan budgets) never mean an empty public surface. `plan` exposes `coverageGaps`. Supply a bounded `manualCoverage` inventory per affected source: `path`, raw-byte `sourceSha256`, `evidenceLevel: "operator-declared"`, `reason`, existing `referenceIds`, `noPublicSurface`, and `entries`. Current files bind current bytes. A truly missing path may instead bind the exact regular Git `HEAD` blob as tombstone evidence; permission, link, read, and identity failures are not deletion. A deletion or rename's old-path tombstone requires mapped required unit cases, while a rename's new path binds current bytes separately. Each entry is either `{kind:"public-method", symbol, testCaseIds}` or `{kind:"api", method, apiPath, testCaseIds}`; case IDs must name required unit tests. An explicit `noPublicSurface:true` requires empty entries, a reason and the same source/reference binding, and cannot waive deletion-impact tests. These inventories join the immutable approval plan, use source paths rather than a second canonical ID scheme, and do not certify static scan completeness. Stale sources/references, missing/duplicate mappings, or an incomplete repository scan block completion. Optional `testabilityGaps` records (`path`, `sourceSha256`, `reason`, `referenceIds`) always block while unresolved; they cannot waive coverage. Existing recognized canonical entities still require their canonical `coverage` mappings.

`aicg release-check . --type <bugfix|feature|major> --evidence <repository-relative-json>` preflights current candidate, policy, risk, reviews, and receipts. `--replay --approve <planHash>` executes only the exact replay plan after every other prerequisite passes. Project overrides may tighten policy. Install/publish lifecycle scripts and implicit pre/post hooks are not admissible replay evidence. See [release acceptance](release-acceptance.md).

Report `stated`, `reachable`, `enforced`, and `verified` separately. `check` proves named structural assertions; successful project verification proves only that command. Real Agent loading needs an actual client session. A macOS run is not Windows/Linux evidence: each remains `not yet verified` for this candidate until its current run exists. Negative probes, paths with Unicode/spaces, LF/CRLF, drive/UNC fixtures and installed-package smoke extend machine coverage, not client certification.

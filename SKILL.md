---
name: ai-code-governance
description: >-
  Initialize or extend repository governance for AI coding agents with the cross-platform aicg CLI: scan real projects, select supported Agents, choose governance language, route tasks by impact, and maintain canonical rules and verified capability candidates. Use for AI 编码治理框架, AI 代码治理框架, 代码治理框架, aicg init, or repository AGENTS.md/skills/gates governance requests. Do not use for product AI safety, model risk, privacy, or regulatory governance unless the request also concerns coding agents.
---

# AI Code Governance

Deliver one canonical rule source, the smallest relevant context route, and machine checks with honest evidence boundaries. Use the current CLI as the default implementation. When the user asks in natural language, operate the CLI for them: inspect the current project, ask only decisions they must own, preview the exact write plan, and apply it only after approval. Do not require the user to learn flags. Read [initializer.md](docs/internal/reference/initializer.md) before initializing or changing managed artifacts.

## Trigger and scope

For offline Skill discovery and project-AI team onboarding, collect `adaptiveGovernance` through the existing `--config` contract in [initializer.md](docs/internal/reference/initializer.md#adaptive-governance-input). Inspect full `sourceStatus`, bounded candidates, add/defer/reject decisions, explicit professional activation and human-review gaps, file actions, permissions, and costs. Nothing is preselected, installed, or activated by a recommendation. A single exact `--approve <planHash>` authorizes the reviewed transaction; `--yes` alone does not. Use `sync . --config decisions.json` for an existing project's preview. Minimal emits no management artifacts; approved Standard/Complete remains inside the existing 26-file, 64/96 KiB and 800-manager-token limits. A `budget-blocked` preview requires separately authorized cleanup; never delete historical seeds automatically. Default English and explicit `zh-CN` retain the same machine contracts. Real-client execution and qualified-human identity remain unverified.

Treat explicit governance phrases such as `AI 编码治理框架`, `代码治理框架`, `Agent 治理框架`, and `aicg init` as task intent. The bare phrase `治理框架` requires repository/coding-agent context. Product AI safety and regulatory questions are outside this Skill.

A vague request does not choose Complete. Scan first, then recommend Minimal or Standard from actual project evidence and owner needs. Respect an explicit preset, client choice, language, or already approved plan. The twelve-layer reference model is a capability catalog; it is not a required task sequence or a promise to generate all layers.

## Installation: Agent-first, artifact-language-second

1. Scan repository files before questions: lifecycle/topology, manifest/lockfiles, exact stacks, scripts, existing adapters, canonical rules, and selected workflow evidence. Filesystem discovery does not execute Git, Agents, or project scripts; `aicg doctor .` reports executable availability separately.
2. First visible decision: supported Agents. Offer Codex, Claude Code, Cursor, WorkBuddy, generic, or a combination. Each Agent's Skill directory comes from the Agent registry, so a client is added as a registry entry instead of a new generator branch. Current client and existing files do not decide support. Use `--clients all` only for an owner-selected built-in scope; `--yes` cannot supply it.
3. Second visible decision: `artifactLanguage: en` by default, or `zh-CN`. Interaction follows `--locale`/`interactionLanguage` independently. Explicit Chinese governance selection generates Chinese prose; English IDs, paths, commands, and keys remain stable. Legacy `bilingual` stays readable. This repository's own documentation/comments default to English under its instructions.
4. Third visible decision: choose `testing.caseFormat` (`aicg-json-v2` recommended or `markdown-plus-json`) and a safe repository-relative `testing.caseRoot`. Store report location/language separately.
5. Confirm lifecycle. Existing projects confirm or correct detected stacks; greenfield selects target stacks. Treat manifest-only or unknown product files as potentially ambiguous. Record greenfield architecture as `not-established`, with an evidence gap; do not invent a proven module pattern.
6. Existing projects choose `keep-existing`, `new-code-standard`, or `staged-migration`. Preserve current code. Modernization requires a separate plan. `codeDocumentationPolicy` defaults to `inherit-existing` for existing projects and `en` for greenfield.
7. Recommend the smallest justified preset. Guided onboarding defaults to Minimal; advanced/config defaults retain Standard. Memory ownership/index foundations default on at every depth and do not invent module facts. Task runtime, hooks, CI, external workflows, and AI assistance remain explicit choices.
8. Choose invocation, preview writes/keeps/conflicts/retained artifacts, and apply the user's authorization. Recommend project-local only with a usable package executable. Generated daily local invocation is `npm exec -- aicg check .` with that installation; daily global invocation needs an installed `aicg`. Pinned npm bootstrap can resolve a package and does not install the daily CLI.

```bash
aicg init . --guided
aicg config init . --output aicg.config.json --yes
aicg config validate . --config aicg.config.json --json
aicg config open
aicg init . --config aicg.config.json --yes --dry-run
aicg check .
aicg sync .
```

Page-first handoff: the owner may have already saved `aicg.config.json` from `aicg config open`. Reuse those decisions instead of asking again. Run `aicg init . --config aicg.config.json --yes --dry-run`, show the exact plan, apply only on approval, then complete the brownfield gaps (`aicg check . --json` -> `brownfield.gaps`). If the preview reports existing executable governance, stop and let the owner choose `--adopt-foreign-governance` (keep and register the files as user-owned) or cancel; never overwrite or delete foreign governance.

Configuration carries decisions. `config init` creates an editable, scan-backed `aicg.config.json` without overwriting different content; an identical retry is unchanged. `config validate` exercises the same effective plan preparation as `init` and writes a local report. `config open` starts a loopback-only visual editor for the same file, with explained choices, JSON upload/download, validation, save, exact-plan preview, and explicit apply. Without a path it opens a project picker with recent projects, an absolute-path field, and folder browsing; an explicit path opens that project directly. Interactive npm installation (project-local or global) attempts to open the picker. Noninteractive writes require `--yes`; request-based writes require the exact current `--approve <planHash>`. Reuse existing authorized decisions rather than asking them again. Optional AI assistance supports high-confidence greenfield and existing projects with a selected available Agent; failure leaves that phase unverified without rolling back valid deterministic initialization.

For an existing project, initialization generates `docs/ai/development/index.json`, one scan-backed development document and README entrypoint per detected development unit, plus the `brownfield-understanding` Skill at Standard/Complete depth. Run `aicg init ... --assist <selected-agent>` to have the selected Agent process each unit, record existing business behavior in `docs/memory/INDEX.json` and owning pages, complete code-backed development docs, and propose project Skills through approval. Inspect `aicg check --json` and its `brownfield.gaps`; a successful scan is only a baseline. Never convert filenames or an unexecuted command into behavioral fact.

## Runtime routing: L0, L1, L2, L3

For L2/L3 production delivery, keep one vertical feature work unit across UI, API, service, data and tests. Read the bounded [work-unit schema](assets/contracts/work-unit-schema.json) only on that route. Preview with `aicg work-unit plan . --work-unit <relative-json>` and validate with `status`; neither command launches Agents. Both write local JSON reports. Bind initial success/failure cases, QA abnormal/boundary/extreme/risk applicability, canonical Memory API/public-method unit-test coverage, exact references and memory impact to the existing approval hash. A missing testability mapping, required failed/blocked/missing result, stale input or unsynchronized behavior Memory is reported as incomplete. Missing approved roles remain recommendations; role IDs do not prove participation.

Execute one selected `complete --verify` command at the work-unit boundary, with per-case `AICG_QA_RESULT` markers. Store returned `workUnit.recordedEvidence` in `verification.evidence` and `recordedResults` in `qa.results` in that same document. Hook `AICG_WORK_UNIT` points to its staged path; the hook checks stored evidence against current inputs without rerunning tests. Replay is operator-declared structural evidence, never authenticated execution. The immutable plan excludes runtime results/status to avoid a circular hash; changing requirements, cases, scope or command invalidates approval. L0/L1 and docs/test/format-only paths stay lightweight. Do not turn endpoints or individual tests into separate tasks.

When implementation enters formal testing, use the generated `professional-testing` Skill and the configured case location. Initialize schema-v2 cases with `aicg test-case init`, validate them, select the smallest packet for the current cases, then record digest-bound results. Stable Case IDs, shared actor/environment/data context, coverage decisions, and browser/API/device/terminal/mixed drivers are required. PASS/FAIL needs an existing evidence file; recording hashes evidence, fills omitted cases as `NOT_RUN`, writes an idempotent session ledger, and renders the configured-language report. Automated, AI-simulated-human, and real-user results remain distinct.

| Level | Required flow |
| --- | --- |
| L0 | Read-only explanation/review/status: inspect minimum evidence and answer, zero governance subprocesses, no harvest |
| L1 | Local low-risk non-production/governance change: locate, clarify material ambiguity, edit, target verification, one completion check; no formal plan approval |
| L2 | Product behavior/business/public contract or multi-module scope: approve requirements and plan, implement, verify behavior |
| L3 | Multi-surface/architecture/migration/external action/high-consequence risk: approve requirements, design, and plan, then integrated implementation and verification |

Combine mutation, scope, risk, and clarity; do not infer impact from sentence length. Explore only missing material decisions. Stronger evidence raises the route and cannot be silently downgraded. A generic production-source diff conservatively requires L2; sensitive sources can require L3. An explicit release intent adds release checks; mention of release is not authorization.

Use the selected workflow's existing design/plan/task owner. Do not create a second plan, require subagents for every task, or turn all work into a full lifecycle. Approval needed for external actions is distinct from implementation approval.

```bash
aicg complete . --task-level L2 --verify "npm run test" --json
```

The command checks Git evidence against the declared level and writes `reports/aicg/latest-complete.json`. All AICG checks default to report-only and exit 0 even when findings fail; `--enforce` opts into exit 1. Under-declaration remains a failed finding. Missing declaration remains `unverified-declaration`. Omit `--verify` when no product script was requested; only a discovered safe npm script is accepted. Completion itself writes no Skill, manifest, registry, or memory beyond the local report; the explicitly selected project script can have effects. Installed pre-commit hooks check only an isolated staged snapshot, without product scripts or harvest writes.

## Canonical ownership and small context

Keep `docs/ai` as the canonical source and `.ai-governance/manifest.json` as ownership/hash evidence. Use native imports or generated ordinary files; never create symlink/junction adapters. Agent details belong to [agent-registry.json](assets/registries/agent-registry.json).

Minimal selects the kernel and memory foundation; Standard adds routing/policy and exact-approved adaptive team/Skill metadata; Complete adds selected stack Skills and conditional specialist routes. Lifecycle/integrations remain optional. Release/acceptance/surface policies activate on first use and results require actual evidence. Ordinary startup loads only `AGENTS.md`, the selected `context-map.yaml` slice, and `00_always.mdc`. Memory, architecture, business, standards, harvest, hooks, reports, and release material stay outside this closure. Resolve adapters to canonical paths and hashes before counting context.

Ordinary sync is zero-delete, even when a newer preset omits legacy artifacts. Keep seed, unknown, edited, drifted, historical, and dormant evidence content. Physical removal is a separate exact-plan action:

```bash
aicg sync . --prune --dry-run
aicg sync . --prune --approve <planHash>
```

Prune requires trusted, unchanged, fully managed current/historical relationships and current tree state. Any changed input invalidates approval. `--force` cannot bypass approval or adopt unknown files. Application/check failure must restore preimages transactionally.

## Evidence-based capability growth

Read [continuous-skill-evolution.md](docs/internal/reference/continuous-skill-evolution.md) for capability work. Verified eligible L2/L3 product changes may produce a candidate-only completion summary. Public implementation must change semantically and verification must bind unchanged input before/after the command. Prose, formatting, fixtures, temporary scripts, read-only work, and non-reusable changes skip harvesting. No automatic promotion occurs.

Capability harvesting has no surviving command: `aicg harvest` is retired and prints a deprecation notice. Candidate Skills and `docs/ai/capability-evolution.json` remain valid governance artifacts, but no supported command creates them. When judging candidates, prefer `update-existing`, then `extend-existing`, then `create-new`, otherwise `no-skill-with-reason`. Candidate does not mean adopted or enforced.

Capability promotion (`aicg promote`) is likewise retired with no surviving command. The adoption contract still governs any manually recorded adoption. It accepts a currently detected candidate, current implementation entrypoint, and a discovered command that actually passes. Consumer paths remain declared/unverified; adoption does not establish real-client loading or bypass enforcement. Drift leaves a review item rather than silently upgrading an adopted Skill.

## Conditional specialist work

- **Technical standards:** read [stack-skill-generation.md](docs/internal/reference/stack-skill-generation.md) only for the requested/confirmed stack. The `aicg standards` command that previewed the packaged source snapshot is retired and prints a deprecation notice; no surviving command exposes that snapshot, so use the packaged reference documents as the source. Live official-source research is distinct from offline generation. Separate `industry-standard`, `project-decision`, `business-invariant`, and `unverified`. `stack-standard-source-coverage`, `stack-skill-coverage`, and `business-pattern-routing` are scoped evidence/probe obligations, not claims that every project enforces them.
- **Workflow integration:** read [workflow-integrations.md](docs/internal/reference/workflow-integrations.md), using [workflow-integration-registry.json](assets/registries/workflow-integration-registry.json). OpenSpec and explicitly selected project providers are optional. Preserve `change-authority-single-source`; claim `selective-execution-capability` only with actual runtime evidence.
- **Release:** read [release-acceptance.md](docs/internal/reference/release-acceptance.md) for explicit release work. Routine engineering publication proves the configured local suite, clean Git candidate, and npm package shape without claiming organizational certification. `aicg release-check` remains the explicit independent-review certification path, uses [release-acceptance-policy.json](assets/policies/release-acceptance-policy.json) on first use, and replay requires exact approval. No routine startup release or automatic publishing.
- **Team advice:** `aicg team` is retired and prints a deprecation notice; no surviving command emits human-role advice. [team-role-registry.json](assets/registries/team-role-registry.json) remains the reference for reading roles by hand. Any such advice stays read-only with explicit `teamScope: "human"` and business context; it does not create people, tasks, permissions, or messages.
- **Capability/platform coverage:** [capability-pack-registry.json](assets/registries/capability-pack-registry.json) distinguishes detection from certification for React, Vue, Angular, Node.js, Java, and later Android/iOS and other families. Scope macOS, Windows, and Linux evidence separately.

The evolution probe names `feature-skill-harvest-freshness`, `capability-promotion-evidence`, `skill-implementation-drift`, and `canonical-capability-reuse` identify separate obligations. Do not claim they are enforced in a target repository merely because these names exist.

## Verification and handoff

Use TDD for machine behavior; preserve unrelated work. Run focused checks after edits and full candidate checks when integrating:

```bash
npm run test:fast
npm run test:full
npm run validate
npm run smoke
npm run smoke:package
node scripts/prepublish-check.mjs
npm pack --dry-run
```

Report command exits/timings, exact artifact files/bytes, ordinary context closure, launched CLI process count and p95 samples. `test:full` includes `test:perf`; retain absolute caps even when comparing a relative baseline. Prepublish checking needs actual release evidence and approval; its refusal without them is not a reason to weaken it.

Separate `stated`, `reachable`, `enforced`, and `verified`. Structural tests prove file/routing contracts; negative probes prove only their named machine checks. Real-client loading and Linux/Windows execution remain `not yet verified` without current runs. Do not convert a macOS result or synthetic project into production readiness.

The [reference map](docs/internal/reference/README.md) links the principles, historical layers, optional memory/task runtime, cross-platform and specialist protocols. Load only what the chosen capability needs; historical capability descriptions do not override this adaptive runtime contract.

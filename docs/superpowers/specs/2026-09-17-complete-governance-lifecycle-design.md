# Complete Project Governance Lifecycle Design

## Status

- Approved by the owner on 2026-09-17.
- Scope: complete the missing project onboarding, memory, project-convention Skill, feature work-unit, dynamic-role, approval, QA, and completion capabilities without weakening the existing safety kernel.
- Delivery shape: three end-to-end functional units. Each unit receives one consolidated development cycle, one independent review, one verification pass, and one commit. Do not split endpoints, pages, SQL, or individual test cases into separate governance tasks.

## Product outcome

A user can initialize either a new or existing repository with `aicg`, choose supported coding Agents and governance language, receive a project-specific governance package, and then use the selected Agent to deliver features through a workflow proportional to impact. Existing projects gain evidence-linked current-state memory and project-convention Skills. Product work is modeled as a complete vertical feature unit, not as one task per endpoint. Completion binds approval, implementation, test evidence, QA status, and memory freshness.

## Non-negotiable boundaries

- Default artifact language is English; explicit `zh-CN` localizes generated prose while stable IDs, paths, commands, and schema keys remain English.
- macOS, Windows, and Linux are supported configuration targets. A current local macOS result does not claim current Windows or Linux runtime verification.
- Initialization never rewrites, moves, or formats business code.
- Memory is enabled by default, but no unsupported business semantics are invented. Deterministic repository facts are generated as `stated`; semantic summaries require Agent-authored evidence references and remain `unverified` until checked.
- Ordinary context remains bounded and lazy. Memory, architecture, release, team, business constraints, and QA evidence are loaded only when their route is active.
- Role recommendations are dynamic. There is no fixed catalog of lawyers, doctors, financial professionals, restaurant experts, or other industry roles.
- Domain-specialist AI roles can assist, but legal, medical, financial, food-safety, and equivalent high-consequence decisions retain a qualified-human final-review boundary.
- Skill discovery is local and offline by default. Recommendations never install, execute, activate, or fetch a Skill.
- Ordinary synchronization is zero-delete. Cleanup requires an exact separately approved prune plan.
- Release checks remain separate from daily development and never deploy, publish, push, or contact an external service without separate authorization.
- AICG does not claim that an Agent, reviewer, test, platform, or professional participated unless current evidence records that event.

## Six paired AICG delivery roles

The AICG product-development team uses six core responsibility pairs. This internal team must never be emitted as a target project's roster.

| Pair | A responsibility | B responsibility |
| --- | --- | --- |
| Product and business analysis | close requirements and user journey | challenge missing states and contradictions |
| Governance architecture | design adaptive flow and ownership | challenge over-design, latency, and duplication |
| Agent and Skill engineering | implement client adapters and task routing | audit Skill provenance, activation, and context cost |
| CLI and cross-platform engineering | implement deterministic CLI behavior | audit path, platform, transaction, and compatibility safety |
| QA and evaluation | design coverage and acceptance cases | execute evidence, performance, and negative probes |
| Independent audit and domain risk | review approval and manifest integrity | review professional boundaries and release claims |

For a target repository, roles are generated from confirmed business and technical evidence. The runtime activates the minimum sufficient approved roles and recommends a missing role for owner approval rather than silently adding it.

## Adaptive runtime

```text
read-only question
  -> load ordinary context only
  -> answer; no work unit, no team, no project command

small reversible change
  -> one implementer
  -> one targeted verification at completion
  -> no formal approval unless new evidence raises impact

ordinary feature
  -> one vertical feature work unit
  -> one implementer plus one independent reviewer
  -> approved plan and test cases
  -> one consolidated implementation and verification cycle

important business or public contract
  -> business/domain role + implementer + independent referee
  -> requirements/plan approval and evidence-bound QA

cross-surface, architecture, migration, external action, or high consequence
  -> architect/domain owners + implementer + QA/referee
  -> design approval, independent PK, qualified-human boundary when applicable
```

Task level controls required evidence and verification. Review mode controls participants. Neither mechanism creates one task per file or endpoint.

## Functional unit 1: Trustworthy onboarding and adaptive foundations

### Scanner

The repository scanner must:

- exclude `.worktrees`, `worktrees`, VCS internals, dependency caches, and known generated roots from project facts at any depth where applicable;
- identify languages/frameworks, exact declared dependencies and versions for npm, Maven, Gradle, Go, Python, and supported lockfiles;
- discover build, test, lint, type-check, and verification commands without running them;
- report existing governance files, architecture/topology clues, and separately probed Agent availability;
- distinguish stated manifest facts from installed/runtime verification.

### Onboarding and depth bundles

The first visible decision remains Agent selection. Governance language remains second and defaults to English. Lifecycle and existing-code strategy remain explicit.

- Minimal: core rules, safe sync/check, adaptive task summary, and the memory ownership contract. It does not eagerly generate team, architecture, release, or full evidence bodies.
- Standard: Minimal plus task routing, dynamic team metadata, project-convention Skills, work-unit validation, and common verification guidance.
- Complete: Standard plus full architecture, evidence, release, memory drift, QA, and capability-growth routes. These routes remain lazy and do not run for every task.

Memory defaults to enabled in all presets. Greenfield initialization writes only the schema/index/ownership foundation; real module facts appear after implementation. Brownfield initialization generates a bounded deterministic structural preview and evidence-linked memory proposal without modifying business code.

### Approval and routing fixes

- The approval plan hash binds task level, review mode, exact scope, confirmed risks, normalized approval receipt, and the digest of every referenced requirements/design/plan/test artifact even when the artifact is ignored by Git.
- Project-level confirmed risk signals only raise a task when an approved path/signal applicability mapping matches the current scope.
- Ordinary feature source changes default to an implementer plus independent reviewer; local non-behavior fixes retain single/quick review.
- Valid bounded YAML block scalars in Skill metadata are accepted without enabling anchors, aliases, tags, code execution, or unbounded parsing.

## Functional unit 2: Business memory and project-convention Skills

### Memory model

The canonical project memory uses:

```text
docs/memory/
  README.md
  SCHEMA.md
  INDEX.json
  modules/<module-id>.md
  sources/<source-id>.json
```

`INDEX.json` is the single ownership and lookup map. It contains module IDs, memory pages, owning code globs, pages, APIs, service/public methods, data sources, frontend call sites, and evidence paths. Each directional relation is materialized both ways in the index so an Agent can locate API -> call sites/features and page/feature -> APIs.

Brownfield bootstrap only records facts proven by repository evidence: routes, exported/public methods, package/module paths, UI route/page declarations, API client call sites, data/schema files, tests, and unresolved gaps. Agent-authored summaries add business purpose and invariants with `verifiedFrom` evidence. Unsupported syntax remains a visible gap.

The checker validates safe paths, unique owners, file existence, required sections, method/path pairings where supported, reciprocal links, referenced evidence, and changed owning-code-to-memory freshness. A behavior change must update the affected memory page/index or carry a bounded explicit no-memory-impact receipt. Formatting-only, test-only, and L1 non-behavior changes do not force memory churn.

### Project-convention Skills

Brownfield code evidence can produce project-convention Skill candidates under `docs/ai/skills/project-conventions/<id>/SKILL.md`. A candidate requires repeated or canonical project evidence and includes:

- a narrow trigger and scope;
- its purpose and rationale;
- exact repository evidence paths;
- a correct project-local example;
- an incorrect/counter example when safely derivable;
- verification commands or an explicit unverified boundary;
- source digests and stale-on-change behavior.

The generator does not turn every observed pattern into a Skill. Conflicting examples create a gap. Candidates follow existing add/defer/reject approval and never auto-promote.

## Functional unit 3: Vertical feature work units and QA completion

### One feature, one work unit

A feature work unit is one bounded JSON document referenced by the completion gate. A login feature can include UI, registration, login, password reset, schema/SQL, services, APIs, and tests in one work unit.

Required sections:

- identity, intent, task level, review mode, and current status;
- requirements summary and acceptance criteria;
- optional design summary when required by level;
- scope grouped by surface/module, not one task per endpoint;
- confirmed risks and professional boundaries;
- selected roles and missing-role recommendations;
- implementation plan;
- test cases with stable IDs and categories;
- API/public-method unit-test coverage map;
- QA additions and per-case execution results;
- verification command evidence;
- memory impact and updated owners;
- reference digests and approval plan hash.

### Lifecycle

```text
draft analysis
  -> planned (requirements + plan + initial test cases)
  -> approved (L2/L3 exact plan hash)
  -> implementing
  -> qa-ready (implementation and required unit tests present)
  -> verified (QA cases executed and marked)
  -> memory-synced
  -> complete
```

L0 has no work unit. L1 uses a compact receipt only when code changes. L2/L3 use the full work-unit schema. New evidence can raise the route and invalidate approval; it cannot silently lower the route.

### Test policy without repeated execution

- Every changed or new API endpoint and reusable/public method must map to at least one unit test or an explicit testability gap that blocks completion.
- Initial cases cover success and known failures. After implementation, the QA role adds applicable abnormal-data, boundary, extreme-load/value, and risk cases.
- Cases that are not applicable require a reason; they cannot be silently omitted.
- The test suite is executed once at the work-unit verification boundary. Debugging may run targeted tests, but governance does not require a full run per endpoint or per subtask.
- Completion records per-case `passed`, `failed`, `blocked`, or `not-applicable`, along with the command/output digest. Required failed or blocked cases prevent completion.

### Completion

Completion validates the final Git diff, exact approval references, work-unit state, unit-test map, QA results, verification input/output binding, professional boundaries, and memory freshness. Only then may the feature be reported complete. Capability harvesting remains candidate-only and happens after successful L2/L3 verification.

## Safety and evidence

All new readers and writers reuse repository-relative safe-path checks, symlink rejection, bounded regular-file reads, manifest trust, deterministic digests, execution-plan freshness, transactional apply/rollback, and zero-delete ordinary sync. Project scripts run only by exact explicit selection. Generated text or role names never grant network, installation, external actions, deployment, publishing, pushing, or professional authority.

Evidence states remain:

- `stated`: a document or declaration exists;
- `reachable`: a checked route can resolve the artifact or implementation;
- `enforced`: a named machine check and negative probe reject violations;
- `verified`: a current named command/platform/scope has actual passing evidence.

## Acceptance matrix

The implementation is complete only when all 28 owner requirements have direct tests or current evidence. Existing passing behavior for safe sync, manifest integrity, architecture guidance, capability candidates, evidence levels, release separation, and path/symlink safety must remain unchanged. New acceptance tests must cover default memory, brownfield memory bootstrap, multi-ecosystem dependency facts, project-convention Skills, dynamic role recommendations, work-unit granularity, unit-test mapping, QA categories/status, reciprocal memory lookup, and exact approval-reference binding.

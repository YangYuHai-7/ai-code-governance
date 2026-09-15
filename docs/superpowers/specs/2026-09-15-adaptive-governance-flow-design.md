# Adaptive AI Code Governance Flow Design

## Status

- Decision: approved by the Product Owner on 2026-09-15.
- Scope: redesign AICG onboarding, artifact selection, task routing, approval gates, and capability harvesting so governance effort scales with the actual task.
- Default governance artifact language: English.
- Initial first-class artifact languages: English and Simplified Chinese.
- Compatibility boundary: existing repositories and existing bilingual configurations remain readable and are never destructively compacted by an ordinary upgrade.
- Evidence boundary: model classification can recommend a route, but only repository state, owner-confirmed risk, real commands, and current-diff evidence may satisfy a machine gate.

## Problem

The current product contains the right governance capabilities but exposes too many of them as an unconditional baseline. A minimal Codex-only project currently produces 19 governance files, broader presets produce 21–37 files, and ordinary implementation begins with roughly 1,600–2,700 governance tokens. By contrast, the governance checker itself takes roughly 0.1 seconds on small fixtures and about 0.68 seconds on a 10,000-file fixture. The primary latency is therefore context and ceremony, not checker CPU time.

The onboarding flow also conflates interaction language with artifact language, defaults generated artifacts to Chinese in `defaultConfig()`, and can treat a complete capability model as the default response to a vague governance request. At task time, labels such as "one-sentence requirement", "complete requirement", "small issue", and "large feature" mix two different dimensions: input clarity and change impact. This can force a trivial but tersely worded request through the longest process while allowing a clearly written high-risk change to look deceptively simple.

The redesigned product must keep a single canonical source, minimal routing, real machine gates, safe migration, and capability evolution without making every task execute the full lifecycle.

## Goals

1. Make the first user-visible onboarding decision the supported coding agents.
2. Ask separately for governance artifact language and default it to English.
3. Detect existing technology stacks before asking questions; ask existing-project owners to confirm detection instead of selecting a replacement stack.
4. Extract architecture and reusable project-capability candidates only from evidence in existing repositories.
5. Generate a small stable governance kernel plus only the capabilities selected by evidence and owner decisions.
6. Route conversations according to mutation type, impact scope, risk, and clarity.
7. Allow direct answers and low-risk fixes without design or plan ceremony.
8. Require explicit requirement and plan approval for business, high-risk, large, or cross-surface changes.
9. Treat skill evolution as evidence-bound candidate harvesting, with update-existing preferred over create-new.
10. Prevent artifact reduction from deleting user or legacy content during an ordinary upgrade.

## Non-goals

- Building a general plugin marketplace or arbitrary artifact-rule engine.
- Using keyword matching alone to classify task risk or authorize release.
- Replacing an existing project specification or execution workflow.
- Requiring design documents, plans, subagents, or governance subprocesses for every request.
- Inferring business rules, risk acceptance, architecture, or supported clients from filenames or the current chat client.
- Automatically modernizing an existing technology stack.
- Treating generated files, simulated reviewers, or a passing structural check as product-behavior evidence.
- Publishing packages, pushing repositories, deploying, or installing hooks without separate authorization.

## Design Principles

### Stable kernel, conditional capability

Every governed repository keeps three non-negotiable properties:

1. one canonical governance source;
2. a route to the smallest relevant context;
3. a machine check that fails when an enforced claim is false.

The twelve-layer model remains a capability catalog, not a mandatory file bundle. Presets select capabilities; capabilities select artifacts; task profiles select which artifacts enter context.

### Classification uses independent dimensions

Task size, risk, mutation, and clarity are assessed separately. A one-sentence request may be an L0 answer or L3 feature. A complete specification may be an L1 documentation edit or an L3 high-risk change.

### Ceremony is monotonic

A task may upgrade when new evidence appears, but may not downgrade after it crosses a stronger approval boundary. A documentation task whose actual diff changes production behavior upgrades before delivery. A release route is entered only by explicit release intent, never by a word appearing in documentation.

### Questions protect decisions, not implementation trivia

The agent interrupts only when different answers materially change behavior, public contracts, data, compatibility, external effects, acceptance, or requested scope. Ordinary implementation details are resolved from project evidence and reported at delivery.

### No ownership, no automatic deletion

Legacy, seed, unknown, drifted, or user-edited content is retained. Destructive compaction requires a trusted manifest, a dry-run plan, an exact plan hash, and explicit approval.

## Architecture

```text
Read-only repository scan
  -> onboarding decisions
  -> capability selection
  -> artifact selection
  -> plan and budget preview
  -> transactional apply
  -> integrity check

Conversation intent
  -> semantic route recommendation
  -> minimum context profile
  -> optional requirement/design/plan gates
  -> implementation and project verification
  -> diff-based route validation
  -> capability-harvest candidate
```

The implementation is divided into seven bounded components.

### 1. Onboarding decision collector

The collector consumes scanner output and user answers. It does not write files. The interactive order is:

1. supported coding agents;
2. governance artifact language;
3. repository lifecycle confirmation;
4. technology stack confirmation or selection;
5. existing-code strategy, when applicable;
6. recommended governance preset and optional capabilities;
7. command invocation mode and separately authorized integrations.

The repository scan still runs before the first prompt so the questions can include evidence, but it cannot decide the supported-client scope or silently replace an owner answer.

### 2. Capability selector

The selector is a small internal module, not a public registry framework. It resolves existing `governanceDepth`, `features`, confirmed repository evidence, and owner decisions into six capability groups:

| Capability | Responsibility | Activation |
| --- | --- | --- |
| `core` | canonical root, config, manifest, root entry, integrity gate | always |
| `routing` | context profiles and verification routing | standard or complete |
| `policy` | architecture, stack, business, and anti-pattern rules | evidence plus owner confirmation |
| `evidence` | acceptance, surface, and release evidence | first use |
| `lifecycle` | memory, long-running tasks, harvest and promotion | explicit feature |
| `integration` | client adapters, hooks, CI, external workflow bridge | explicit selection |

The initial implementation may encode these groups as JavaScript metadata next to artifact builders. It must not introduce a configurable expression language, dynamic plugin loading, or a second JSON authority.

### 3. Artifact selector

Each artifact builder declares:

```text
id
path
capability
activation: eager-core | selected | first-use | evidence-produced
requires
ownership
routeProfiles
gateAssertions
```

The selector computes an exact allowlist for a new project. `buildArtifacts()` delegates to the selector instead of treating every known artifact as a baseline. The checker derives expected artifacts from the same resolved selection so generator and checker cannot define different depth contracts.

### 4. Task route recommender

Semantic intent classification remains an agent responsibility because the CLI cannot reliably infer meaning from bare keywords. The governance framework generates a machine-readable routing policy and concise native-agent instructions.

The route input model is:

```text
mutation: none | governance-only | non-production | product-behavior | external-action
scope: single-file | single-module | multi-module | multi-surface
risk: low | business | high-consequence
clarity: clear | locally-ambiguous | exploratory
```

The route output is:

```text
level: L0 | L1 | L2 | L3
profile
requiredApprovals
verificationClass
overlays
reasonCodes
```

The agent recommends the initial level. Before delivery, the CLI checks the actual diff, selected risk signals, release intent, and verification evidence to calculate a machine-verifiable minimum level. If the declared route is too weak, completion fails with an upgrade instruction. Machine checks do not downgrade or authorize external actions.

### 5. Approval gate coordinator

Governance defines when approval is required but does not create a duplicate planning authority. If the repository has an approved workflow provider, its design, plan, task list, and completion artifacts remain authoritative. Otherwise, L2 approval may remain in the client conversation and L3 uses the selected client-native design and plan workflow. Persistent task runtime is created only when its capability is explicitly enabled.

### 6. Capability harvester

Harvest runs only after verified product-behavior changes. It produces candidates, not automatically trusted skills. It binds candidates to current implementation paths, public entry points, tests, owner, and fingerprint.

Candidate resolution order is:

```text
update existing skill
  > extend existing skill
  > create a new skill
  > record no-skill-with-reason
```

### 7. Migration guard

Template v3 adds the new selection and routing behavior. Ordinary sync across template versions retains legacy artifacts. Physical compaction is a separate approved action using the existing execution-plan hash and transactional rollback primitives.

## Onboarding Flow

### Agent selection

The first visible question asks which clients must consume the same governance source:

- Codex only;
- Claude Code only;
- Cursor only;
- a user-selected combination;
- all built-in clients.

Because artifact and interaction language have not been selected yet, this first prompt is concise and bilingual unless an explicit `--locale` already supplies the interaction language. The second prompt then selects governance artifact language; choosing a chat language must not silently answer it.

The selection is recorded with source `user` or `interactive`. Repository files and the active chat client are evidence of current state, not authorization to narrow support.

### Language selection

The second visible question asks for governance artifact language:

- English, recommended and default;
- Simplified Chinese.

The configuration separates three language concerns:

```json
{
  "interactionLanguage": "en",
  "artifactLanguage": "en",
  "codeDocumentationPolicy": "inherit-existing"
}
```

- `interactionLanguage` controls prompts and human CLI output and may follow the user.
- `artifactLanguage` controls governance prose and defaults to `en` independently of interaction language.
- `codeDocumentationPolicy` is `inherit-existing` for existing projects and `en` for greenfield projects unless the user overrides it.

JSON/YAML keys, IDs, enums, commands, and filenames remain English in all modes. Existing `bilingual` configurations remain valid for compatibility, but bilingual is not a recommended guided default. If a later version generates a translated companion, one language remains canonical and the translation is generated, hash-bound, and excluded from the default context closure.

### Technology stack

For an existing repository, the scanner displays the detected languages, runtimes, frameworks, infrastructure, package evidence, and confidence. The user confirms or corrects that result. The flow skips greenfield selection but never silently treats detection as owner approval.

For a greenfield repository, the user selects the intended stack. AICG generates only the selected stack capabilities. Current official sources are researched only when a stack skill is actually requested; unrelated framework material is not generated.

### Architecture and reusable capabilities

For an existing repository, AICG inspects module boundaries, dependency direction, public clients, repositories, adapters, guards, policies, repeated implementation patterns, tests, and documented business invariants. Findings are classified as:

- `verified-candidate`: code and tests support the claim;
- `needs-owner-confirmation`: implementation exists but its intended contract is unclear;
- `gap`: naming or weak evidence is insufficient.

Only the first two appear in the approval preview, and only approved, evidence-bound candidates become project skills or architecture rules.

For a greenfield repository, architecture is recorded as `not-established`. The initializer must not invent layers or module boundaries. Architecture and project skills are added after a feature establishes verified patterns.

### Preview and apply

Before writing, the initializer displays:

- selected clients and language decisions;
- lifecycle and stack evidence;
- selected preset and capabilities;
- exact file actions;
- managed file count, bytes, and default context estimate;
- which claims are `stated`, `reachable`, or intended to become `enforced`;
- required hooks, CI, AI assistance, network access, or external-provider authorization;
- plan hash.

No write occurs until the user approves the plan. Apply is transactional and is followed by one integrity check.

## Presets and Artifact Budgets

### Minimal: trusted kernel

Minimal is suitable for solo maintainers, small repositories, and first adoption. It includes config, manifest, the shared native entry, canonical index, always-on invariants, the selected client adapter when needed, and one integrity gate.

It does not eagerly create architecture, technical standards, release policy, acceptance contract/results, surface profiles/results, decision ledger, memory, task runtime, review/report placeholders, hooks, CI, or capability-evolution artifacts.

- Target: no more than 8 managed files for Codex-only.
- Hard initial gate: no more than 10 managed files.
- Default-start governance context: no more than 1,200 estimated tokens.

### Standard: project routing and policy

Standard extends Minimal with a context map and verification profiles. Architecture, anti-patterns, stack skills, and business skills are conditional on repository evidence and owner confirmation. Release, surface, and formal acceptance artifacts materialize on first use.

- Standard core budget: no more than 20 managed files before conditional project skills and selected client adapters.
- Ordinary-task initial context: no more than 900 tokens.
- Behavior-change initial context: no more than 1,800 tokens.

### Complete: lifecycle availability

Complete makes lifecycle governance available but does not eagerly materialize every optional feature. Memory, long-running task runtime, hooks, CI, external workflows, and additional evidence remain independently selected.

Complete is recommended only after explicit selection or multiple owner-confirmed signals such as long-running work, high-consequence boundaries, multi-client teams, CI enforcement, or ongoing capability promotion.

- Complete core budget: no more than 26 managed files before conditional skills and extra client adapters.
- Ordinary and behavior-change startup budgets remain identical to Standard.

An unspecified governance request uses scanner evidence to recommend Minimal or Standard and never silently activates Complete.

## Dynamic Conversation Flow

### L0: answer directly

Use for read-only explanation, review, discovery, and status requests.

```text
understand -> read minimum evidence -> answer
```

There is no design, plan, governance subprocess, or harvest step.

### L1: quick low-risk change

Use for a localized change that does not alter business rules, public API/schema, permissions, compatibility, or external effects.

```text
locate -> clarify only material ambiguity -> edit -> targeted test -> one completion check
```

No formal user-approved plan is required. If new evidence crosses an L2/L3 boundary, work stops before the wider change and the route upgrades.

### L2: business or medium-impact change

Use when product behavior, a business rule, a state transition, a public contract, or an owner-confirmed risk boundary changes.

```text
understand current behavior
  -> define goal, rules, boundaries, and acceptance
  -> ask one material question at a time
  -> user approves requirements
  -> present implementation plan
  -> user approves plan
  -> implement and verify
```

Both requirement and plan approval are required.

### L3: large, cross-surface, architectural, or high-consequence change

Use for multi-module or multi-surface features, architectural contracts, migrations, compatibility work, or high-consequence behavior.

```text
analyze -> adversarial/multi-role review when justified
  -> close requirement gaps one at a time
  -> user approves requirements and design
  -> decompose tasks and dependencies
  -> user approves execution plan
  -> serial or parallel implementation
  -> integration verification
```

Different clients or subagents are used only when task boundaries, input/output contracts, ownership, and independent tests are already clear and concurrent edits will not overlap. Shared API contracts are fixed before parallel implementation begins.

### Exploratory and complete inputs

"One-sentence requirement" is not a fixed level. If it is already clear, it immediately routes to L0–L3. If it is unclear, the agent brainstorms, asks one material question per turn, produces an approved requirement summary, and then routes by impact.

"Complete requirement" is also not a fixed level. It is first checked for contradiction, missing failure paths, authorization/data boundaries, unverifiable acceptance, and cross-system impact. Multi-role adversarial review is used only for L3 scope or risk.

## Context Profiles

The generated root entry contains only:

1. canonical location;
2. smallest-profile routing instruction;
3. scope and user-change protection;
4. generated-adapter ownership boundary;
5. one delivery gate entrypoint.

The always-on rule contains only cross-task invariants. Architecture details, technical standards, harvest, hooks, reviews/reports, acceptance, and release policy are excluded from the ordinary startup closure.

Suggested profiles:

```yaml
base:
  required:
    - docs/ai/rules/00_always.mdc

profiles:
  ordinary:
    extends: base
    required: []

  behavior_change:
    extends: ordinary
    conditional:
      architecture: route-if-confirmed
      stack: route-one-or-two-matching-skills
      business: route-matching-owner-confirmed-skill

  release:
    extends: ordinary
    required:
      - docs/ai/release-acceptance-policy.json
```

Within one task, canonical content is deduplicated by canonical path and content hash. Client adapters resolve to canonical IDs and never cause a second load.

## Approval and Interruption Rules

The agent must interrupt before proceeding when an answer would change:

- product behavior or acceptance;
- public API, schema, data migration, or compatibility;
- authorization, payment, tenancy, sensitive data, or external side effects;
- destructive or irreversible action;
- requested scope;
- architecture ownership or selected workflow authority;
- deployment, publication, or external messaging.

The agent does not interrupt merely to ask about naming, internal implementation preference, formatting, or another reversible low-risk decision already covered by project conventions.

External actions always require a separate exact approval, even when an implementation plan was approved.

## Capability Harvest and Skill Growth

Harvest is eligible only after a behavior-changing task passes product verification. A candidate must have:

- a stable capability ID;
- a verified implementation path;
- an owner or explicit ownership gap;
- a public entry point or an explicit gap;
- current test or verification evidence;
- a trigger and adjacent exclusions;
- an implementation fingerprint;
- a review date.

No harvest runs for read-only work, prose-only changes, formatting, test fixtures, temporary scripts, or low-risk fixes with no reusable capability change.

Candidates are deduplicated against existing skills. A candidate does not become `adopted` or `enforced` without the existing promotion approval and successful project-owned verification. A changed fingerprint invalidates stale promotion evidence and requires review.

## Safe Migration

Artifact slimming must not begin by deleting entries from the current builder. The safe sequence is:

1. validate manifest provenance, schema, tool/template source, ownership kind, source path, and hashes before granting stale-removal authority;
2. reuse the existing execution-plan preimage and plan-hash contract for sync deletion;
3. make an ordinary template-v3 sync retain legacy artifacts;
4. remove legacy artifacts from active routing before considering physical cleanup;
5. report seed files only as manual cleanup candidates;
6. permit automatic prune only for trusted, fully owned, unmodified historical-template artifacts;
7. require `sync --prune --dry-run` followed by `sync --prune --approve <planHash>`;
8. reject stale approval when any input changes;
9. keep `--force` independent from and subordinate to prune approval;
10. run the normal checker after apply and transactionally restore preimages if validation fails.

Existing release, acceptance, and surface evidence is retained as dormant history. Existing unselected client adapters are retained until explicitly pruned. Existing invocation mode is preserved; only new installations receive the new default.

## Performance and Behavior Budgets

| Metric | L0 ordinary | L1 quick change | L2/L3 behavior | Release |
| --- | ---: | ---: | ---: | ---: |
| Initial unique governance files | <= 3 | <= 3 | <= 5 | <= 5 |
| Initial governance tokens | <= 900 | <= 900 | <= 1,800 | <= 3,000 |
| Cumulative unique governance files | <= 3 | <= 5 | <= 8 | <= 8 |
| Governance subprocesses | 0 | 1 | 1 by default | exactly 2 |

Machine budgets:

- small-fixture `check` p95 <= 250 ms;
- 1,000-file `check` p95 <= 300 ms;
- 10,000-file `check` p95 <= 1 second;
- routing computation p95 <= 20 ms;
- local `test:fast` p95 <= 5 seconds;
- full regression runs only for merge, release, or explicit full validation.

Performance tests use warmup plus repeated samples and gate both an absolute limit and a bounded regression from the recorded baseline. File count, bytes, context closure, negative content, and process count are separate gates; fast execution alone cannot hide context growth.

## Testing Strategy

Implementation follows test-driven development.

### Onboarding tests

- The first visible choice is client scope.
- Artifact language is asked separately and defaults to English.
- Interaction language never silently overrides artifact language.
- English and Chinese prose render correctly while IDs and schema keys remain stable.
- Existing repositories display detected stack evidence and require confirmation or correction.
- Greenfield repositories record architecture as `not-established`.

### Artifact contract tests

- Exact allowlists exist for Minimal, Standard, and Complete fixtures.
- Minimal never includes release, surface, lifecycle, reviews/reports placeholders, or unselected clients.
- Checker requirements come from the same selection as generator output.
- Context and artifact budgets fail deterministically when exceeded.

### Routing tests

- Cover read-only question, README edit, test-only change, single-file bug fix, business behavior, dependency upgrade, public API, authorization/payment, cross-surface feature, explicit release, and discussion that merely mentions release.
- Verify a late production diff upgrades a task and cannot reuse a weaker completion receipt.
- Verify one canonical hash is loaded once even through multiple client adapters.
- Verify L0 uses zero and L1/L2 use the expected governance process count.

### Skill growth tests

- Read-only and non-reusable changes produce no harvest candidate.
- Existing skills are updated before new skills are created.
- A candidate requires evidence and cannot claim adoption.
- Implementation drift invalidates the previous fingerprint and promotion evidence.

### Migration and safety tests

- Foreign, forged, future-version, unsafe-path, symlink, CRLF, and user-edited fixtures fail closed or retain content as specified.
- Ordinary v1/v2-to-v3 sync performs zero automatic deletion.
- Prune dry-run writes nothing and exposes every action plus plan hash.
- Missing, wrong, or stale approval exits non-zero with a byte-identical tree and manifest.
- Transactional rollback restores files, permissions, links, timestamps, and manifest after injected checker failure.

### Test suite split

- `test:fast`: argument parsing, onboarding, config, selector, artifact plan/apply, generation, checker, route policy, architecture boundaries, and technical standards.
- `test:full`: all Node tests; keep `npm test` as a compatibility alias for at least one release.
- `test:scenarios`: packed greenfield, brownfield, migration, rollback, and cross-client fixtures.
- `test:perf`: deterministic artifact, context, routing, and filesystem scale benchmarks.

## Delivery Sequence

1. **D0 — Safety contracts:** add trusted-manifest validation and plan-hash approval to any stale-removal/prune path before artifact allowlists can shrink.
2. **D1 — Zero-delete context reduction:** shorten root and always-on content, remove release/harvest/standards from ordinary routing, and retain all existing artifacts.
3. **D2 — Onboarding decisions and language:** reorder prompts, separate artifact language from interaction language, default artifacts to English, confirm existing stacks, and record greenfield architecture gaps.
4. **D3 — Capability and artifact selection:** implement the internal selector, exact preset allowlists, lazy evidence artifacts, and selection-driven checker expectations.
5. **D4 — Dynamic task routing:** generate route policy and profiles, implement diff-based minimum-level validation, and enforce approval boundaries without duplicating external workflow owners.
6. **D5 — Local execution and fast feedback:** make new projects prefer a verified project-local CLI, consolidate the normal behavior-change completion path, and split fast/full/scenario/performance tests.
7. **D6 — Safe legacy compaction:** expose dry-run prune, exact approval, legacy retention states, and rollback scenarios.
8. **D7 — Capability harvest policy:** scope harvest to verified behavior changes, enforce candidate deduplication/evidence, and test skill-growth budgets.
9. **D8 — Candidate validation:** run full repository validation, package smoke, greenfield/brownfield fixtures, and platform-specific evidence without claiming unexecuted clients or operating systems.

Each delivery unit must be independently testable and reversible. D0 is a prerequisite for physical artifact reduction. D1 may ship before D2–D8 because it changes routing without deleting legacy files.

## Acceptance Criteria

- A new guided installation asks for client scope first and artifact language second.
- New configurations default `artifactLanguage` to `en`; interaction language remains independent.
- Existing bilingual configurations remain readable and are not silently rewritten.
- Existing-project stack detection is displayed with evidence and requires explicit confirmation or correction.
- Greenfield initialization does not invent architecture or project skills.
- New Codex-only Minimal installations contain no more than 10 managed files and no release, surface, lifecycle, or placeholder workspace artifacts.
- Ordinary startup does not load technical standards, capability evolution, harvest, hooks, reviews/reports, or release policy.
- L0 performs no governance subprocess; L1 performs at most one completion process; L2/L3 require the defined approvals; release still requires exact two-phase approval.
- Actual production or high-risk diffs cannot complete under a weaker declared route.
- Multi-agent work is recommended only for independent, non-overlapping tasks with fixed contracts and independent tests.
- Harvest does not run for ineligible tasks and never promotes a candidate without evidence and approval.
- An ordinary template upgrade deletes nothing; an approved prune cannot delete seed, unknown, drifted, or untrusted content.
- Artifact, context, route, process-count, performance, migration, and rollback tests pass.
- Delivery reports distinguish `stated`, `reachable`, `enforced`, and real-client/platform evidence.

## Open Product Boundary

The first-class language selector is English or Simplified Chinese. The existing `bilingual` value is retained for compatibility but excluded from the recommended guided path. Arbitrary-language generation is deferred until the English/Chinese templates, context budgets, and schema-stability tests are proven.

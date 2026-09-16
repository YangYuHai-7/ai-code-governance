# Complete Project Governance Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all 28 owner-required AICG capabilities through adaptive onboarding, evidence-linked memory and project-convention Skills, and one vertical feature/QA work-unit lifecycle.

**Architecture:** Preserve the existing deterministic scanner, compiler, artifact transaction, manifest, completion, release, and capability-growth kernels. Add bounded facts and schemas around those kernels instead of creating a second writer or general workflow engine. Semantic content is Agent-authored but must be evidence-linked and machine-validated; deterministic scanning never invents business meaning.

**Tech Stack:** Node.js 22+ ESM, built-in `node:test`, JSON/Markdown managed artifacts, current AICG CLI and transaction/checker infrastructure.

**Spec:** `docs/superpowers/specs/2026-09-17-complete-governance-lifecycle-design.md`

## Global Constraints

- Deliver exactly three complete functional units; do not split endpoints, pages, SQL, individual methods, or individual test cases into separate implementation tasks.
- Each functional unit uses one consolidated RED -> GREEN -> VERIFY cycle, one independent review, one child-repository commit, and one separate parent gitlink commit.
- Default memory is enabled, but deterministic scans must not invent unsupported business semantics.
- Existing projects are never rewritten, moved, reformatted, migrated, or otherwise modified by initialization.
- Ordinary context stays lazy and within the existing three-file / 900 estimated-token contract.
- Minimal, Standard, and Complete are capability bundles, not task sequences.
- Project roles are dynamic and owner-approved; no fixed industry roster may be added.
- High-consequence professional roles retain qualified-human final authority.
- Skill discovery remains local/offline by default and never installs, executes, or fetches candidates.
- Ordinary sync remains zero-delete; prune remains separately and exactly approved.
- Release remains separate and never deploys, publishes, pushes, or contacts external systems implicitly.
- Do not raise context, artifact, file-count, latency, or performance budgets to make tests pass.
- Preserve `stated`, `reachable`, `enforced`, and `verified` evidence semantics.
- Preserve unrelated worktree changes. Do not push either repository.

---

### Task 1: Trustworthy Onboarding and Adaptive Foundations

**Files:**
- Modify: `src/modules/repository/scanner.mjs`
- Create or modify focused dependency parsers under `src/modules/repository/`
- Modify: `src/cli/prompts.mjs`
- Modify: `src/cli/commands/init.mjs`
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `src/modules/governance/artifact-selection.mjs`
- Modify: `src/modules/governance/task-routing.mjs`
- Modify: `src/modules/governance/task-approval.mjs`
- Modify: `src/modules/completion/service.mjs`
- Modify: `src/modules/skills/discovery.mjs`
- Modify: `src/modules/agent-team/project-role-proposals.mjs`
- Modify: `src/modules/team/product-team-plan.mjs`
- Test: `test/project-assessment.test.mjs`
- Test: `test/onboarding-product-flow.test.mjs`
- Test: `test/artifact-selection.test.mjs`
- Test: `test/task-routing.test.mjs`
- Test: `test/task-approval.test.mjs`
- Test: `test/commit-completion.test.mjs`
- Test: `test/skill-discovery.test.mjs`
- Test: `test/project-agent-team.test.mjs`

**Interfaces:**
- Scanner returns exact dependency facts with ecosystem, name, declared/resolved version when available, source path, and evidence level.
- Default config sets knowledge/memory enabled and maps depth to capability bundles without eagerly loading conditional artifacts.
- Initial role recommendations derive from confirmed project/technical facts and remain unapproved until the existing exact-plan transaction applies them.
- Approval plan hash includes a canonical digest of the normalized approval receipt and every referenced requirements/design/plan/test artifact.

- [ ] **RED — add one consolidated foundation acceptance slice**

Add tests covering: root `.worktrees` exclusion; npm/Maven/Gradle/Go/Python dependency facts; first prompt Agent and second prompt language; default English and three operating systems; default memory; exact depth bundles; dynamic role proposal from confirmed facts; no fixed restaurant/food-safety inference; task-local risk applicability; ordinary feature quick/independent review; ignored approval-reference mutation invalidating `planHash`; bounded YAML block-scalar Skill description.

Run once:

```bash
node --test test/project-assessment.test.mjs test/onboarding-product-flow.test.mjs test/artifact-selection.test.mjs test/task-routing.test.mjs test/task-approval.test.mjs test/commit-completion.test.mjs test/skill-discovery.test.mjs test/project-agent-team.test.mjs
```

Expected RED: new assertions fail for current `.worktrees` scanning, default memory, multi-ecosystem dependency facts, task-local risk, ignored-reference binding, ordinary-feature review, and YAML block scalars.

- [ ] **GREEN — implement the complete foundation unit**

Implement the scanner, bundle/default, approval, routing, dynamic-role, and Skill metadata behavior through existing bounded readers, plan hashes, and transaction paths. Do not add a second artifact writer. Keep runtime Agent executable probing in `doctor`; scanner output distinguishes not-probed from detected.

- [ ] **VERIFY — run the unit suite once and commit**

Run the RED command again, followed by:

```bash
npm run test:fast
git diff --check
```

Expected: all commands exit 0; budgets remain unchanged; approval-reference replacement changes the plan hash; unrelated documentation stays L1 even when an unrelated project risk exists.

Commit child: `feat: complete adaptive governance foundations`

Commit parent pointer separately: `chore: update ai governance foundations`

---

### Task 2: Business Memory and Project-Convention Skills

**Files:**
- Create: `src/modules/memory/scanner.mjs`
- Create: `src/modules/memory/schema.mjs`
- Create: `src/modules/memory/checker.mjs`
- Create: `src/modules/memory/artifacts.mjs`
- Create: `src/modules/memory/index.mjs`
- Create: `src/modules/standards/project-conventions.mjs`
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `src/modules/governance/checker.mjs`
- Modify: `src/modules/governance/manifest-trust.mjs`
- Modify: `src/modules/completion/service.mjs`
- Modify: `src/cli/commands/init.mjs`
- Modify: `src/cli/commands/enrich.mjs`
- Create: `test/memory-lifecycle.test.mjs`
- Create: `test/project-conventions.test.mjs`
- Modify: `test/generation.test.mjs`
- Modify: `test/context-budget.test.mjs`
- Modify: `test/commit-completion.test.mjs`

**Interfaces:**
- `scanProjectMemoryFacts(scan, options?)` returns bounded structural module/page/API/public-method/data/call-site facts and explicit gaps without semantic invention.
- `buildMemoryArtifacts(config, scan, facts)` produces schema, index, module pages, and source records through the existing artifact plan.
- `memoryIssues(root, scan, changedPaths?)` validates safe ownership, reciprocal lookup, evidence references, and changed-code freshness.
- `discoverProjectConventionCandidates(scan, memory)` emits standardized candidate Skills with triggers, rationale, examples, evidence paths, digests, and verification boundaries.

- [ ] **RED — add one consolidated brownfield/new-project memory and convention slice**

Create fixtures for a small client/server feature with UI page, API client call, server route, public service method, schema, and tests. Assert that brownfield initialization proposes and applies reciprocal page/feature/API/call-site memory; greenfield initialization creates only the empty evidence-safe foundation; behavior changes require the owning memory page/index; test-only and formatting-only changes do not; project-convention candidates contain trigger, purpose, why, correct project-local example, evidence paths, source digests, and stale-on-change behavior; conflicting patterns create gaps rather than a false standard.

Run once:

```bash
node --test test/memory-lifecycle.test.mjs test/project-conventions.test.mjs test/generation.test.mjs test/context-budget.test.mjs test/commit-completion.test.mjs
```

Expected RED: memory modules and project-convention candidate generator do not exist; current generator emits only a four-line index.

- [ ] **GREEN — implement the complete memory and convention unit**

Use deterministic syntax-aware recognizers only for explicitly supported ecosystems and record unsupported syntax as gaps. Keep semantic summaries Agent-authored and evidence-linked. Route generated files through the existing manifest/transaction/checker. Keep memory and project-convention bodies outside ordinary context until a matching route activates them.

- [ ] **VERIFY — run the unit suite once and commit**

Run the RED command again, followed by:

```bash
npm run test:fast
npm run validate
git diff --check
```

Expected: all commands exit 0; reciprocal lookups work in both directions; stale owning code is rejected unless the correct owner memory is updated; ordinary context stays within budget.

Commit child: `feat: add evidence linked project memory`

Commit parent pointer separately: `chore: update ai governance memory lifecycle`

---

### Task 3: Vertical Feature Work Units and QA Completion

**Files:**
- Create: `assets/contracts/work-unit-schema.json`
- Create: `src/modules/work-units/schema.mjs`
- Create: `src/modules/work-units/planner.mjs`
- Create: `src/modules/work-units/checker.mjs`
- Create: `src/modules/work-units/index.mjs`
- Create: `src/cli/commands/work-unit.mjs`
- Modify: `src/cli/command-specs.mjs`
- Modify: `src/cli/command-registry.mjs`
- Modify: `src/cli/args.mjs`
- Modify: `src/cli/help.mjs`
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `src/modules/governance/task-routing.mjs`
- Modify: `src/modules/governance/task-approval.mjs`
- Modify: `src/modules/completion/service.mjs`
- Modify: `src/modules/team/product-team-plan.mjs`
- Modify: `src/cli/commands/completion.mjs`
- Create: `test/work-unit-lifecycle.test.mjs`
- Create: `test/real-scenarios/vertical-feature-delivery.test.mjs`
- Modify: `test/args.test.mjs`
- Modify: `test/task-approval.test.mjs`
- Modify: `test/commit-completion.test.mjs`
- Modify: `test/dynamic-team.test.mjs`
- Modify: `README.md`
- Modify: `SKILL.md`
- Modify: `references/initializer.md`

**Interfaces:**
- Add a bounded `aicg work-unit <plan|status>` read/preview interface and `--work-unit <safe-relative-json>` completion input. It validates or scaffolds governance evidence but does not implement business code.
- A full L2/L3 work unit binds requirements, design when required, scope groups, risks, roles, plan, test cases, API/public-method coverage, QA additions/results, verification, memory impact, references, and approval hash.
- L0 creates no work unit. L1 retains the current lightweight path. Ordinary L2 feature scope is one vertical unit and defaults to implementer plus independent reviewer; high-consequence triggers retain PK/human boundaries.

- [ ] **RED — add one consolidated vertical-feature scenario**

Model one login feature containing page, registration/login/password-reset APIs, data/schema, SQL/migration, service logic, API clients, and unit tests as one work unit. Assert: analysis produces one plan plus initial cases; scope is grouped by surface rather than endpoints-as-tasks; every endpoint/public method maps to a unit test; QA adds applicable abnormal, boundary, extreme, and risk cases; per-case results are marked; one consolidated verification command binds unchanged inputs; failed/blocked required cases prevent completion; memory must be synchronized; missing approved roles create owner-visible recommendations; professional gaps block high-consequence completion.

Run once:

```bash
node --test test/work-unit-lifecycle.test.mjs test/real-scenarios/vertical-feature-delivery.test.mjs test/args.test.mjs test/task-approval.test.mjs test/commit-completion.test.mjs test/dynamic-team.test.mjs
```

Expected RED: work-unit command/schema/checker and completion integration do not exist.

- [ ] **GREEN — implement the complete work-unit and QA lifecycle**

Implement one bounded machine document and reuse existing approval, safe-path, verification, professional-boundary, memory, completion, and capability-harvest services. Do not create a scheduler, queue, background process, automatic Agent launcher, or per-endpoint task tree. Role execution remains honestly evidenced: recommendations/role IDs do not claim a real Agent acted without a receipt.

- [ ] **VERIFY — run final acceptance once and commit**

Run the RED command again, followed by this final sequence:

```bash
npm run test:fast
npm run test:full
npm run test:perf
npm run validate
npm run smoke
npm run smoke:package
npm pack --dry-run
git diff --check
```

Expected: every command exits 0; all 28 requirements have direct tests/current evidence; small check p95 <=250 ms, 10k check <=1000 ms, routing <=20 ms, fast-suite p95 <=5000 ms; no budget is raised; no external action or push occurs.

Commit child: `feat: add vertical feature qa lifecycle`

Commit parent pointer separately: `chore: update ai governance delivery lifecycle`

---

## Final audit

After Task 3, perform one independent whole-branch review against the 28-item objective and the approved design. Any Critical/Important finding is fixed in one consolidated final fix wave, re-verified once, and committed as a single follow-up child commit plus one parent pointer commit. Do not push. Report all commit IDs, verification commands, remaining unverified external/platform evidence, and any explicit rulings.

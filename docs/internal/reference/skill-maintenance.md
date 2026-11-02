# Governance maintenance and specialist operations

Load this reference only for its selected task branch. Return to [the Skill entrypoint](../../../SKILL.md) for another branch.

## Canonical ownership and small context

For production work, including bounded L1.5 fixes, inspect the task route's development guidance and read its selected Skills before implementation. complete baseline generates proportionate-design, module-boundaries and component-reuse implementation Skills with correct/incorrect shapes and review decisions; actual .NET manifests additionally select dotnet-development. Handoff refuses to recommend implementation when those generated files are missing, stale or unreadable. Implementation guidance is part of every generated framework; legacy depth input cannot disable it. Reuse the current task plan/review to explain capability reuse, consumers of new abstractions, module dependencies and component state ownership; do not create a new approval ceremony. Integrity and selection remain distinct from authentic client loading or semantic design review.

Owner-approved Workflow preservation validates immutable supported template baselines and exact receipt/content digests. A newer template cannot retroactively invalidate unchanged approved bytes; known older baselines are reported as preserved-legacy with migration pending. Removed baseline gates and stale receipts still fail. Project-specific production floors can be recorded with taskRouting.productionMinimumLevel=L2 or L3; stronger project requirements override the generic bounded-fix shortcut.

Keep `docs/ai` as the canonical source and `.ai-governance/manifest.json` as ownership/hash evidence. Use native imports or generated ordinary files; never create symlink/junction adapters. Agent details belong to [agent-registry.json](../../../assets/registries/agent-registry.json).

Every framework includes the kernel, memory foundation, routing, selected stack/development Skills, role definitions and conditional specialist routes. Adaptive project-team decisions retain exact approval. Lifecycle/integrations remain optional. Release/acceptance/surface policies activate on first use and results require actual evidence. Ordinary startup loads only `AGENTS.md`, the selected `context-map.yaml` slice, and `00_always.mdc`. Memory, architecture, business, standards, harvest, hooks, reports, and release material stay outside this closure. Resolve adapters to canonical paths and hashes before counting context.

Ordinary sync is zero-delete, even when current selection omits legacy artifacts. Keep seed, unknown, edited, drifted, historical, and dormant evidence content. Physical removal is a separate exact-plan action:

```bash
aicg sync . --prune --dry-run
aicg sync . --prune --approve <planHash>
```

Prune requires trusted, unchanged, fully managed current/historical relationships and current tree state. Any changed input invalidates approval. `--force` cannot bypass approval or adopt unknown files. Application/check failure must restore preimages transactionally.
## Evidence-based capability growth

Read [continuous-skill-evolution.md](continuous-skill-evolution.md) for capability work. Verified eligible L2/L3 product changes may produce a candidate-only completion summary. Public implementation must change semantically and verification must bind unchanged input before/after the command. Prose, formatting, fixtures, temporary scripts, read-only work, and non-reusable changes skip harvesting. No automatic promotion occurs.

Capability harvesting has no surviving command: `aicg harvest` is retired and prints a deprecation notice. Candidate Skills and `docs/ai/capability-evolution.json` remain valid governance artifacts, but no supported command creates them. When judging candidates, prefer `update-existing`, then `extend-existing`, then `create-new`, otherwise `no-skill-with-reason`. Candidate does not mean adopted or enforced.

Capability promotion (`aicg promote`) is likewise retired with no surviving command. The adoption contract still governs any manually recorded adoption. It accepts a currently detected candidate, current implementation entrypoint, and a discovered command that actually passes. Consumer paths remain declared/unverified; adoption does not establish real-client loading or bypass enforcement. Drift leaves a review item rather than silently upgrading an adopted Skill.
## Conditional specialist work

- **Technical standards:** read [stack-skill-generation.md](stack-skill-generation.md) only for the requested/confirmed stack. The `aicg standards` command that previewed the packaged source snapshot is retired and prints a deprecation notice; no surviving command exposes that snapshot, so use the packaged reference documents as the source. Live official-source research is distinct from offline generation. Separate `industry-standard`, `project-decision`, `business-invariant`, and `unverified`. `stack-standard-source-coverage`, `stack-skill-coverage`, and `business-pattern-routing` are scoped evidence/probe obligations, not claims that every project enforces them.
- **Workflow integration:** read [workflow-integrations.md](workflow-integrations.md), using [workflow-integration-registry.json](../../../assets/registries/workflow-integration-registry.json). OpenSpec and explicitly selected project providers are optional. Preserve `change-authority-single-source`; claim `selective-execution-capability` only with actual runtime evidence.
- **Release:** read [release-acceptance.md](release-acceptance.md) for explicit release work. Routine engineering publication proves the configured local suite, clean Git candidate, and npm package shape without claiming organizational certification. `aicg release-check` remains the explicit independent-review certification path, uses [release-acceptance-policy.json](../../../assets/policies/release-acceptance-policy.json) on first use, and replay requires exact approval. No routine startup release or automatic publishing.
- **Team advice:** `aicg team` is retired and prints a deprecation notice; no surviving command emits human-role advice. [team-role-registry.json](../../../assets/registries/team-role-registry.json) remains the reference for reading roles by hand. Any such advice stays read-only with explicit `teamScope: "human"` and business context; it does not create people, tasks, permissions, or messages.
- **Capability/platform coverage:** [capability-pack-registry.json](../../../assets/registries/capability-pack-registry.json) distinguishes detection from certification for React, Vue, Angular, Node.js, Java, and later Android/iOS and other families. Scope macOS, Windows, and Linux evidence separately.

The evolution probe names `feature-skill-harvest-freshness`, `capability-promotion-evidence`, `skill-implementation-drift`, and `canonical-capability-reuse` identify separate obligations. Do not claim they are enforced in a target repository merely because these names exist.
## Repository self-governance

This repository is public and ships as an npm package. Working notes (plans, reviews, reports, pilots, design drafts) belong under `local/`, which is git-ignored and excluded from the package. Never commit or pack absolute home paths, private project codenames, internal organization or repository names, or private contact details; describe design generically in code comments, tests, fixtures, and docs. The npm `files` field is an explicit allow list — a broad directory there cannot be narrowed again by `.npmignore`. `scripts/public-surface-check.mjs` enforces this over both the Git tracked set and the npm pack set and runs inside `npm run validate`. Read [public-surface-hygiene.md](public-surface-hygiene.md).
## Verification and handoff

Preserve unrelated work. For machine behavior, use a failing reproduction and targeted regression checks at the affected public interface. Use TDD when it fits the selected workflow. Choose focused checks for documentation/template changes; full candidate, performance and package checks apply only to integration or explicitly authorized release work:

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

Separate `stated`, `reachable`, `enforced`, and `verified`. Structural tests prove file/routing contracts; negative probes prove only their named machine checks. Real-client loading and Windows execution remain `not yet verified` without current runs; Linux is covered by the manual full CI matrix. Do not convert a macOS result or synthetic project into production readiness.

The [reference map](README.md) links the principles, historical layers, optional memory/task runtime, cross-platform and specialist protocols. Load only what the chosen capability needs; historical capability descriptions do not override this adaptive runtime contract.

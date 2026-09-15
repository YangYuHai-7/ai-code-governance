---
name: ai-code-governance
description: >-
  Initialize or extend repository governance for AI coding agents with the cross-platform aicg CLI: scan real projects, select supported Agents, choose governance language, route tasks by impact, and maintain canonical rules and verified capability candidates. Use for AI 编码治理框架, AI 代码治理框架, 代码治理框架, aicg init, or repository AGENTS.md/skills/gates governance requests. Do not use for product AI safety, model risk, privacy, or regulatory governance unless the request also concerns coding agents.
---

# AI Code Governance

Deliver one canonical rule source, the smallest relevant context route, and machine checks with honest evidence boundaries. Use the current CLI as the default implementation. Read [initializer.md](references/initializer.md) before initializing or changing managed artifacts.

## Trigger and scope

Treat explicit governance phrases such as `AI 编码治理框架`, `代码治理框架`, `Agent 治理框架`, and `aicg init` as task intent. The bare phrase `治理框架` requires repository/coding-agent context. Product AI safety and regulatory questions are outside this Skill.

A vague request does not choose Complete. Scan first, then recommend Minimal or Standard from actual project evidence and owner needs. Respect an explicit preset, client choice, language, or already approved plan. The twelve-layer reference model is a capability catalog; it is not a required task sequence or a promise to generate all layers.

## Installation: Agent-first, artifact-language-second

1. Scan repository files before questions: lifecycle/topology, manifest/lockfiles, exact stacks, scripts, existing adapters, canonical rules, and selected workflow evidence. Filesystem discovery does not execute Git, Agents, or project scripts; `aicg doctor .` reports executable availability separately.
2. First visible decision: supported Agents. Offer Codex, Claude Code, Cursor, generic, or a combination. Current client and existing files do not decide support. Use `--clients all` only for an owner-selected built-in scope; `--yes` cannot supply it.
3. Second visible decision: `artifactLanguage: en` by default, or `zh-CN`. Interaction follows `--locale`/`interactionLanguage` independently. Explicit Chinese governance selection generates Chinese prose; English IDs, paths, commands, and keys remain stable. Legacy `bilingual` stays readable. This repository's own documentation/comments default to English under its instructions.
4. Confirm lifecycle. Existing projects confirm or correct detected stacks; greenfield selects target stacks. Treat manifest-only or unknown product files as potentially ambiguous. Record greenfield architecture as `not-established`, with an evidence gap; do not invent a proven module pattern.
5. Existing projects choose `keep-existing`, `new-code-standard`, or `staged-migration`. Preserve current code. Modernization requires a separate plan. `codeDocumentationPolicy` defaults to `inherit-existing` for existing projects and `en` for greenfield.
6. Recommend the smallest justified preset. Guided onboarding defaults to Minimal; advanced/config defaults retain Standard. Complete does not implicitly enable memory, task runtime, hooks, CI, or external workflows; guided features stay off unless explicitly configured.
7. Choose invocation, preview writes/keeps/conflicts/retained artifacts, and apply the user's authorization. Recommend project-local only with a usable package executable. Generated daily local invocation is `npm exec -- aicg check .` with that installation; daily global invocation needs an installed `aicg`. Pinned npm bootstrap can resolve a package and does not install the daily CLI.

```bash
aicg init . --guided
aicg check .
aicg sync .
```

Configuration carries decisions. Noninteractive writes require `--yes`; request-based writes require the exact current `--approve <planHash>`. Reuse existing authorized decisions rather than asking them again. Optional AI assistance applies only to high-confidence greenfield with a selected available Agent; failure leaves that phase unverified without rolling back valid deterministic initialization.

## Runtime routing: L0, L1, L2, L3

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

The command checks Git evidence against the declared level. Under-declaration blocks completion and product command execution. Missing declaration remains `unverified-declaration`. Omit `--verify` when no product script was requested; only a discovered safe npm script is accepted. Completion itself writes no Skill, manifest, registry, or memory; the explicitly selected project script can have effects. Installed pre-commit hooks check only an isolated staged snapshot, without product scripts or harvest writes.

## Canonical ownership and small context

Keep `docs/ai` as the canonical source and `.ai-governance/manifest.json` as ownership/hash evidence. Use native imports or generated ordinary files; never create symlink/junction adapters. Agent details belong to [agent-registry.json](assets/registries/agent-registry.json).

Minimal selects the kernel; Standard adds routing/policy; Complete adds selected stack Skills. Lifecycle/integrations remain optional. Release/acceptance/surface policies activate on first use and results require actual evidence. Ordinary startup loads only `AGENTS.md`, the selected `context-map.yaml` slice, and `00_always.mdc`. Architecture, business, standards, harvest, hooks, reports, and release material stay outside this closure. Resolve adapters to canonical paths and hashes before counting context.

Ordinary sync is zero-delete, even when a newer preset omits legacy artifacts. Keep seed, unknown, edited, drifted, historical, and dormant evidence content. Physical removal is a separate exact-plan action:

```bash
aicg sync . --prune --dry-run
aicg sync . --prune --approve <planHash>
```

Prune requires trusted, unchanged, fully managed current/historical relationships and current tree state. Any changed input invalidates approval. `--force` cannot bypass approval or adopt unknown files. Application/check failure must restore preimages transactionally.

## Evidence-based capability growth

Read [continuous-skill-evolution.md](references/continuous-skill-evolution.md) for capability work. Verified eligible L2/L3 product changes may produce a candidate-only completion summary. Public implementation must change semantically and verification must bind unchanged input before/after the command. Prose, formatting, fixtures, temporary scripts, read-only work, and non-reusable changes skip harvesting. No automatic promotion occurs.

Explicit `aicg harvest . --dry-run --json` previews discovery and does not claim tests ran. Explicit approved harvest can record candidate Skills and `docs/ai/capability-evolution.json`. Prefer `update-existing`, then `extend-existing`, then `create-new`, otherwise `no-skill-with-reason`. Candidate does not mean adopted or enforced.

`aicg promote . --id <capability> --entrypoint <path> --verify "npm run <script>" --yes` is a separate action. It accepts a currently detected candidate, current implementation entrypoint, and a discovered command that actually passes. Consumer paths remain declared/unverified; adoption does not establish real-client loading or bypass enforcement. Drift leaves a review item rather than silently upgrading an adopted Skill.

## Conditional specialist work

- **Technical standards:** read [stack-skill-generation.md](references/stack-skill-generation.md) only for the requested/confirmed stack. `aicg standards . --json` previews the packaged source snapshot. Live official-source research is distinct from offline generation. Separate `industry-standard`, `project-decision`, `business-invariant`, and `unverified`. `stack-standard-source-coverage`, `stack-skill-coverage`, and `business-pattern-routing` are scoped evidence/probe obligations, not claims that every project enforces them.
- **Workflow integration:** read [workflow-integrations.md](references/workflow-integrations.md), using [workflow-integration-registry.json](assets/registries/workflow-integration-registry.json). OpenSpec/Superpowers and other providers are optional. Preserve `change-authority-single-source`; claim `selective-execution-capability` only with actual runtime evidence.
- **Release:** read [release-acceptance.md](references/release-acceptance.md) for explicit release work. `aicg release-check` uses [release-acceptance-policy.json](assets/policies/release-acceptance-policy.json) on first use, and replay requires exact approval. No routine startup release or automatic publishing.
- **Team advice:** `aicg team . --config team-context.json --json` uses [team-role-registry.json](assets/registries/team-role-registry.json). It is read-only human-role advice with explicit `teamScope: "human"` and business context; it does not create people, tasks, permissions, or messages.
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

The [reference map](references/README.md) links the principles, historical layers, optional memory/task runtime, cross-platform and specialist protocols. Load only what the chosen capability needs; historical capability descriptions do not override this adaptive runtime contract.

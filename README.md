<div align="center">

# AI Code Governance

**Adaptive governance for AI coding agents — fast for small fixes, deliberate for business-critical changes.**

<p>
  <strong>English</strong> · <a href="docs/zh-CN/README.md">简体中文</a>
</p>

[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](LICENSE)
[![CI: Manual](https://img.shields.io/badge/CI-manual-6f42c1?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)
[![Agents](https://img.shields.io/badge/Agents-Codex%20%7C%20Claude%20Code%20%7C%20Cursor-111827)](SKILL.md)

One canonical rule source · Small context by default · Evidence before claims · No automatic over-governance

</div>

> [!IMPORTANT]
> This checkout is the `0.3.0` source candidate. Source version, npm publication, platform certification, and real-client execution are separate evidence states.

<!-- sync:quick-start -->
## Quick start

Install once with Node.js 22 or newer, then run one command in the project you want to govern:

```bash
npm install --global ai-code-governance
aicg
```

No global install is required for a one-off run: use `npx ai-code-governance`. With no arguments, `aicg` scans the current directory and starts the guided setup in the detected terminal language. It asks for supported Agents, governance language, project stage, and only the choices that matter, then previews writes before applying them. Governance artifacts still default to English until the owner selects Simplified Chinese.

Prefer chat? Tell Codex, Claude Code, Cursor, or another shell-capable coding Agent: “Use the installed `aicg` CLI to initialize AI code governance for this project. Scan first, ask me only for decisions I must own, and preview changes before writing.” The Agent operates the CLI; the user does not need to learn advanced flags.

<!-- sync:why-aicg -->
## Why AICG

| | Capability | What it changes |
| --- | --- | --- |
| ⚡ | **Adaptive flow** | L0/L1 work stays lightweight; L2/L3 adds approval and evidence only when impact justifies it. |
| 🧭 | **Small context routing** | Agents load the canonical entry and only the relevant context slice instead of the entire governance library. |
| 🧩 | **Project-aware setup** | Existing repositories retain their stack and conventions; greenfield projects record unestablished architecture honestly. |
| 👥 | **Dynamic expertise** | Technical and domain roles are recommended from project evidence, then explicitly accepted, deferred, or rejected by the owner. |
| 🔒 | **Bounded authority** | Recommendations do not install Skills, activate roles, run commands, push, publish, or deploy. |
| ✅ | **Verifiable outcomes** | Machine gates distinguish guidance that is stated, reachable, enforced, and actually verified. |

AICG is a repository governance CLI and Agent Skill. It supports new and legacy projects across stacks such as React, Vue, Angular, Node.js, and Java, while keeping macOS, Windows, and Linux evidence separate from marketing claims.

<!-- sync:how-it-works -->
## How it works

```text
Scan repository → Confirm owner choices → Generate the smallest governance set → Route each task by impact
```

1. **Discover** — inspect lifecycle, development units, manifests, exact stacks, scripts, existing Agent adapters, rules, and workflow evidence without executing project code.
2. **Decide** — choose supported Agents, governance language, test-case format and location, lifecycle, and migration policy.
3. **Generate** — maintain one canonical source under `docs/ai`, per-unit development baselines for existing projects, README entrypoints, ordinary adapters, an ownership manifest, and only selected capabilities.
4. **Route** — answer simple questions directly, verify small changes locally, and reserve formal approval and broader evidence for higher-impact work.

English is the default artifact language. Selecting `zh-CN` generates Chinese governance prose while keeping IDs, paths, commands, and schema keys stable. Conversation language and artifact language remain independent.

<!-- sync:task-routing -->
## Adaptive task routing

| Level | Use when | Required flow |
| --- | --- | --- |
| **L0** | Explanation, discovery, review, or status | Read the minimum evidence and answer. No governance subprocess, plan, test, or harvest. |
| **L1** | Documentation, tests, governance files, formatting, or low-risk non-production changes | Locate, clarify material ambiguity, edit, run targeted verification, and perform one completion check. |
| **L2** | Product behavior, business rules, public contracts, or multi-module delivery | Confirm requirements and approve one implementation plan, then implement and verify the complete behavior. |
| **L3** | Architecture, migration, multiple surfaces, external effects, or high-consequence risk | Approve requirements, design, and plan, then perform integrated implementation and verification. |

Classification combines mutation, scope, risk, and clarity; sentence length does not determine process depth. A feature remains one vertical work unit across UI, API, service, data, and tests — endpoints and individual test cases do not become separate governance tasks.

<!-- sync:onboarding -->
## Project onboarding

Installation is **Agent-first** and **artifact-language-second**. The stored `artifactLanguage` defaults to `en`; selecting `zh-CN` changes governance prose without changing machine identifiers. The first visible decisions are:

1. **Agent support** — select the clients the project will actually support. Existing files are evidence, not automatic consent.
2. **Artifact language** — `en` is default; `zh-CN` is explicit. Legacy `bilingual` configuration remains readable.
3. **Test-case output** — choose compact `aicg-json-v2` (recommended) or a readable Markdown baseline plus schema-v2 JSON, and choose its repository-relative directory.
4. **Project lifecycle** — existing repositories confirm detected stacks; greenfield repositories select target stacks without pretending architecture already exists.
5. **Existing-code policy** — choose `keep-existing`, `new-code-standard`, or `staged-migration`. Initialization never silently modernizes product code.
6. **Preset** — start with Minimal or Standard from evidence. Complete is opt-in, never the default consequence of a vague request.
7. **Optional capabilities** — memory, hooks, CI, workflows, Skills, and specialist roles remain separate choices.

Repository families use one exact, reviewable plan while retaining autonomous member ownership:

```bash
aicg init . --family --yes --clients codex --no-assist --dry-run
aicg init . --family --yes --clients codex --no-assist --approve <planHash>
```

The combined plan binds the orchestrator and every detected member. Member repositories are applied before the orchestrator, parent manifests never own member files, and a failed apply or post-check rolls the entire family back.

Existing projects receive `docs/ai/development/index.json`, one evidence baseline per detected development unit, and a short managed entrypoint in each unit README. The `brownfield-understanding` Skill tells an Agent to complete one unit at a time from code/test evidence, keep unknowns unverified, and extract only stable decision surfaces into project Skills. Implementation Skills require correct, incorrect, and exception code shapes; workflow Skills require an executable flow.

Standard and Complete governance also generate an expanded `professional-testing` Skill. It uses stable Case IDs, shared context, minimal AI execution packets, evidence-bound PASS/FAIL, an idempotent result ledger, automatic `NOT_RUN`, and ledger-derived reports. Automated, AI-simulated-human, and real-user evidence remain separate.

```bash
aicg test-case init . --scope ACCOUNT --format aicg-json-v2 --output docs/ai/testing --yes
aicg test-case validate . --manifest docs/ai/testing/ACCOUNT-test-cases.json
aicg test-case select . --manifest docs/ai/testing/ACCOUNT-test-cases.json --cases ACCOUNT-TC-001 --output reports/testing/ACCOUNT-packet.json
aicg test-case record . --manifest docs/ai/testing/ACCOUNT-test-cases.json --packet reports/testing/ACCOUNT-packet.json --results reports/testing/ACCOUNT-external-results.json
```

| Preset | Fresh default selection |
| --- | --- |
| **Minimal** | Config, shared entry, canonical overview, context map, always rules, manifest, and selected Agent adapters |
| **Standard** | Minimal plus routing, verification guidance, decision ledger, local report paths, and relevant policy/standard Skills |
| **Complete** | Standard plus selected stack Skills; task runtime, hooks, CI, workflow bridges, and other integrations remain optional |

<!-- sync:skills-and-team -->
## Skill discovery and dynamic teams

Offline discovery previews at most five bounded Skill candidates and a project-specific roster. Technical roles come from architecture and delivery needs; domain roles come from business context — for example, legal work can require a qualified lawyer and restaurant software can require restaurant operations expertise.

```bash
aicg init . --yes --config decisions.json --dry-run
aicg init . --yes --config decisions.json --approve <planHash>
```

Every recommendation carries source status, permissions, cost, and an explicit `add`, `defer`, or `reject` decision. No candidate is preselected. Agent roles contribute competing professional views, but role IDs do not prove participation and AI never replaces a qualified human professional.

Minimal emits no management artifacts. Approved Standard/Complete selections stay within file, byte, and manager-context budgets. Historical or edited artifacts are retained by ordinary sync; deletion requires a separate exact-plan approval.

<!-- sync:vertical-delivery -->
## One feature, one delivery boundary

L2/L3 production delivery uses one bounded document that covers the complete feature. The [work-unit schema](assets/contracts/work-unit-schema.json) binds scope, success and failure cases, applicable QA cases, public API/method testability, references, memory impact, and required roles to one approval hash.

```bash
aicg work-unit plan . --work-unit docs/ai/feature.json --json
aicg complete . --task-level L2 --work-unit docs/ai/feature.json --approval-evidence docs/ai/approval.json --approve <planHash> --verify "npm run verify" --json
```

Verification runs once at the feature boundary. Required cases report structured `AICG_QA_RESULT` markers; missing, duplicate, unknown, blocked, or failed required cases prevent completion. Stored evidence is checked later without rerunning the product suite. A changed requirement, case, command, scope, or input invalidates the previous approval.

Unsupported languages or configuration formats do not bypass the gate. When static coverage cannot be derived, the owner provides an approval-bound manual inventory or a reasoned no-public-surface declaration.

<!-- sync:safe-maintenance -->
## Safe maintenance and explicit release

Ordinary sync is zero-delete. It keeps historical seeds, unknown files, edited artifacts, dormant evidence, and content omitted by a newer preset. Physical pruning is a distinct reviewed transaction:

```bash
aicg sync . --prune --dry-run
aicg sync . --prune --approve <planHash>
```

Only trusted, unchanged, fully managed relationships are eligible. `--force` cannot bypass approval, and a changed input invalidates the plan hash. Failed application or checking restores the prior tree transactionally.

Release checks load only for explicit release work:

```bash
aicg release-check . --type feature --evidence docs/ai/release-evidence/candidate.json --json
aicg release-check . --type feature --evidence docs/ai/release-evidence/candidate.json --replay --approve <planHash>
```

Pushing, publishing, deployment, hook installation, external messages, and CI changes remain separate authorizations.

<!-- sync:evidence -->
## Evidence, growth, and performance

| State | Meaning |
| --- | --- |
| `stated` | Guidance exists; behavior has not been established. |
| `reachable` | A checked entry or profile resolves the canonical artifact. |
| `enforced` | A named machine check and negative probe reject a broken assertion. |
| `verified` | A named command, candidate, scope, platform, and result have current execution evidence. |

Eligible, verified L2/L3 product changes may produce capability candidates. Prose, formatting, fixtures, read-only work, and non-reusable changes do not. Harvesting, adoption, and promotion are separate explicit steps.

Deterministic fixtures enforce file and byte budgets. Ordinary context is exactly three unique files, at most 3,600 bytes and 900 estimated tokens. Performance sampling keeps absolute limits for small and 10k-file checks and treats the 50k case as informational. These synthetic results do not certify real Agent loading or every operating system.

<!-- sync:validation -->
## Contributor validation

Use the smallest command that proves the change locally. GitHub Actions is manual-only: choose `fast` for routine validation or `full` for the cross-platform matrix after local checks are green.

```bash
npm run test:fast
npm run test:full
npm run validate
npm run smoke
npm run smoke:package
node scripts/prepublish-check.mjs
npm pack --dry-run
```

`test:full` includes the performance sampler. Routine npm publication runs the full local suite, validates a clean Git candidate, and checks the actual packed artifact. Providing all organizational release variables opts into the separate independent-review evidence gate; partial evidence input fails closed. Neither path turns a local run into Windows/Linux or real-client certification.

<!-- sync:architecture -->
## Architecture and documentation

```text
bin → src/cli → src/modules → src/kernel + src/shared
```

All project documentation is managed under `docs/`: localized user documentation under language folders and maintainer-only material under `docs/internal`. The root keeps only the default English README. Adapters isolate external effects; catalogs load versioned assets; root `src/*.mjs` files are compatibility facades.

- [Agent Skill](SKILL.md)
- [Initializer contract](docs/internal/reference/initializer.md)
- [Capability evolution](docs/internal/reference/continuous-skill-evolution.md)
- [Capability and platform registry](assets/registries/capability-pack-registry.json)

<!-- sync:license -->
## License

[Apache-2.0](LICENSE)

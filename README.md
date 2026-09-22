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
> This checkout is the `0.5.0` source candidate. Source version, npm publication, platform certification, and real-client execution are separate evidence states.

<!-- sync:quick-start -->
## Quick start

Pick one of two paths. Both run `aicg` directly; they differ only in who supplies the answers.

**Path A — chat (no configuration file at all):** open your AI coding assistant in the project folder and tell it:

> Use the installed `aicg` CLI to set up AI code governance for this project. Run `aicg` so it scans first and asks me only the questions that require an owner decision. Preview changes before writing anything.

`aicg` reads the terminal language, detects the project type and stack, then asks the few questions that need your sign-off — supported Agents, governance language, project stage, and what to do with existing code. Everything else uses scan-backed defaults. The exact plan is previewed before any file is written.

**Path B — one CLI command in the terminal:**

```bash
npm install --global ai-code-governance
cd /path/to/project
aicg
```

Same default as Path A — guided prompts in the detected terminal language, scan-first, preview-before-write.

**Path C — scripted or non-interactive (for automation):**

```bash
aicg init . --yes
```

`--yes` skips every prompt and applies the conservative scan-backed defaults. Use this in CI, in `package.json` postinstall, or any time you want zero human input. Re-run it after installing to pick up new defaults; it is idempotent.

**No global install?** Use `npx ai-code-governance` instead. Same behavior.

**What `aicg` will ask you (and what it will not):**

| Asked | Default if you press Enter |
| --- | --- |
| Which Agents should this project support? | Detected from existing files, otherwise Codex |
| Governance artifact language? | English (Chinese only if you pick it) |
| Is this a new project or an existing one with code? | Detected from the scan |
| Which technology stacks apply? | Detected from `package.json`, manifests, and source files |
| What should new governance do with existing code? | Keep existing code unchanged |
| Anything else (skills, hooks, CI, depth) | Off unless explicitly turned on |

Everything not on that list stays at a safe default. The exact plan, with every file the run would write, is shown before anything touches disk.

Set `AICG_NO_AUTO_OPEN=1` before installation to suppress any best-effort browser launch.

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

<!-- sync:what-each-file-does -->
## What each generated file is for

`aicg init` writes a small tree under `docs/ai/`, `.ai-governance/`, and the Agent adapter folders. Every file earns its place because a coding Agent reads it before it acts. None of them are decoration.

| File | Why a coding Agent reads it | What fails without it |
| --- | --- | --- |
| `docs/ai/context-map.yaml` | The first read on every request. Tells the Agent what is in the repo, how modules relate, and whether it is a single repo or a family of repos. | The Agent explores blindly and wastes context. |
| `docs/ai/decision-ledger.json` | Records every "why this config" decision so the Agent does not reverse a human call later. | The Agent re-asks the same question or changes settings you already chose. |
| `docs/ai/task-routing-policy.json` | Maps a change to L0/L1/L2/L3 and decides how many approvals are required. | The Agent either over-processes trivial edits or under-processes risky ones. |
| `docs/ai/architecture-profile.json` + `rules/15_architecture.mdc` + `module-graph.json` | Architecture image plus the rule reminder plus the module dependency graph. Locks which directories belong to which layer and forbids downward dependencies. | The Agent writes business logic in a utility folder or lets pages import services. |
| `docs/ai/business-constraints/` | Your business rules (for example "order totals must reconcile with payments before confirmation"). The Agent reads these before any business change. | The Agent ships a change that breaks an invariant you already stated. |
| `docs/ai/technical-standards/` | Industry standard snapshots (accessibility, secure coding, logging, and similar). Read before code is written. | The Agent writes code that follows its own habits but not the standards your team committed to. |
| `docs/ai/project-conventions/` | Project-specific conventions harvested from your code: one Skill per service, HTTP entrypoint, data contract, or layout group. Each Skill includes Usage and Correct/Incorrect implementation shapes that cite real evidence paths, never line numbers. | The Agent does not know where new files belong or how to name them. |
| `docs/ai/anti-patterns.md` | The "do not write it like this" list. Explicit anti-patterns recorded as evidence. | The Agent re-invents mistakes you already paid to learn. |
| `docs/ai/lifecycle.md` | The fixed flow that takes one feature from requirement to verified result. | The Agent writes code but skips the requirement, plan, or verification boundary. |
| `docs/ai/hooks.md`, `docs/ai/ci-integration.md`, `docs/ai/workflow-integrations.yaml` | **Candidate** integrations. Hook installation is only marked `enforced` after a real client entrypoint calls `aicg check` and a negative probe passes. CI integration is `enforced` only after the same on the real CI runner. | You think installing the file equals wiring it up. It does not — the file stays `unverified` until the real system replays it. |

**About the SHA-256 fields in `.ai-governance/manifest.json`.** Each managed file has a `sha256` field that fingerprints the content `aicg init` produced. `aicg check` recomputes that hash from the file on disk and flags `managed content drifted` when they stop matching. `--enforce` turns the flag into a nonzero exit code. The hash is not redundant; it is the only thing the gate can compare cheaply on every run. Deleting and regenerating the hash on every check would be slower, not faster.

**About the confirmation prompt.** A fresh `aicg` run asks once before the first write because the preview must be human-readable and the plan hash binds it to the file set. Subsequent `aicg sync` calls are zero-delete by default — they never prompt, never overwrite a managed file that drifted, and never remove anything you have not explicitly pruned. Physical pruning is the only step that asks again, because deletion is irreversible.

1. **Agent support** — select the clients the project will actually support. Existing files are evidence, not automatic consent.
2. **Artifact language** — `en` is default; `zh-CN` is explicit. Legacy `bilingual` configuration remains readable.
3. **Test-case output** — choose compact `aicg-json-v2` (recommended) or a readable Markdown baseline plus schema-v2 JSON, and choose its repository-relative directory.
4. **Project lifecycle** — existing repositories confirm detected stacks; greenfield repositories select target stacks without pretending architecture already exists.
5. **Existing-code policy** — choose `keep-existing`, `new-code-standard`, or `staged-migration`. Initialization never silently modernizes product code.
6. **Preset** — start with Minimal or Standard from evidence. Complete is opt-in, never the default consequence of a vague request.
7. **Optional capabilities** — memory, hooks, CI, workflows, Skills, and specialist roles remain separate choices.

For repeatable setup, open the local visual editor from any directory and select a project on the page. Recent projects, an absolute-path field, and a folder browser are available; passing a path opens that project directly. It uses the same `aicg.config.json` as the CLI, offers explained choices, and can import or download JSON for sharing. An interactive npm installation (project-local or global) attempts to open the project picker automatically; if npm skips installation scripts or a browser is unavailable, open it manually. The page listens only on `127.0.0.1`. Uploaded JSON stays in the form until validated and saved; applying governance requires a fresh exact-plan preview and explicit confirmation.

```bash
aicg config open
aicg config open /absolute/path/to/project
```

For folder drag-and-drop, install an OS-native Desktop launcher once with `aicg config launcher --yes`. Drag a project folder onto **AICG Configure** to open that project's visual configuration. macOS uses a `.app` droplet, Windows a `.cmd` file, and Linux a `.desktop` entry with a shell helper. Double-clicking the launcher opens the project picker. Use `--output /absolute/directory` if your Desktop is elsewhere. Installation is create-only: reruns keep an identical launcher and refuse to replace modified or foreign files. On Linux, the file manager may require marking the `.desktop` entry as trusted. The browser page itself cannot recover a dropped folder's absolute disk path; use this desktop launcher or the existing folder browser.

Alternatively, generate an editable configuration file. The template uses conservative scan-backed defaults, selects only Codex initially, and keeps all owner decisions visible. Review the file before validation; an ambiguous repository still requires an explicit lifecycle decision.

```bash
aicg config init . --output aicg.config.json --yes
aicg config validate . --config aicg.config.json --json
aicg init . --config aicg.config.json --yes --dry-run
```

`config init` creates only a missing file. An identical retry is reported as unchanged; different existing content, symlinks, unsafe paths, and `.git` destinations are rejected. `config validate` is read-only and builds the same effective initialization plan as `init`. Set `AICG_NO_AUTO_OPEN=1` before installation to suppress the best-effort browser launch.

Repository families use one exact, reviewable plan while retaining autonomous member ownership:

```bash
aicg init . --family --yes --clients codex --no-assist --dry-run
aicg init . --family --yes --clients codex --no-assist --approve <planHash>
```

The combined plan binds the orchestrator and every detected member. Member repositories are applied before the orchestrator, parent manifests never own member files, and a failed apply or post-check rolls the entire family back.

Existing projects receive `docs/ai/development/index.json`, one evidence baseline per detected development unit, and a short managed entrypoint in each unit README. Use `aicg init ... --assist <selected-agent>` to have the selected Agent complete the `brownfield-understanding` workflow: record existing business behavior in Memory, complete code-backed development docs, and propose stable project Skills for approval. `aicg check --json` reports `brownfield.gaps`; a scan baseline is not semantic completion. Implementation Skills require correct, incorrect, and exception code shapes; workflow Skills require an executable flow.

AICG checks default to advisory exit code 0 and write JSON findings under `reports/aicg/`. Pass `--enforce` to opt into a nonzero exit code for failed findings. The installed pre-commit hook uses the advisory default.

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

<!-- sync:clients-and-footprint -->
## Clients, canonical layout, and evidence states

Every selected client reads the same canon: `docs/ai/`, `.ai-governance/config.json`, and `.ai-governance/manifest.json`. Client files are thin generated projections, never independently edited rule copies. `--clients all` selects `codex`, `claude-code`, `cursor`, and `github-copilot`; an existing configuration keeps the clients it already recorded and is never silently widened. GitHub Copilot reads `.github/copilot-instructions.md` and `.github/skills/`, both derived from the canon; AICG does not enable Copilot custom agents, prompts, hooks, MCP servers, or GitHub Actions by default.

`governanceFootprint` records the layout. New projects start `compact`: `docs/ai/` keeps only `README.md` and `context-map.yaml`, machine ledgers move to `.ai-governance/state/`, and policy, routing, evidence, and integration material lives in its topic directory. The flat paths in the table above are the `preserve` layout that existing projects keep. An ordinary `sync` never moves, overwrites, or deletes a preserved file. To converge an existing project, preview with `aicg sync . --prune --dry-run`, read every candidate's old path, new path, source, hash, references, and classification (`required`, `reachable`, `dormant-managed`, `historical-or-user`), then approve that exact plan. Links, drifted files, owner edits, and unknown content are never automatic targets; they stay as manual cleanup candidates.

`aicg check` reports each client as `declared`, `projected`, `checked`, and `runtime-verified`, and they are independent. `checked` means the managed projections match the canon structurally; it never means a client loaded them or that a model obeyed them. `runtime-verified` requires a matching real probe receipt in `.ai-governance/state/client-runtime-verifications.json`; without a recorded probe the state stays unverified, and `aicg check` never launches a client to manufacture one.

<!-- sync:onboarding -->
## Project onboarding

After the quick start, the storage backend is one `aicg.config.json` at the project root plus the generated tree under `docs/ai/` and `.ai-governance/`. Installation is **Agent-first** and **artifact-language-second** — the supported Agents are picked before the artifact language, and the stored `artifactLanguage` defaults to `en`; selecting `zh-CN` changes governance prose without changing machine identifiers. Common follow-up choices:

1. **Open the local visual editor** — the page reads and writes the same `aicg.config.json`, explains each choice inline, and lets you import or export JSON for sharing.

```bash
aicg config open
aicg config open /absolute/path/to/project
```

2. **Install a Desktop launcher once** for drag-and-drop project folders:

```bash
aicg config launcher --yes
```

macOS uses a `.app` droplet, Windows a `.cmd` file, and Linux a `.desktop` entry with a shell helper. Use `--output /absolute/directory` if your Desktop is elsewhere. The launcher never replaces a modified file of its own.

3. **Or work from a saved JSON file directly.** The template uses conservative scan-backed defaults, keeps every owner decision visible, and is the format you would check into version control:

```bash
aicg config init . --output aicg.config.json --yes
aicg config validate . --config aicg.config.json --json
aicg init . --config aicg.config.json --yes --dry-run
```

`config init` creates only a missing file. An identical retry reports `unchanged`; foreign files, unsafe paths, and `.git` destinations are rejected. `config validate` is read-only and builds the same effective plan as `init`.

5. **Repository families** (a root plus 1-level sub-projects) use one exact, reviewable plan while each member stays autonomous:

```bash
aicg init . --family --yes --clients codex --no-assist --dry-run
aicg init . --family --yes --clients codex --no-assist --approve <planHash>
```

The combined plan binds the orchestrator and every detected member. Members apply before the orchestrator, parent manifests never own member files, and a failed apply or post-check rolls the family back.

6. **Existing-code brownfield** — a repository with working code also gets `docs/ai/development/index.json`, one evidence baseline per detected development unit, and a short managed entrypoint in each unit README. Use `aicg init ... --assist <selected-agent>` so the selected Agent completes the `brownfield-understanding` workflow. `aicg check --json` reports `brownfield.gaps`; a scan baseline is not semantic completion.

`aicg check` defaults to advisory exit code 0 and writes JSON findings under `reports/aicg/`. Pass `--enforce` for a nonzero exit on failed findings. The installed pre-commit hook uses the advisory default.

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

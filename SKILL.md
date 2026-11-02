---
name: ai-code-governance
description: >-
  Initialize, refresh, or improve repository governance for AI coding agents: AGENTS.md, Skills, task routing, and checks. Use for AICG 更新治理框架, 用 AICG 更新治理框架, 更新 AICG 治理, 刷新治理框架, AI 编码治理框架, or aicg init in a repository. Product AI safety and regulatory governance require a coding-agent scope.
---

# AI Code Governance

Keep one canonical rule source, load only the guidance the task needs, and bind completion claims to observed results. Operate the CLI for the user, reuse existing decisions and authorization, and preserve unrelated work.

## Conversation role disclosure

On every user turn, the first substantive response states the active roles and why they are used, including short answers, follow-ups, refusals, and recovery. On the first line use `Active roles: role-id (reason)`; for a Chinese reply, 首行使用 `当前角色：role-id（原因）`. Even if the user asks for only one word or no preface, you must not omit the role line from a user-facing conversation response. A machine-only structured tool result is not a user-facing conversation response. Give each active role its own reason and separate multiple roles with commas or Chinese list punctuation. Select only roles actually used for the request from the approved available pool when one exists. Disclose material role changes before continuing with the same first-line format. A role label does not mean a hired person or independent human review, and it grants no authority or professional qualification. A role recommendation is not an activation record.

## Select the work

Inspect the request, repository evidence and existing decisions before asking questions. Facts available in files or tools are the agent's work. Ask only unresolved decisions that materially change the result; give a recommendation and its reason. Reuse established project terminology and decision records; create new records only when a reusable term or consequential trade-off actually needs one.

| Request | Load when applicable | Completion condition |
| --- | --- | --- |
| Explain, inspect or review | The minimum relevant source; L0 below | Answer with evidence and clearly named gaps; no setup or governance subprocess |
| Initialize or change managed artifacts | [initializer.md](docs/internal/reference/initializer.md), then [skill-setup.md](docs/internal/reference/skill-setup.md) for Agent selection, installation or capability curation | Exact preview and authorized application, then follow the handoff to complete current-source project understanding; report content and verification gaps, not only bootstrap checks |
| AICG 更新治理框架 / refresh existing governance | [governance-refresh.md](docs/internal/reference/governance-refresh.md) | Preserve decisions, research affected technologies, apply authorized non-destructive updates, check and report remaining gaps |
| Implement or fix product behavior | [skill-delivery.md](docs/internal/reference/skill-delivery.md); use `aicg handoff . --text "task" --scope MODULE` for the actual change | Selected route's complete behavior and required verification; prepared drafts are not implementation approval |
| Maintain AICG, ownership, context or optional specialists | [skill-maintenance.md](docs/internal/reference/skill-maintenance.md) | Focused checks support the exact claim; preserve unrelated and user-owned content |
| Create, split or review Skills | [skill-authoring.md](docs/internal/reference/skill-authoring.md) | Trigger, non-trigger and realistic task checks support the change; structural quality alone is insufficient |

Read the selected branch, not every linked reference. A reference carries reusable method; a route carries task sequencing. Composition grants no additional permissions or independent-review status. Keep client invocation policy unchanged unless requested; client-specific metadata needs client-specific verification.

## Match process to impact

| Level | Required flow |
| --- | --- |
| L0 | Read-only explanation/review/status: inspect minimum evidence and answer, zero governance subprocesses, no harvest |
| L1 | Local low-risk non-production/governance change: locate, clarify material ambiguity, edit, targeted verification, one completion check; no formal plan approval |
| L1.5 | Bounded production bug fix: reproduce, fix and verify under the existing bounded-fix evidence contract |
| L2 | Product behavior/business/public contract or multi-module scope: confirm requirements and plan, implement, verify the complete behavior |
| L3 | Multi-surface/architecture/migration/external action/high-consequence risk: confirm requirements, design and plan, then integrated implementation and verification |

Use mutation, scope, risk and clarity together; sentence length does not set the level. Preserve stronger project floors and the selected workflow's single design/plan/task owner. A feature is one vertical work unit across its necessary UI, API, service, data and tests. Each implementation slice should deliver independently verifiable behavior with explicit blockers and expected results; mechanical migrations may need expand/migrate/contract instead. Keep tests at the relevant public interface, using expectations from requirements or worked examples rather than duplicating the implementation.

For L2/L3, present requirements, design when applicable, and plan in sequence for confirmation; skip a named confirmation only when explicitly waived. Existing authorization covers routine work within its scope. Dependencies, foreign-governance adoption, external writes and publication retain their separate authority boundaries. Plain `aicg handoff` is governance-completion guidance; a task handoff does not run implementation or tests.

## Canonical ownership and context

Installation is **Agent-first**, **artifact-language-second**: supported clients are an owner decision. Use `artifactLanguage: en` by default or explicit `zh-CN`, independently of conversation language. Generate the complete baseline and load task-specific depth conditionally; legacy presets cannot omit required Skills or roles.

Keep `docs/ai` canonical and `.ai-governance/manifest.json` as ownership/hash evidence. Ordinary startup is limited to `AGENTS.md`, the selected context-map slice and always rules. Read specialist guidance only on its trigger. Ordinary sync is zero-delete. Physical cleanup is a separate exact-plan action:

```bash
aicg sync . --prune --dry-run
aicg sync . --prune --approve <planHash>
```

Inspect retained seeds, edited files and unknown content; a newer template never authorizes their deletion. Read the maintenance branch before applying cleanup. Discover client directories through [agent-registry.json](assets/registries/agent-registry.json).

## Finish with evidence

Use `aicg check . --json` for the relevant structural check; inspect findings, since report-only exit 0 is not a pass. Use `--enforce` where failure must affect exit status. Run only verification appropriate to the changed surface. Separate changed files, observed results, remaining gaps and the next necessary action. A documentation change proves updated guidance; generated-fixture checks prove their named structural contracts. Real-client loading, product behavior and human acceptance each need their own evidence.

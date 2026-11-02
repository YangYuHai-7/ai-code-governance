# Task delivery and verification

Load this reference only for its selected task branch. Return to [the Skill entrypoint](../../../SKILL.md) for another branch.

## Runtime routing: L0, L1, L2, L3

Architecture and business-flow documentation shares the development-guidance workflow.
Read [architecture-documentation.md](architecture-documentation.md)
when this scope is requested. Existing projects cite source and preserve authoritative
diagrams; `features.architectureDocumentation` selects an independent documentation baseline,
without authorizing business Memory enrichment. New L2/L3 projects always prepare system,
module and business-flow views plus conventions and a plan from requirements. Present the
concrete package for customer confirmation before application scaffolds, dependencies,
product configuration or implementation code. Structural readiness is not confirmation.
Reuse the existing task approval evidence for the same revision/scope; material changes
need renewed confirmation. `--yes` creates drafts only. Operator-declared receipts do not
authenticate customer identity or establish product acceptance.

For an actual development request, start with `aicg handoff . --text "task" --scope MODULE`
and include `--paths` when changed files are known. This read-only guide combines the existing
route, artifact preview and structural assessment into one next action. Reuse the same scope
on return: inspect `keep` files and authoritative references, complete targeted content gaps,
and reuse Case IDs/shared-context imports instead of generating duplicate documents. It writes
nothing, runs no tests and does not approve implementation. Missing configuration for a change stays
`needs-setup` without choosing clients; an explicitly read-only question needs no setup. Saved decisions are reused. `prepared-for-agent` means
only that the guide is available, never verified code or accepted delivery. Honor existing
authorization and ask only unresolved material decisions. Plain `handoff` retains the original
governance-completion prompt. Use `--locale zh-CN` for Chinese interaction independently of
artifact language; bounded fixes can pass the existing `--task-kind bugfix --bugfix <json>` evidence.

Use `aicg route . --text "task"` to select conditional delivery capabilities. For
business changes, use `aicg delivery prepare . --text "task" --scope MODULE --yes`
to create only missing BA, implementation-plan and module-case drafts. UI work inherits
existing design specifications or creates a baseline and preview; greenfield and L3
work add technical design and programming conventions. Complete drafts from current
project evidence before implementation. Preserve existing OpenSpec/native authority
by reference. Reuse module test actors, environments and data through schema-v2
`imports: [{path, sha256}]`; changed shared bytes require fresh selection. L0/L1 and
bounded bugfix paths remain light. Drafts never prove approval or acceptance, and this
route does not require worktrees, commits, multi-Agent execution or TDD for every task.

After completing the selected drafts, run `aicg delivery assess . --text "task" --scope MODULE`
with the same task and paths. This read-only check reports unresolved placeholders, identical
document bodies, missing BA/plan sections, design evidence links and invalid or untraceable
cases. `--enforce` returns failure for findings. `structurally-ready` is only a heuristic
content review: it does not prove business accuracy, authentic design inheritance, executed
tests or owner acceptance. Review those against actual project behavior and retain evidence.

For L2/L3 production delivery, keep one vertical feature work unit across UI, API, service, data and tests. Read the bounded [work-unit schema](../../../assets/contracts/work-unit-schema.json) only on that route. Preview with `aicg work-unit plan . --work-unit <relative-json>` and validate with `status`; neither command launches Agents. Both write local JSON reports. Bind initial success/failure cases, QA abnormal/boundary/extreme/risk applicability, canonical Memory API/public-method unit-test coverage, exact references and memory impact to the existing approval hash. A missing testability mapping, required failed/blocked/missing result, stale input or unsynchronized behavior Memory is reported as incomplete. Missing approved roles remain recommendations; role IDs do not prove participation.

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

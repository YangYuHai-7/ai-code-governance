# AICG Report Closure Implementation Plan

> **For Codex:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to execute this plan task-by-task. Apply superpowers:test-driven-development to every behavior change and superpowers:verification-before-completion before any completion claim.

**Goal:** Close N1, N4, and X1–X3 inside the AICG repository, rerun the ten simulated applications against one immutable candidate, and leave L2/L3 as executable but unperformed external-validation packages.

**Architecture:** Extend existing read-only repository assessment with evidence-bound native surface signals, extend generated governance with explicit verification and module contracts, and evaluate those contracts without converting missing environments into success. Keep owner-confirmed business/threat applicability separate from detected technical surfaces. Add an internal Project Manager role that coordinates evidence but cannot approve release or risk.

**Tech Stack:** Node.js ESM, built-in `node:test`, JSON registries/contracts, deterministic generated Markdown/YAML/JSON, project-local CLI package smoke tests.

---

## Execution Rules

- The Project Manager owns the task ledger and candidate freeze, not technical acceptance.
- Implementation owners do not perform their sole final review.
- Each behavior change follows RED → GREEN → focused regression before handoff.
- X1 must merge before X2. N1, N4, X1, and X3 can otherwise proceed independently after shared contracts are fixed.
- Do not publish or push. The final verified child commit precedes a parent gitlink-only commit.

### Task 1: Register and Validate the Internal Project Manager

**Owner:** root / Project Manager  
**Reviewer:** Principal Governance Architect

**Files:**
- Modify: `assets/registries/aicg-product-team.json`
- Modify: `src/modules/team/product-team-plan.mjs`
- Modify: `test/dynamic-team.test.mjs`
- Test: `scripts/validate-skill.mjs`

**Steps:**

1. Add failing tests that require `project-manager`, activate it for `delivery-coordination`, `risk-register-management`, and `evidence-traceability`, and reject registries that give it release acceptance, product-scope approval, or security-risk acceptance.
2. Run `node --test test/dynamic-team.test.mjs` and confirm the new assertions fail.
3. Add the core registry role, required ID, bounded capabilities, and independence from `adversarial-evaluation-release-engineer` where both roles are active.
4. Keep `assets/registries/team-role-registry.json` unchanged and assert that customer-project recommendations do not silently gain the internal role.
5. Run `node --test test/dynamic-team.test.mjs test/team-recommendation.test.mjs` and `node scripts/validate-skill.mjs`.

### Task 2: Close Existing Evidence-Integrity Defects

**Owner:** core_runtime_fixes  
**Reviewer:** onboarding_flows

**Files:**
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `src/modules/governance/business-constraints.mjs`
- Modify: `src/modules/governance/checker.mjs`
- Modify: `src/modules/completion/production-readiness.mjs`
- Modify: `test/generation.test.mjs`
- Modify: `test/commit-completion.test.mjs`

**Steps:**

1. Add failing tests for the complete readiness wording matrix, a comment-only/falsely indented business profile route, and constraint reorder/insertion stability.
2. Run `node --test test/generation.test.mjs test/commit-completion.test.mjs` and confirm only the new cases fail.
3. Make missing, incomplete, or mismatched evidence say `blocked`; keep complete structural records at `recorded-unverified / eligible-for-review`.
4. Parse the actual `profiles.business-constraints.required` YAML shape narrowly instead of accepting arbitrary path text in comments.
5. Derive constraint IDs from normalized content hashes, reject normalized duplicates, and retain evidence invalidation when the actual constraint changes.
6. Rerun the two focused suites plus `node --test test/onboarding-product-flow.test.mjs`.

### Task 3: Define Shared Surface and Verification Contracts

**Owner:** core_runtime_fixes  
**Reviewer:** Project Manager for traceability; Release Engineer for semantics

**Files:**
- Create: `assets/contracts/surface-verification-contract.json`
- Create: `src/modules/repository/surface-signals.mjs`
- Modify: `src/modules/repository/index.mjs`
- Modify: `src/modules/repository/assessment.mjs`
- Modify: `test/project-assessment.test.mjs`
- Modify: `scripts/validate-skill.mjs`

**Steps:**

1. Add failing fixtures for browser UI, `node:http`, file persistence, mixed signals, and no signal.
2. Specify stable signal fields: `id`, `kind`, `source`, `confidence`, `evidenceLevel`, `gaps`, and optional `suggestedVerificationProfile`.
3. Validate the new contract with positive and deliberately malformed negative probes.
4. Implement deterministic signal extraction from scanned file/package evidence; never promote detection to support or certification.
5. Expose `surfaceSignals` from `assess` and keep empty/unsupported cases honest.
6. Run `node --test test/project-assessment.test.mjs` and `node scripts/validate-skill.mjs --negative-probe`.

### Task 4: Add JS/TS Module Graph and Public API Gates (X3)

**Owner:** core_runtime_fixes  
**Reviewer:** Adversarial Evaluation & Release

**Files:**
- Create: `src/modules/architecture/module-graph.mjs`
- Modify: `src/modules/architecture/index.mjs`
- Modify: `src/modules/architecture/policy.mjs`
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `src/modules/governance/checker.mjs`
- Modify: `test/architecture-policy.test.mjs`
- Modify: `test/architecture-boundaries.test.mjs`
- Modify: `test/generation.test.mjs`

**Steps:**

1. Add RED fixtures for allowed `app -> modules -> shared`, forbidden `shared -> modules`, and forbidden cross-module private imports.
2. Generate an optional declaration containing module roots, public entrypoints, allowed directions, and internal-path allowlists.
3. Parse static relative JS/TS imports/exports conservatively; unsupported syntax or languages remain `stated-only` rather than passing.
4. Report exact source path, target path, and violated rule; bind the result into architecture verification without changing legacy behavior when no declaration exists.
5. Update generated architecture boundaries to describe active checks precisely.
6. Run the three focused suites and `npm run test:architecture`.

### Task 5: Implement Negative and Recovery Evidence Gates (N4)

**Owner:** core_runtime_fixes / Product Security  
**Reviewer:** Adversarial Evaluation & Release

**Files:**
- Create: `src/modules/completion/risk-evidence.mjs`
- Modify: `src/modules/governance/business-constraints.mjs`
- Modify: `src/modules/completion/production-readiness.mjs`
- Modify: `src/modules/completion/service.mjs`
- Modify: `test/commit-completion.test.mjs`
- Add fixtures under: `test/fixtures/risk-evidence/`

**Steps:**

1. Add twelve RED fixture cases: vulnerable and repaired variants for webhook secret, vault token, body actor identity, inactive membership, canceled-invoice settlement, and multi-instance lost update.
2. Define evidence records with risk ID, applicability, reason, entrypoint, negative diagnostic, recovery evidence, source/config fingerprint, and evidence level.
3. Require owner-confirmed applicability. Reject unexplained `not-applicable`, stale fingerprints, duplicate records, and simulated evidence represented as certified.
4. Evaluate fixture receipts without executing arbitrary commands. Missing required negative or recovery evidence blocks production readiness.
5. Run `node --test test/commit-completion.test.mjs` and the risk fixture suite.

### Task 6: Add Surface Verification Orchestration (X2)

**Owner:** core_runtime_fixes  
**Reviewer:** Product Security + Release

**Depends on:** Task 3

**Files:**
- Create: `src/modules/completion/surface-verification.mjs`
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `src/modules/completion/service.mjs`
- Modify: `src/cli/read-only-guidance.mjs`
- Modify: `test/generation.test.mjs`
- Modify: `test/commit-completion.test.mjs`
- Modify: `test/real-scenarios/packaged-projects.test.mjs`

**Steps:**

1. Add RED cases for a reachable HTTP story, an internal-only unreachable story, and an unavailable browser/DOM environment.
2. Generate optional HTTP contract, DOM smoke, and browser smoke profiles tied to X1 signal IDs.
3. Reuse the existing safe project-command discovery/allowlist; do not add arbitrary shell execution.
4. Return only `passed`, `blocked`, `unverified`, or reasoned `not-applicable`; environment absence must be `unverified`.
5. Include surface results as a distinct completion dimension, separate from governance structure and business evidence.
6. Run focused completion, generation, and packaged-project suites.

### Task 7: Finish Novice Self-Service Onboarding (N1)

**Owner:** onboarding_flows  
**Reviewer:** Adversarial Evaluation & Release

**Files:**
- Modify: `src/cli/prompts.mjs`
- Modify: `src/cli/read-only-guidance.mjs`
- Modify: `src/cli/help.mjs`
- Modify: `src/cli/commands/init.mjs`
- Modify: `test/onboarding-product-flow.test.mjs`
- Modify: `test/args.test.mjs`
- Modify: `test/real-scenarios/packaged-projects.test.mjs`

**Steps:**

1. Add RED snapshots for U01-like zh-CN and English flows and assert that unexplained Git/manifest/enforcement/negative-probe terms do not appear in the Chinese recommended-action path.
2. Add a guided preset that collects client, lifecycle, depth, locale, and project-local invocation without JSON editing; preserve explicit user decisions and non-interactive safety.
3. Keep each human result to one recommended action, one reason, and one claim boundary while preserving stable JSON keys.
4. Ensure every warning has a recovery action and every success has one exact next command.
5. Run onboarding, args, request-workflow, and packaged-project focused suites.

### Task 8: Freeze and Rerun One Ten-Persona Candidate

**Owner:** Project Manager  
**Builders:** onboarding_flows for U01–U02; core_runtime_fixes for U03–U10 execution support  
**Reviewer:** business_review

**Files:**
- Create: `docs/pilots/2026-09-10/post-fix-execution-matrix.md`
- Modify: `docs/pilots/2026-09-10/U01.md` through `U10.md`
- Modify: `docs/pilots/2026-09-10/体验与复核模板.md`

**Steps:**

1. Pass all repository-local focused tests before packaging.
2. Create one tarball with `npm pack --ignore-scripts`, calculate SHA-256, and freeze it for the rerun.
3. Copy the preserved `/tmp/aicg-pilot-20260910/U01`–`U10` apps into a new temporary post-fix root; do not mutate or delete the original evidence directories.
4. Install the frozen tarball in every copied app and run its tests, `doctor`, `assess`, `architecture`, `check`, `complete`, and `evidence status` using project-local entrypoints.
5. Record command, exit code, key states, candidate fingerprint, and whether the old application itself still has P0/P1 defects. AICG improvements do not silently repair application code.
6. Record ten new `simulated-persona` receipts; never reuse old candidate receipts.
7. Have business_review independently review all ten results and rescore only observations supported by the rerun.

### Task 9: Prepare L2/L3 External Validation Packages

**Owner:** Project Manager + onboarding_flows  
**Reviewer:** Product Owner + Release

**Files:**
- Create: `docs/validation/real-client-cross-os-runbook.md`
- Create: `docs/validation/real-user-pilot-protocol.md`
- Create: `docs/validation/templates/external-evidence-receipt.json`
- Create: `docs/validation/templates/client-os-matrix.json`
- Modify: `scripts/validate-skill.mjs`

**Steps:**

1. Define consent, privacy, anonymization, reviewer independence, candidate binding, expiry/staleness, negative/recovery evidence, and withdrawal handling.
2. Provide blank machine-readable receipts and matrices with no invented participant or platform outcomes.
3. Add schema validation plus negative probes for missing consent, fake simulation qualification, stale candidate, and self-review.
4. Mark L2/L3 `externally-blocked` until actual people and platforms execute the package.

### Task 10: Close Reports and Perform Independent Verification

**Owner:** business_review  
**Coordinator:** Project Manager  
**Reviewer:** root / Release

**Files:**
- Modify: `docs/pilots/2026-09-10/功能决策.md`
- Modify: `docs/评测-2026-09-10-AICG-10用户试点.md`
- Modify: `docs/整改-2026-09-10-AICG-首轮团队评审.md`
- Modify: `docs/评测-2026-09-10-AICG-团队评审.md`
- Create: `docs/评测-2026-09-10-AICG-最终闭环报告.md`

**Steps:**

1. Record the approved X1–X3 transition and the exact post-fix candidate SHA-256.
2. Reconcile all U01–U10 metadata, including capability pack, lifecycle, evidence kind, receipt count, and simulation boundary.
3. Classify every planned item only as `completed`, `externally-blocked`, or `rejected`, with command/report evidence and residual risk.
4. Run, in order:
   - focused changed suites;
   - `npm test`;
   - `npm run validate`;
   - `npm run smoke`;
   - `npm run smoke:package`;
   - `npm pack --dry-run --ignore-scripts --json`;
   - `git diff --check`.
5. Request independent code review and resolve findings using `superpowers:receiving-code-review`.
6. Inspect child and parent worktrees, commit verified child changes, then commit only the parent gitlink update. Do not push.

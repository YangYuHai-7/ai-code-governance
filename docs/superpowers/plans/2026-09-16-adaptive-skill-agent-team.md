# Adaptive Skill Discovery and Dynamic Agent Team Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement approval-gated Skill discovery and project-specific AI roles without fixed industry rosters, forced PK for small changes, context inflation, or claims that AI replaces qualified professionals.

**Architecture:** Extend the existing deterministic governance core with three focused modules: dynamic project-role proposals, task review/approval routing, and local Skill discovery. Existing artifact planning, plan hashes, manifest ownership, and rollback remain the only write path. Human delivery roles, the AICG product team, and target-project AI roles use mutually exclusive schemas and outputs.

**Tech Stack:** Node.js 22+ ESM, built-in `node:test`, JSON registries/policies, existing AICG scanner/compiler/checker/CLI.

**Spec:** `docs/superpowers/specs/2026-09-16-skill-discovery-agent-team-design.md`

## Global Constraints

- The project AI roster is dynamic; do not add a fixed catalog of legal, restaurant, medical, finance, or other industry roles.
- Repository/free-text evidence may propose a domain need, but only user-confirmed domain needs may create a recommended role.
- Legal, medical, financial, and food-safety AI roles must retain a qualified-human review boundary that AI and PK cannot waive.
- `taskLevel` controls verification strength; `reviewMode` controls single/quick/PK orchestration.
- Minimal generates no management Skill body or agent-team roster. Standard/Complete generate them only after exact approval.
- Default discovery is offline, read-only, process-free, and write-free. External sources remain explicit-only.
- The ordinary context closure remains at most 3 files and 900 estimated tokens.
- Do not loosen file, context, or performance budgets to make the implementation pass.
- Each task below is one functional development unit with one consolidated RED → GREEN → VERIFY cycle; do not split it into microtasks.

---

### Task 1: Isolate Team Types and Add Dynamic Project Role Proposals

**Files:**
- Create: `assets/policies/professional-domain-boundaries.json`
- Create: `src/modules/agent-team/project-role-proposals.mjs`
- Create: `src/modules/agent-team/index.mjs`
- Create: `src/project-agent-team.mjs`
- Create: `test/project-agent-team.test.mjs`
- Modify: `src/modules/team/project-recommendation.mjs`
- Modify: `test/team-recommendation.test.mjs`
- Modify: `src/index.mjs`

**Interfaces:**
- Produce `proposeProjectAgentTeam(input, options?)` where `input` contains `projectMode`, `evidence`, `confirmedDomainNeeds`, `roleNeeds`, and optional existing approved roles.
- A `roleNeed` contains a stable project-local ID, title, capabilities, responsibilities, out-of-scope statements, domain need IDs, evidence IDs, Skill IDs, and independence relations.
- Return `teamType: "project-ai-agent-team"`, `status: "recommendation"`, bounded role proposals, professional boundaries, gaps, and `actionsPerformed: []`.
- `aicg team` continues to return only `human-delivery-and-governance`; it must not contain `productTeam` or any AICG internal role.

- [ ] **RED — add one consolidated contract test for team isolation and dynamic domains**

```js
test('project roles are dynamic, evidence-bound, professionally bounded, and isolated from other teams', () => {
  const contract = proposeProjectAgentTeam({
    projectMode: 'greenfield',
    evidence: [{ id: 'decision.contracts', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: 'contract-law', label: 'Contract law', evidenceIds: ['decision.contracts'], jurisdiction: 'JP' }],
    roleNeeds: [{
      id: 'contract-legal-domain-reviewer',
      title: 'Contract legal domain reviewer',
      capabilities: ['contract-clause-risk-review'],
      responsibilities: ['Identify contract issues for qualified human review.'],
      outOfScope: ['Final legal advice or contract approval.'],
      domainNeedIds: ['contract-law'],
      evidenceIds: ['decision.contracts'],
      skillIds: [],
      mustRemainIndependentFrom: [],
    }],
  });
  assert.equal(contract.roleProposals[0].professionalBoundary.qualification, 'licensed-lawyer');
  assert.equal(contract.roleProposals[0].professionalBoundary.humanReviewRequired, true);

  const restaurantSite = proposeProjectAgentTeam({
    projectMode: 'greenfield',
    evidence: [{ id: 'decision.restaurant-site', kind: 'user-confirmed-domain' }],
    confirmedDomainNeeds: [{ id: 'restaurant-operations', label: 'Restaurant operations', evidenceIds: ['decision.restaurant-site'] }],
    roleNeeds: [],
  });
  assert.equal(JSON.stringify(restaurantSite).includes('food-safety'), false);

  const humanAdvice = teamRecommendation(root, humanContext);
  assert.equal(Object.hasOwn(humanAdvice, 'productTeam'), false);
  assert.equal(humanAdvice.teamType, 'human-delivery-and-governance');
});
```

Run: `node --test test/project-agent-team.test.mjs test/team-recommendation.test.mjs`

Expected RED: project-agent-team module does not exist and human advice still exposes `productTeam`.

- [ ] **GREEN — implement the complete dynamic role boundary**

Implement strict bounded validation, stable ordering, duplicate-capability rejection, maximum five recommendations, user-confirmed domain evidence, and professional boundary enrichment from `professional-domain-boundaries.json`. The policy contains risk-to-human-qualification rules, not role definitions. Remove `productTeam` from both success and needs-input human-team results; keep the existing AICG product-team planner available only through its own internal API.

- [ ] **VERIFY — run the task-level suite once and commit the functional unit**

Run: `node --test test/project-agent-team.test.mjs test/team-recommendation.test.mjs test/dynamic-team.test.mjs`

Expected: all tests pass; dynamic-team internal tests still pass; human output contains no internal roster; contract and food-safety boundaries cannot be omitted or disabled.

Commit: `feat: add dynamic project agent role proposals`

---

### Task 2: Separate Review Mode from Task Level and Enforce Approval Evidence

**Files:**
- Create: `src/modules/governance/task-approval.mjs`
- Create: `test/task-approval.test.mjs`
- Modify: `src/modules/governance/task-routing.mjs`
- Modify: `src/modules/governance/index.mjs`
- Modify: `src/modules/completion/service.mjs`
- Modify: `src/commit-completion.mjs`
- Modify: `src/cli/command-specs.mjs`
- Modify: `src/cli/help.mjs`
- Modify: `src/cli/commands/completion.mjs`
- Modify: `test/task-routing.test.mjs`
- Modify: `test/commit-completion.test.mjs`

**Interfaces:**
- Produce `classifyReviewMode(input)` returning `single | quick-review | independent-pk | high-consequence-pk`, explicit trigger evidence, required role count, and independence requirement.
- Produce `buildTaskApprovalPlan({ taskLevel, reviewMode, plannedPaths, requiredApprovals, professionalBoundaries })` with a SHA-256 `planHash`.
- Accept completion flags `--review-mode <mode>`, `--approval-evidence <repository-relative-json>`, and `--approve <planHash>`.
- Approval evidence records references/digests only; it does not copy requirement, design, or plan contents. Professional-review declarations remain `operator-declared`, never identity-verified.

- [ ] **RED — add one consolidated routing and completion-gate test**

```js
test('local L2 fixes avoid PK while behavior and professional risks require evidence-bound review', () => {
  assert.equal(classifyReviewMode({ taskLevel: 'L2', plannedPaths: ['src/typo.ts'], behaviorChange: false }).mode, 'single');
  assert.equal(classifyReviewMode({ taskLevel: 'L2', behaviorChange: true, multiModule: true }).mode, 'independent-pk');
  assert.equal(classifyReviewMode({ taskLevel: 'L2', professionalRisk: 'contract-law' }).mode, 'high-consequence-pk');

  const omitted = runCompletion(productionFixture, {});
  assert.equal(omitted.ok, false);
  assert.equal(omitted.taskRoute.status, 'unverified-declaration');

  const stale = runCompletion(productionFixture, { taskLevel: 'L2', reviewMode: 'single', approvalEvidence: staleEvidence });
  assert.equal(stale.ok, false);
  assert.equal(stale.taskApproval.status, 'stale-plan');
});
```

Run: `node --test test/task-approval.test.mjs test/task-routing.test.mjs test/commit-completion.test.mjs`

Expected RED: review-mode/approval APIs and flags do not exist; omitted production task levels currently return `ok:true`.

- [ ] **GREEN — implement the complete review and approval gate**

Keep current path-derived task levels. Compute review mode independently from behavior, public-contract, multi-module, multi-surface, irreversible, professional-risk, governance, and release evidence. Bind approval evidence to task level, review mode, planned paths, required approval IDs, professional boundaries, and `planHash`; reject missing, stale, mismatched, symlinked, oversized, or malformed evidence. Recompute against the final diff. Do not require PK solely because a path is production source.

- [ ] **VERIFY — run the task-level suite once and commit the functional unit**

Run: `node --test test/task-approval.test.mjs test/task-routing.test.mjs test/commit-completion.test.mjs test/request-workflow.test.mjs`

Expected: all tests pass; a local production fix can be L2 + `single`; behavior/contract/high-consequence changes require the correct review mode and current approvals; missing production declarations no longer pass completion.

Commit: `feat: enforce adaptive task review approvals`

---

### Task 3: Add Offline Skill Discovery and Approval-Gated Governance Artifacts

**Files:**
- Create: `src/modules/skills/discovery.mjs`
- Create: `src/modules/skills/decisions.mjs`
- Create: `src/modules/skills/index.mjs`
- Create: `src/skill-discovery.mjs`
- Create: `test/skill-discovery.test.mjs`
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `src/modules/governance/artifact-selection.mjs`
- Modify: `src/modules/governance/checker.mjs`
- Modify: `src/modules/governance/manifest-trust.mjs`
- Modify: `src/generator.mjs`
- Modify: `test/artifact-selection.test.mjs`
- Modify: `test/context-budget.test.mjs`
- Modify: `test/generation.test.mjs`

**Interfaces:**
- Produce `discoverSkills({ root, installedRoots, curatedCatalog, requiredCapabilities })` returning at most five deduplicated candidates ordered project > installed > official-curated.
- Produce `decideSkillCandidates(candidates, decisions)` and an exact decision `planHash`; states are `discovered`, `recommended`, `approved`, `applied`, and `active-for-task`.
- Extend config with default-disabled `skillDiscovery` and `agentTeam` blocks. Approved project roles are supplied by Task 1's schema.
- Generate `skill-discovery`, `team-orchestrator`, metadata indexes, and `docs/ai/agent-team.json` only for Standard/Complete after exact approval; never add them to ordinary context.

- [ ] **RED — add one consolidated discovery, authorization, and budget test**

```js
test('skill discovery is local, deduplicated, approval-gated, and lazy', () => {
  const candidates = discoverSkills({ root, installedRoots, curatedCatalog, requiredCapabilities: ['contract-clause-risk-review'] });
  assert.ok(candidates.length <= 5);
  assert.equal(candidates[0].sourceKind, 'project');
  assert.equal(new Set(candidates.map((item) => item.capabilityOwner)).size, candidates.length);

  const minimal = buildArtifacts({ ...base, governanceDepth: 'minimal', skillDiscovery: approved }, scan);
  assert.equal(minimal.some((item) => /skill-discovery|team-orchestrator|agent-team/.test(item.path)), false);

  const standardUnapproved = buildArtifacts({ ...base, governanceDepth: 'standard' }, scan);
  assert.equal(standardUnapproved.some((item) => /agent-team/.test(item.path)), false);

  const standardApproved = buildArtifacts({ ...base, governanceDepth: 'standard', skillDiscovery: approved, agentTeam: approvedTeam }, scan);
  assert.ok(standardApproved.some((item) => item.path === 'docs/ai/agent-team.json'));
  assert.equal(contextClosure(standardApproved, 'ordinary').length, 3);
});
```

Run: `node --test test/skill-discovery.test.mjs test/artifact-selection.test.mjs test/context-budget.test.mjs test/generation.test.mjs`

Expected RED: discovery and decision modules do not exist; approved management artifacts are not generated.

- [ ] **GREEN — implement the complete local discovery and artifact slice**

Read only ordinary, non-symlinked, size-bounded Skill manifests. Do not execute Skill code, package scripts, hooks, or network requests. Deduplicate by capability owner and source priority. Bind approvals to exact source, version/content digest, permissions, and plan hash so any change invalidates approval. Reuse the existing artifact plan, manifest, rollback, sync, and checker path; do not add a second writer.

- [ ] **VERIFY — run the task-level suite once and commit the functional unit**

Run: `node --test test/skill-discovery.test.mjs test/artifact-selection.test.mjs test/context-budget.test.mjs test/generation.test.mjs test/sync-prune.test.mjs`

Expected: all tests pass; no unapproved artifact is generated; Minimal stays unchanged; Standard/Complete approved artifacts remain outside ordinary context and inside existing hard budgets.

Commit: `feat: add approval gated skill discovery`

---

### Task 4: Integrate Onboarding, Real Scenarios, and Final Performance Evidence

**Files:**
- Modify: `src/cli/prompts.mjs`
- Modify: `src/cli/commands/init.mjs`
- Modify: `src/cli/read-only-guidance.mjs`
- Modify: `src/modules/governance/execution-plan.mjs`
- Modify: `src/modules/governance/compiler.mjs`
- Modify: `test/onboarding-product-flow.test.mjs`
- Modify: `test/real-scenarios/packaged-projects.test.mjs`
- Create: `test/real-scenarios/adaptive-team-governance.test.mjs`
- Modify: `scripts/perf-baseline.mjs` only if profiling identifies unnecessary work; do not raise thresholds.
- Modify: `README.md`, `SKILL.md`, `references/initializer.md`

**Interfaces:**
- Init dry-run returns bounded Skill and role recommendations, decisions, file actions, context cost, permissions, professional-review gaps, and one exact plan hash.
- Applying the plan writes only selected Standard/Complete artifacts; old-project sync remains preview-only until approval.
- Greenfield and brownfield use the same schemas with different allowed evidence.

- [ ] **RED — add one consolidated end-to-end scenario suite**

Cover these cases in a single file: greenfield contract project recommends a dynamic legal-domain role with licensed-lawyer review; restaurant website does not add food-safety; confirmed allergen/back-of-house scope adds food-safety review; brownfield repository candidates remain unconfirmed until user approval; Minimal writes no team/management Skill; stale plan hash writes nothing; ordinary L0/L1 and local L2 remain single-role; true behavior/contract changes select PK.

Run: `node --test test/real-scenarios/adaptive-team-governance.test.mjs test/onboarding-product-flow.test.mjs`

Expected RED: onboarding has no recommendation/decision flow and no dynamic-team artifacts.

- [ ] **GREEN — wire the approved modules through onboarding and documentation**

Use current config merge, execution-plan digest, artifact apply, rollback, and localized guidance. Show recommendations without preselecting third-party Skills or roles. Record open professional-review gaps without claiming the credential was verified. Profile the existing fast suite and remove duplicated setup or unnecessary repeated work if required to restore the 5-second p95 contract; do not increase the budget.

- [ ] **VERIFY — run one final integrated acceptance pass and commit**

Run once, in this order:

```bash
node --test test/real-scenarios/adaptive-team-governance.test.mjs test/onboarding-product-flow.test.mjs test/real-scenarios/packaged-projects.test.mjs
npm run test:fast
npm run test:full
npm run test:perf
npm run validate
npm run smoke
npm run smoke:package
npm pack --dry-run
git diff --check
```

Expected: every command exits 0; full tests have zero failures; isolated performance satisfies routing ≤20 ms, small ≤250 ms, 10k ≤1000 ms, fast suite ≤5000 ms; no ordinary-context or artifact budget is relaxed.

Commit: `feat: integrate adaptive governance recommendations`


# AICG Report Closure and Project Management Design

## Status

- Decision: approved by the Product Owner on 2026-09-10.
- Delivery scope: close all repository-local gaps from the ten-persona pilot, rerun the simulated pilot, and prepare executable external-validation packages.
- Evidence boundary: simulated personas, local fixtures, and repository tests never count as real-user, real-client, cross-OS, certification, or production-readiness evidence.
- Roadmap transition: the approval moves X1–X3 from `next` into this delivery slice; the feature-decision report must record the transition before final closure.

## Problem

The first review and ten-persona pilot left five repository-local capability gaps: novice onboarding is only partially self-service (N1), high-risk negative evidence is partial (N4), native application surfaces are not classified (X1), user stories are not verified through their actual HTTP or browser entry points (X2), and module dependency/public API rules remain stated-only (X3). Real-client, cross-OS, and real-person validation (L2/L3) also lack an executable protocol, but cannot be completed honestly inside this repository.

The delivery needs a Project Manager who owns coordination and traceability without weakening independent technical acceptance.

## Team Design

### Project Manager

Add `project-manager` to the AICG product-team registry as a core role.

This is an internal AICG product-team role. It is not added to the customer-project `team-role-registry.json` unless a separate product decision authorizes `aicg team` to recommend project managers to customer repositories. Both registries must continue to validate, but their role scopes remain separate.

Responsibilities:

- Own the work breakdown, dependency graph, milestone status, risk register, and evidence traceability matrix.
- Ensure every report claim links to a current candidate fingerprint and reproducible evidence.
- Escalate scope, product, security, or evidence-boundary decisions to the appropriate owner.
- Keep external validation gaps visible instead of converting them into repository-local completion claims.

The Project Manager may coordinate delivery and report status, but may not approve their own implementation, change product scope, accept security risk, or declare release/certification readiness.

### Delivery Roles and Assignments

| Work package | Accountable role | Responsible workstream | Independent reviewer | Deliverable |
| --- | --- | --- | --- | --- |
| PM-1 role and delivery controls | Product Owner | Project Manager | Principal Governance Architect | Registry role, RACI, milestone and evidence matrix |
| N1 novice self-service flow | Project Manager | Developer Experience / Onboarding | Adversarial Evaluation & Release | Chinese and English guided flow, prompt/preset, snapshots, U01/U02 rerun |
| N4 negative and recovery evidence | Product Security Engineer | Core Runtime | Adversarial Evaluation & Release | Six required fixture probes, recovery evidence, fingerprint binding |
| X1 native surface classification | Principal Governance Architect | Core Runtime | Developer Experience + Release | Browser UI, `node:http`, and file-persistence signals with source, confidence, gap, and evidence level |
| X2 surface verification orchestration | Principal Governance Architect | Core Runtime | Product Security + Release | Optional HTTP/DOM/browser profiles with explicit pass, blocked, and unverified states |
| X3 dependency/public API gate | Principal Governance Architect | Core Runtime | Adversarial Evaluation & Release | JS/TS declared module graph, import-direction and internal-path checks |
| P-10 simulated pilot rerun | Project Manager | Ten persona builders/reviewers | Business Review | Candidate-bound receipts, app results, experience reports, defect clusters |
| EXT-1 external validation package | Project Manager | Developer Experience + Release | Product Owner | Consent protocol, anonymous receipt, client/OS matrix, runbook; no fabricated outcomes |
| RPT-1 report closure | Project Manager | Business Review | Product Owner + Release | Updated review, remediation, pilot, and feature-decision reports |

Implementation owners must not act as their sole independent reviewer. A failed acceptance gate returns the work package to its responsible workstream; the Project Manager records the state but cannot waive the gate.

## Delivery Sequence

1. **M0 — Management baseline:** add the Project Manager role, task ledger, RACI, risk register, and candidate evidence matrix.
2. **M1 — Contracts and failing fixtures:** specify stable schemas for surface signals, probes, verification profiles, and module graphs; add failing tests for N1/N4/X1–X3; record the approved X1–X3 roadmap transition.
3. **M2 — Repository-local implementation:** deliver N1 and N4, then X1, X2, and X3 behind explicit evidence states.
4. **M3 — Simulated pilot rerun:** pack one candidate, rerun U01–U10 against that exact SHA-256, review every application, and collect comparable experience reports.
5. **M4 — Independent closure:** run full validation and package smoke, audit claims, update all reports, and classify every item as `completed`, `externally-blocked`, or `rejected`.

X1 precedes X2 because orchestration needs a stable surface classification. N4 and X2 share evidence primitives but keep threat applicability separate from execution status. X3 can run in parallel after the common schema work. The pilot rerun starts only after one immutable candidate is packed.

Before that candidate is packed, three existing evidence-integrity defects must be closed: readiness guidance must match the `blocked` state machine, comments must not satisfy a real business-profile route, and constraint identifiers must survive reordering or insertion of unrelated constraints.

## Architecture and Data Contracts

### Surface Signals

A surface signal records `id`, `kind`, `source`, `confidence`, `evidenceLevel`, `gaps`, and an optional suggested verification profile. Detection is candidate generation, not support or certification. Initial kinds are `browser-ui`, `node-http`, and `file-persistence`.

### Verification Profiles

Profiles declare safe project-owned commands or adapters for HTTP contract, DOM smoke, and browser smoke verification. Results use `passed`, `blocked`, `unverified`, or `not-applicable`. Missing runtime support is `unverified`, never `passed`. A project method that is not reachable from its declared surface blocks the related story.

### Negative Evidence

Threat applicability remains owner-confirmed. The first required probes cover missing webhook secret, default vault token, body-supplied actor identity, inactive membership, canceled-invoice settlement, and multi-instance lost update. Every result binds the probe, recovery action, diagnostics, source/config fingerprint, and evidence level. `not-applicable` requires a reason.

### Module Graph

JS/TS projects may declare modules, public entry points, and internal-path allowlists. The verifier accepts declared layer directions such as `app -> modules -> shared`, rejects inverse and cross-module internal imports, and stays `stated-only` when no supported parser or declaration exists.

### Novice Flow

Human output presents one recommended action, one reason, and one claim boundary. A guided preset collects client, lifecycle, depth, locale, and project-local execution choices without requiring JSON editing. Machine JSON keys remain stable.

## Reports and Traceability

The Project Manager maintains a table keyed by work-package ID with owner, reviewer, status, candidate SHA-256, commands, fixtures, report links, residual risks, and external dependencies. U01–U10 reports must identify whether evidence is pre-fix or post-fix and must never reuse a receipt across candidate fingerprints.

Final reports distinguish:

- governance structure;
- project command execution;
- business-constraint coverage;
- surface and negative evidence;
- production-readiness eligibility;
- real-client, cross-OS, real-project, and certification evidence.

## Acceptance Gates

- The product-team and role registries validate, and selection output can include the Project Manager without making the role a release approver.
- The customer-project team registry remains unchanged unless separately approved; its successful validation does not imply that it recommends the internal AICG Project Manager.
- N1 satisfies all four existing acceptance criteria through automated fixtures; real novice usability remains externally blocked until L3.
- N4 blocks all six vulnerable fixtures and records passing negative plus recovery evidence for their fixed counterparts.
- X1 deterministically classifies the three initial native surfaces and exposes provenance, confidence, gaps, and `unverified` evidence.
- X2 blocks unreachable declared stories and reports unavailable browser/runtime environments as `unverified`.
- X3 passes allowed JS/TS dependency directions and fails inverse or private cross-module imports.
- U01–U10 are rerun against one post-fix candidate fingerprint, with independent application review and experience scoring.
- Full repository tests, skill validation, negative validation, smoke, package smoke, dry-run pack, and diff checks pass.
- L2/L3 contain executable protocols and blank evidence receipts only; no external outcome is claimed without actual execution.

## Explicit Non-goals

- Publishing or pushing a package or repository.
- Claiming support for every native framework or language.
- Inventing business rules, automatically accepting risk, or executing arbitrary project commands.
- Treating simulation, structural checks, or passing tests as certification or production readiness.
- Fabricating real people, customer adoption, real coding-agent loading, Windows/Linux execution, or external platform evidence.

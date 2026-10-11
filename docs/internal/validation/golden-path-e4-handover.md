# Golden path E4 handover: what each remaining input must be

Everything the implementation side can produce has been produced and committed: the macOS matrix runs 14 of 14 declared gates with real drivers, all fourteen injected-defect probes are detected by real gates, the concurrent-write defence is verified across three API processes, and the release candidate passes test:full, validate, smoke, smoke:package, and prepublish-check. Certifying the golden path (E4) needs four inputs that the implementation side must not manufacture. This document names each one, how to run it, and what has to come back.

## 1. Evaluation receipts for each claimed platform (Linux, Windows)

Provide a host per platform with the declared runtime: Node 24.18.0, npm 11.0.0, PostgreSQL 18.6, a browser engine, and a running API and web client.
Commands: install the workload with `npm ci`, then run `AICG_ROOT=<governance checkout> AICG_LIVE_API=<api> AICG_LIVE_WEB=<web> node scripts/golden-path-live-evaluation.mjs --receipt <path>`; the manual workflow `golden-path-evaluation.yml` refuses a host that cannot satisfy those prerequisites instead of publishing a receipt.
Acceptance: the receipt validates with `validateQualityMatrixRun` and every gate is passed. A passing matrix run is not an evaluation receipt, so the platform still needs number 2.

## 2. Evaluator-owned held-out cases

The current provider fixture is a placeholder: each case repository holds a README and a text file, each requirement is not a full Requirement IR, and both cases are declared for linux only.
Provide at least two real, structurally distinct repositories outside this project, each with a complete Requirement IR, for the platforms being claimed.
Acceptance: `runHeldOutEvaluationSet` produces per-case receipts that `evaluateGoldenPathCertification` accepts as held-out evidence. Do not author these cases inside this repository: a held-out case written by the implementation side is not held out.

## 3. A real supported Agent adapter

The Codex CLI is not installed on the evaluation host, so no real agent turn can be executed and `missing-e3` stays open.
Provide an installed, authorized Agent CLI; the adapter already probes it, refuses dangerous flags, rejects unauthorized changed paths, and keeps structured output verified.
Acceptance: an E3 agent-executable receipt exists and is bound to the same Pack and requirement digests.

## 4. Qualified human acceptance

Provide one qualified participant who is unfamiliar with this stack plus an independent observer, following docs/internal/validation/golden-path-qualified-user-protocol.md.
Acceptance: `applyQualifiedUserEvidence` accepts the record and `missing-qualified-human` clears. AI review is not qualified-human evidence: a simulated participant may be recorded as a usability probe, never as acceptance.

## What is already done and must not be redone by hand

- The Pack is corrected to an installable combination and its digest is bound into every receipt.
- The gates fail closed: a missing database, a missing API, a missing policy checkout, or a removed gate script fails the gate instead of passing it.
- Evidence honesty is guarded by tests: a single-host matrix receipt, or a green release candidate, can never produce a certification verdict.

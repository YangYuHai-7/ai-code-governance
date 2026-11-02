# Golden path E4 handover: what each remaining input must be

The single-host reference path has a passing macOS matrix and historical real Codex E3 run, but the retained Agent receipt refers to an earlier matrix run. A new current E3 receipt is needed before certification. E4 also needs three external inputs that the implementation side must not manufacture. This document names each one, how to run it, and what has to come back.

## Historical E3 evidence and current gap

`test-support/evaluations/golden-path/receipts/macos-codex-e3.json` is a validated historical `E3-agent-executable` receipt for Codex CLI 0.162.0. It is bound to its retained macOS matrix run, records four real Agent turns and non-zero elapsed time, and contains no failure history or residual gap. Its companion probe receipt records all fourteen injected defects as detected. The latest local matrix run has a different identity.

The historical E3 does not clear `missing-e3` or `platform-missing:darwin` for the latest matrix. The certification input must name the current reference matrix run, and a reference E3 receipt must match it. A new real-Agent run first needs a confidentiality review for unpublished inputs. Historical evidence does not prove held-out performance, Linux or Windows support, or qualified-human acceptance.

## 1. Evaluation receipts for each remaining claimed platform (Linux, Windows)

Provide a host per platform with the declared runtime: Node 24.18.0, npm 11.0.0, PostgreSQL 18.6, a browser engine, and a running API and web client.
Commands: install the workload with `npm ci`, then run `AICG_ROOT=<governance checkout> AICG_LIVE_API=<api> AICG_LIVE_WEB=<web> node scripts/golden-path-live-evaluation.mjs --receipt <path>`; the manual workflow `golden-path-evaluation.yml` refuses a host that cannot satisfy those prerequisites instead of publishing a receipt.
Acceptance: the matrix receipt validates with `validateQualityMatrixRun`, every gate is passed, and `aicg evaluation golden-path` produces a bound E3 receipt on that same candidate and platform. A passing matrix run alone is not an evaluation receipt.

## 2. Evaluator-owned held-out cases

The current provider fixture is a placeholder: each case repository holds a README and a text file, each requirement is not a full Requirement IR, and both cases are declared for linux only.
Provide at least two real, structurally distinct repositories outside this project, each with a complete Requirement IR, for the platforms being claimed.
Acceptance: `runHeldOutEvaluationSet` produces per-case receipts that `evaluateGoldenPathCertification` accepts as held-out evidence. Do not author these cases inside this repository: a held-out case written by the implementation side is not held out.

## 3. Qualified human acceptance

Provide one qualified participant who is unfamiliar with this stack plus an independent observer, following docs/internal/validation/golden-path-qualified-user-protocol.md.
Acceptance: `applyQualifiedUserEvidence` accepts the record and `missing-qualified-human` clears. AI review is not qualified-human evidence: a simulated participant may be recorded as a usability probe, never as acceptance.

## What is already done and must not be redone by hand

- The Pack is corrected to an installable combination and its digest is bound into every receipt.
- The gates fail closed: a missing database, a missing API, a missing policy checkout, or a removed gate script fails the gate instead of passing it.
- The supported Codex adapter has historically executed all four phases. Its retained receipt is not current reference E3 evidence.
- Evidence honesty is guarded by tests: a single-host matrix receipt, or a green release candidate, can never produce a certification verdict.

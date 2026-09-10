# Post-Fix Ten-Persona Execution Matrix

## Current state

- Work package: `P-10` / implementation-plan Task 8.
- Status: `completed-repo-local`.
- Final candidate source commit: `e6b27d763601a3632bb1394d0ff0df2a94176f9b`.
- Final candidate package SHA-256: `6161f1aa5334e597ce0c0d9f9800f827f60f8ae25678c9f0f2a694ebde242017`.
- Execution root: `/tmp/aicg-final-pilot-20260910`.
- Result: **10/10 legacy governance trees upgraded in place; 36/36 application tests passed; every recorded command exited `0`; 10/10 `productionReadiness=blocked`; production-grade 0/10.**

The original `/tmp/aicg-pilot-20260910/U01`–`U10` evidence directories were not modified. The rerun used copies under the final execution root and installed the same immutable candidate project-locally.

## Candidate freeze ledger

| Field | Value |
| --- | --- |
| Package path | `/tmp/aicg-final-postfix-candidate-20260910.z7MOhj/ai-code-governance-0.2.0.tgz` |
| Package name/version | `ai-code-governance@0.2.0` |
| SHA-256 | `6161f1aa5334e597ce0c0d9f9800f827f60f8ae25678c9f0f2a694ebde242017` |
| Source commit | `e6b27d763601a3632bb1394d0ff0df2a94176f9b` |
| Byte size | `288942` |
| Result timestamp | `2026-09-10T05:55:19.685Z` (recorded by the U04–U07 aggregate) |
| Builder binding | All five authoritative result files record the same package fingerprint and source commit |
| Independent digest | `shasum -a 256` returned the exact recorded SHA-256 |
| Freeze decision | Accepted for this repo-local simulated-persona rerun; not a release or certification approval |

Authoritative result files:

- `/tmp/aicg-final-pilot-20260910/U01-U03-results.json`
- `/tmp/aicg-final-pilot-20260910/U04-U07-results.json`
- `/tmp/aicg-final-pilot-20260910/U08/U08-results.json`
- `/tmp/aicg-final-pilot-20260910/U09/U09-results.json`
- `/tmp/aicg-final-pilot-20260910/U10/U10-results.json`

Directories named `*-superseded` are historical intermediate runs and are excluded from the final aggregate.

## Execution matrix

| Persona | Final copy | In-place upgrade | Source unchanged | App tests | Recorded commands | Surface | Business evidence | Risk evidence | Production readiness | Receipt | Historical application findings |
| --- | --- | ---: | ---: | ---: | ---: | --- | --- | --- | --- | --- | --- |
| U01 | `/tmp/aicg-final-pilot-20260910/U01` | yes | yes | 3/3 | all exit `0` | browser-ui, node-http: unverified | 0/3, missing | 0/1, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U02 | `/tmp/aicg-final-pilot-20260910/U02` | yes | yes | 3/3 | all exit `0` | browser-ui, node-http, file-persistence: unverified | 0/3, missing | 0/0, not-applicable | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U03 | `/tmp/aicg-final-pilot-20260910/U03` | yes | yes | 3/3 | all exit `0` | browser-ui, node-http, file-persistence: unverified | 0/3, missing | 0/0, not-applicable | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U04 | `/tmp/aicg-final-pilot-20260910/U04` | yes | yes | 3/3 | all exit `0` | node-http, file-persistence: unverified | 0/3, missing | 0/2, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U05 | `/tmp/aicg-final-pilot-20260910/U05` | yes | yes | 4/4 | all exit `0` | browser-ui, node-http, file-persistence: unverified | 0/2, missing | 0/1, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U06 | `/tmp/aicg-final-pilot-20260910/U06` | yes | yes | 4/4 | all exit `0` | node-http: unverified | 0/3, missing | 0/4, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U07 | `/tmp/aicg-final-pilot-20260910/U07` | yes | yes | 4/4 | all exit `0` | node-http: unverified | 0/2, missing | 0/2, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U08 | `/tmp/aicg-final-pilot-20260910/U08/app` | yes | yes | 4/4 | all exit `0` | node-http: unverified | 0/3, missing | 0/3, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U09 | `/tmp/aicg-final-pilot-20260910/U09/app` | yes | yes | 4/4 | all exit `0` | node-http: unverified | 0/3, missing | 0/3, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |
| U10 | `/tmp/aicg-final-pilot-20260910/U10/app` | yes | yes | 4/4 | all exit `0` | node-http: unverified | 0/3, missing | 0/3, missing | blocked / not-eligible | simulation-only; eligible 0; certified false | retained; probes not rerun |

## Independent review decision

- Candidate binding is consistent: source commit, tarball digest, every persona result and every final receipt fingerprint agree.
- The final rerun proves **governance upgrade success for 10/10 copied legacy projects** and **36/36 existing application tests passing**. It does not prove that historical application defects were repaired: application source digests are unchanged and the prior exploit probes were intentionally not rerun.
- `check` and `complete` exit `0` while keeping unsupported claims unverified. All ten results report missing owner-confirmed business evidence; eight report missing risk evidence and U02/U03 correctly report risk evidence as not applicable. All surfaces remain unverified.
- Every receipt has `evidenceKind=simulated-persona`, `qualification=simulation-only`, `outcome=blocked`, `eligibleForHumanCertificationReview=0`, and `certified=false`.
- Therefore governance rerun success is 10/10, application test pass is 36/36, `productionReadiness=blocked` is 10/10, and production-grade is 0/10.

## Evidence boundary and work-package status

| Work package | Final status | What is proved | What remains outside this rerun |
| --- | --- | --- | --- |
| N1 novice guidance | `completed` repo-local | Localized guided flow, safe non-interactive requirements and deterministic next-step behavior are implemented and covered by repository tests. | Independent novice use by a real person on a real project is `externally-blocked` under L3. |
| N2 command/script lifecycle | `completed` | Safe command canonicalization and lifecycle-hook rejection are covered; final rerun commands exit `0`. | No broader arbitrary-command claim. |
| N3 constraint/readiness separation | `completed` | Missing business evidence produces `productionReadiness=blocked` without turning structural success into production success. | Owner-confirmed real-project evidence is absent. |
| N4 high-risk evidence | `completed` repo-local | Six vulnerable/repaired fixtures execute and fingerprint-bound negative/recovery rules are covered by repository tests. | Real-project attack/recovery replay and human review are `externally-blocked` under L3. |
| X1 native surface detection | `completed` repo-local | browser-ui, node-http and file-persistence are detected with explicit unverified gaps. | No claim of native pack certification. |
| X2 surface orchestration | `completed` repo-local | Safe declared verification commands and marker/entrypoint binding are covered by fixtures; unavailable browser execution stays unverified. | No real browser/client execution was performed here. |
| X3 JS/TS module graph | `completed` repo-local | Static same-line, multiline and semicolon-free imports plus public/private boundaries are covered. | Dynamic imports, aliases, cohesion and SRP remain unverified. |
| L2 real client / cross OS | `externally-blocked` | Runbook exists. | No current real client, Windows/Linux, hook or CI replay evidence. |
| L3 real-user / real-project pilot | `externally-blocked` | Protocol exists. | No real participant, real customer or authorized real project evidence. |

No real person, real customer, real client, cross-OS, production or certification evidence was created by this final rerun.

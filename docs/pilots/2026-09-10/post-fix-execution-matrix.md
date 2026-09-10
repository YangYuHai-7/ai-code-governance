# Post-Fix Ten-Persona Execution Matrix

## Current state

- Work package: `P-10` / implementation-plan Task 8.
- Status: `waiting-for-candidate-freeze`.
- Post-fix candidate package: not frozen.
- Post-fix candidate SHA-256: not recorded.
- Source commit: not recorded.
- Execution root: not created.
- Results: none. No application, CLI, receipt, score, or reviewer outcome has been recorded in this matrix.

The original `/tmp/aicg-pilot-20260910/U01`–`U10` evidence directories must remain unchanged. Each post-fix run uses a copy under a new temporary root and installs the same immutable candidate tarball project-locally.

## Evidence boundary

- Every row remains a `simulated-persona` rerun and must produce a new receipt bound to the post-fix candidate fingerprint.
- Old receipts bound to SHA-256 `9fbe94736ed2db7784f1be9160ecaec1a54fe415e10a278a14876d0ccc67580c` cannot be reused.
- A passing post-fix application test or AICG command does not repair existing application defects and does not establish real-user, real-project, real-client, cross-OS, production, or certification evidence.
- Reports U01–U10 and the four closure reports remain unchanged until the frozen candidate is executed and independently reviewed.

## Candidate freeze ledger

| Field | Value |
| --- | --- |
| Package path | Not recorded |
| Package name/version | Not recorded |
| SHA-256 | Not recorded |
| Source commit | Not recorded |
| Byte size | Not recorded |
| Freeze time | Not recorded |
| Builder digest command/result | Not run |
| Independent digest command/result | Not run |
| Freeze approval | Pending |

## Execution matrix

| Persona | Original app | Post-fix copy | Install | `npm test` | `doctor` | `assess` | `architecture` | `check` | `complete` | Evidence status/new receipt | Existing app defects | Independent reviewer | State |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| U01 | `/tmp/aicg-pilot-20260910/U01` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U02 | `/tmp/aicg-pilot-20260910/U02` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U03 | `/tmp/aicg-pilot-20260910/U03` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U04 | `/tmp/aicg-pilot-20260910/U04` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U05 | `/tmp/aicg-pilot-20260910/U05` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U06 | `/tmp/aicg-pilot-20260910/U06` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U07 | `/tmp/aicg-pilot-20260910/U07` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U08 | `/tmp/aicg-pilot-20260910/U08/app` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U09 | `/tmp/aicg-pilot-20260910/U09/app` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |
| U10 | `/tmp/aicg-pilot-20260910/U10/app` | Not created | Not run | Not run | Not run | Not run | Not run | Not run | Not run | Not recorded | Not reassessed | Unassigned | Waiting for candidate |

## Per-row recording contract

For every command, record the exact project-local command, exit code, bounded diagnostic, candidate fingerprint, and observed state. At minimum capture:

- installation result and installed package version;
- `doctor`, `assess`, and `architecture` exit codes plus recommended action/claim boundary;
- application test count and exit code;
- `check` structure result and `present`, `reachable`, `enforced`, and `realClientVerified` states;
- `complete` structure, project command, business constraints, surface verification, negative/recovery evidence, module graph, and production-readiness states;
- `evidence status` counts and qualification;
- a new `simulated-persona` receipt ID and candidate fingerprint;
- whether each prior application P0/P1 remains, is newly exposed by AICG, or is outside AICG's scope;
- an independent reviewer decision that is separate from the Builder.

Do not enter aggregate totals, experience score changes, closure status, or production-grade claims until all ten rows have candidate-bound evidence and independent review.

## External validation dependencies

| Work package | Status | Prepared protocol | Result boundary |
| --- | --- | --- | --- |
| L2 real client / cross OS | `externally-blocked` | [real-client-cross-os-runbook.md](../../validation/real-client-cross-os-runbook.md) | No real client or OS cell has run. |
| L3 real-user / real-project pilot | `externally-blocked` | [real-user-pilot-protocol.md](../../validation/real-user-pilot-protocol.md) | No real participant or real project has run. |

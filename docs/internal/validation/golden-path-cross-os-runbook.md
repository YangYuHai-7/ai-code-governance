# Golden path cross-OS evaluation runbook

Manual, evaluator-authorized procedure. A green workflow conclusion is not platform evidence; only
validated per-OS receipts are.

## Inputs

- Exact Pack release under evaluation.
- Exact Codex CLI version (pinned into every receipt).
- Exact Node version at or above the 24 floor.
- Exact PostgreSQL version.
- Held-out evaluation set digest.
- Artifact retention in days.

## Procedure

1. Run the workflow manually (`workflow_dispatch`) with the inputs above. There is no schedule and
   no pull-request trigger.
2. Collect one receipt artifact per platform: `linux`, `darwin`, and `win32`.
3. Validate every receipt against `GoldenPathEvaluationReceipt v1` before it is used as evidence.
4. Feed the receipts into the certification evaluator. Do not hand-edit matrix entries.

## Platform rules

- Linux, macOS, and Windows are independent exact matrix entries.
- The Windows job is informational. A non-blocking Windows result must never be reported as verified
  Windows support; only a validated passing receipt for the claimed platform counts.
- A missing or failing platform stays unverified and blocks any three-platform claim.
- Secrets stay in the environment. Receipts and bounded logs are the only uploaded artifacts.
- The workflow publishes no package and deploys no application.

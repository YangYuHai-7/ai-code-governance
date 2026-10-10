# Golden path certification: current evidence gaps

Status: **Milestone 2 remains evidence-incomplete. Milestone 3 is not authorized.**

This record is generated from the certification evaluator's own gap vocabulary. It is updated only
from evaluator output; editorial rounding is not permitted.

## Why E4 is absent

- `missing-e3`: no current E3 agent-executable receipt exists for the exact evaluated matrix.
- `missing-held-out-case`: no held-out case has passed; the held-out provider harness is not wired
  into the CLI, so the dry command reports blocked provider-authority evidence.
- `missing-qualified-human`: no qualified-user acceptance is recorded. AI review is never
  qualified-human evidence.
- `insufficient-held-out-cases` / `missing-negative-probes`: no live evaluated held-out runs exist.
- `platform-missing:linux|darwin|win32`: the cross-OS workflow has not been executed with
  authorized evaluator inputs; a workflow conclusion alone is not platform evidence.

## What is already wired

- The certification evaluator decides E0-E4 and refuses E4 on any gap.
- `publicationDecision()` maps that verdict: below E4 the milestone stays evidence-incomplete and
  Milestone 3 stays blocked; an E4 verdict authorizes Milestone 3 without performing it.
- Qualified-user acceptance can only add gaps; a rejection forces the certification to blocked.
- Held-out loading and running enforce digest verification, overlap rejection, distinct runs, and
  provider-immutability checks.

## Remaining wiring before publication can move

1. Bind `publicationDecision()` into modules/capabilities/artifacts.mjs and the roadmap document.
2. Extend modules/stack-packs/maturity.mjs so a certified maturity claim also requires a certified
   certification result, not only an E4 receipt.
3. Wire the live held-out provider harness and the Codex adapter into `aicg evaluation`.
4. Executing the cross-OS workflow requires authorized evaluator inputs and remains external.

No E4, publication, or Milestone 3 claim follows from this document.

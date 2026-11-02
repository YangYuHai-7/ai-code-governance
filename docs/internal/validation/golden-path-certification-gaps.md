# Golden path certification: current evidence gaps

Status: **Historical reference E3 exists, but no E3 receipt is bound to the latest local matrix run. Milestone 2 remains evidence-incomplete, and Milestone 3 is not authorized.**

This record is generated from the certification evaluator's own gap vocabulary. It is updated only
from evaluator output; editorial rounding is not permitted.

## Why E4 is absent

- `stale-matrix-run` and `missing-e3`: the retained real-Agent E3 receipt refers to an earlier matrix run.
- `platform-missing:darwin`: that historical reference record cannot establish the latest macOS run.
- `missing-held-out-case`: no held-out case has passed; the held-out provider harness is not wired
  into the CLI, so the dry command reports blocked provider-authority evidence.
- `missing-qualified-human`: no qualified-user acceptance is recorded. AI review is never
  qualified-human evidence.
- `insufficient-held-out-cases`: no live evaluated held-out runs exist.
- `platform-missing:linux|win32`: the cross-OS workflow has not been executed with authorized
  evaluator inputs on those platforms; a workflow conclusion alone is not platform evidence.

The negative-probe receipt is separate from the reference E3 run. Its presence does not clear the
current E3 or platform gaps. Re-evaluate the full input set after a new authorized Agent run.

## What is already wired

- The certification evaluator decides E0-E4 and refuses E4 on any gap.
- `publicationDecision()` maps that verdict: below E4 the milestone stays evidence-incomplete and
  Milestone 3 stays blocked; an E4 verdict authorizes Milestone 3 without performing it.
- Qualified-user acceptance can only add gaps; a rejection forces the certification to blocked.
- Held-out loading and running enforce digest verification, overlap rejection, distinct runs, and
  provider-immutability checks.
- The live Codex adapter has executed structured requirement, architecture, bounded patch, and
  read-only review turns historically. The retained E3 receipt is bound to an earlier 14/14 matrix.
- Pack maturity already withholds a certified claim unless the certification result itself is E4.

## Remaining evidence before publication can move

1. An independent evaluator supplies and executes at least two structurally distinct held-out cases.
2. Authorized hosts produce bound Linux and Windows evaluation receipts.
3. A qualified human participant and independent observer complete the acceptance protocol.

No E4, publication, or Milestone 3 claim follows from this document.

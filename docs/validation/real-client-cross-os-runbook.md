# Real Client and Cross-OS Validation Runbook

## Status and claim boundary

- Work package: `L2`.
- Current status: `externally-blocked`.
- Blocking dependency: actual macOS, Windows, and Linux environments with the declared real Codex, Claude Code, and Cursor clients must execute this runbook against one frozen candidate.
- Repository tests, package smoke tests, simulated handlers, generated adapter files, and the presence of a client executable do not establish `real-client-verified` or cross-OS support.
- This document is an executable protocol, not evidence that any client or operating-system cell has run.

Use [templates/client-os-matrix.json](templates/client-os-matrix.json) as the blank execution ledger and [templates/external-evidence-receipt.json](templates/external-evidence-receipt.json) for each completed external run. Neither blank template is an evidence receipt.

## Roles and independence

| Role | Responsibility | Prohibited action |
| --- | --- | --- |
| Product Owner | Approves the declared client/OS/runtime matrix and the evidence retention policy. | Cannot convert a missing run into a pass. |
| Project Manager | Freezes the candidate, assigns cells, tracks receipts, staleness, and withdrawals. | Cannot approve technical acceptance or their own execution. |
| Environment operator | Executes one assigned cell and records exact commands, versions, and sanitized diagnostics. | Cannot be the sole independent reviewer for that cell. |
| Independent reviewer | Recomputes the candidate digest, inspects the actual client entrypoint replay, and checks negative/recovery evidence. | Cannot be the implementation owner or environment operator for the reviewed cell. |
| Release reviewer | Determines whether the declared matrix is complete enough for a human release decision. | Cannot infer certification from receipt counts or passing repository tests. |

An execution cell needs at least one reviewer who is independent from both the implementation owner and the environment operator. Any later `real-project` certification receipt remains subject to the stricter two-independent-reviewer requirement in [certification-evidence.md](../../references/certification-evidence.md).

## Consent, privacy, and anonymization

Before collecting host, client, organization, or project evidence:

1. Obtain explicit consent from the environment owner and any person whose interaction is recorded. Consent must name the candidate, collection scope, retention period, intended reviewers, and withdrawal channel.
2. Store the signed consent record outside this repository in access-controlled storage. The repository receipt contains only a pseudonymous reference and a digest, never a name, email address, signature, customer name, or account identifier.
3. Do not copy source code, secrets, credentials, internal URLs, raw prompts, full terminal history, or customer data into the receipt. Record sanitized command names, exit codes, bounded diagnostics, and hashes of separately retained artifacts.
4. Mark `anonymized=true`, `sourceCodeIncluded=false`, `rawLogsIncluded=false`, and `secretsIncluded=false` only after a privacy review confirms those facts.
5. If redaction would remove evidence needed to support a claim, keep the result `unverified` or `blocked`; do not weaken privacy controls to manufacture a pass.

## Candidate freeze and binding

The Project Manager must complete these steps before assigning any matrix cell:

1. Build exactly one candidate tarball using the approved package workflow.
2. Record package name, tool version, full source commit when available, byte size, SHA-256, freeze time, and storage location in the working copy of `client-os-matrix.json`.
3. Have a reviewer independently recompute the SHA-256 from the stored tarball. A copied digest without recomputation is not candidate verification.
4. Make the tarball immutable for the run. Any rebuild, repack, source change, or digest mismatch creates a new candidate and invalidates unfinished cells.
5. Install only from the frozen tarball using a project-local dependency. Do not substitute the public npm `latest`, a global CLI, or a source checkout.

Every receipt must repeat the exact candidate SHA-256. A syntactically valid digest is not proof of artifact identity; the operator and reviewer must record their independent digest commands and results.

## Matrix declaration

Before execution, the Product Owner declares:

- the OS versions and architectures in scope;
- supported Node.js major versions in scope;
- the exact client products and versions in scope;
- which generated/native client entrypoint, gate, and hook behavior each cell claims;
- required shells or launch contexts;
- the evidence expiry time and events that cause early staleness.

The blank matrix lists macOS, Windows, and Linux for Codex, Claude Code, and Cursor. A cell may be removed only by a recorded scope decision; removal does not prove it unsupported or verified. An unavailable environment is `unverified`, not `passed`.

## Per-cell execution

Run each cell in a clean, disposable checkout whose path includes spaces and non-ASCII characters. Preserve the original fixture separately.

### 1. Record the environment

Record without personal or host identifiers:

- OS name, version, architecture, and patch level;
- shell or launch context;
- Node.js, npm, Git, and real client versions;
- client installation source and actual executable path in sanitized form;
- whether the repository is greenfield or brownfield;
- the declared adapter, gate, and hook scope.

### 2. Verify and install the frozen candidate

Recompute the tarball SHA-256 on the target host and compare it with the frozen matrix value before installation. Then install it project-locally and record the exact command and exit code. Stop the cell as `blocked` on mismatch; do not continue with a different artifact.

### 3. Run the project-local CLI baseline

Use project-local entrypoints to run and record:

```text
npm exec -- aicg doctor . --json
npm exec -- aicg assess . --json
npm exec -- aicg architecture . --json
npm exec -- aicg init . <explicit approved options>
npm exec -- aicg check . --json
npm exec -- aicg complete . --verify <one discovered safe project command> --json
npm exec -- aicg evidence status . --json
```

The `init` decision must explicitly bind the selected client, lifecycle, governance depth, locale, artifact language, and project-local invocation. Record exact exit codes and the separate `present`, `reachable`, `enforced`, and `realClientVerified` states.

### 4. Replay the actual client entrypoint

Launch the declared real client through its normal user-facing entrypoint inside the initialized repository. Use a fixed, harmless request that does not reveal the expected file path and asks the client to state the repository's canonical governance source, selected verification command, and one candidate-specific governance marker. Record:

- the exact client version and launch context;
- the sanitized request and response artifact digests;
- the entrypoint or adapter the client actually reported or loaded;
- whether the client followed a candidate-specific instruction that was unavailable from its generic defaults;
- any manual file opening, prompt injection, or operator assistance.

Manual navigation to a governance file, a client merely existing on `PATH`, or a synthetic direct handler invocation is not a real-client load replay. If the client cannot expose enough evidence to distinguish automatic entrypoint loading from manual discovery, the state remains `unverified`.

### 5. Run negative and recovery probes

Use only the disposable checkout. Record both the failing diagnostic and the recovery result.

1. **Candidate mismatch:** present a copied receipt or matrix value bound to a different candidate. The review must reject it as stale or mismatched.
2. **Managed adapter drift:** alter one generated adapter without changing its canonical source. `aicg check` must fail and identify the drift; restore through the approved sync path and rerun the check.
3. **Missing or unreachable client entrypoint:** remove or disable the client-specific entrypoint in the disposable copy. The claimed real-client state must not remain verified; restore it and replay the actual client.
4. **Hook scope, when claimed:** demonstrate that Git invokes the configured hook, then break the governed condition and observe a non-zero block. Restore the condition and show the same path succeeds. A direct handler call does not prove Git hook reachability.
5. **Path and line-ending boundary:** rerun the relevant baseline from the declared path-with-spaces/Unicode checkout and exercise the platform's native line-ending and path form.

A pass requires the positive replay plus its applicable negative and recovery evidence. Missing environments, unavailable clients, redacted-away diagnostics, or inapplicable probes without a reason remain `unverified` or `blocked`.

## Review and result states

The operator completes a receipt, then the independent reviewer checks:

- consent and privacy fields are complete;
- the candidate digest was independently recomputed;
- the operator, implementation owner, and reviewer are distinct where required;
- commands and exit codes are recorded rather than summarized as “worked”;
- the actual real-client entrypoint was exercised;
- each applicable negative probe failed for the expected reason and its recovery succeeded;
- no simulation qualification, repository test, or artifact presence was promoted to real-client evidence.

Allowed cell states are `not-run`, `in-progress`, `passed`, `failed`, `blocked`, `unverified`, `stale`, and `withdrawn`. Only reviewed cells may become `passed`. Matrix completion never automatically sets `certified=true`.

## Expiry, staleness, and withdrawal

Each executed receipt must have an explicit `observedAt` and `expiresAt`. It becomes `stale` at the earliest of:

- `expiresAt` is reached;
- the candidate fingerprint changes;
- the relevant client, OS, runtime, adapter, gate, or hook configuration changes outside the declared compatibility range;
- the retained evidence can no longer be retrieved or independently reviewed;
- consent is withdrawn.

The Project Manager records the invalidating event and removes stale evidence from current claim counts. Stale evidence may remain as clearly labeled historical metadata if consent permits, but it cannot support the current candidate.

The environment owner or recorded participant may withdraw through the consent channel. On withdrawal:

1. stop further collection and mark the receipt and matrix cell `withdrawn`;
2. remove it from all claim and eligibility calculations;
3. delete identifiable/raw artifacts according to the agreed retention policy;
4. retain only a minimal anonymized tombstone containing the receipt ID, withdrawal time, and reason category when consent permits;
5. require new consent and a new receipt ID before any rerun.

## Completion rule

`L2` remains `externally-blocked` until actual operators execute every declared cell, independent reviewers accept the candidate-bound evidence, and the Product Owner and Release reviewer approve the final declared scope. Even then, the result proves only the recorded client/OS combinations for the recorded candidate and validity window; it does not prove customer adoption, production readiness, or universal platform support.

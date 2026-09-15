# Verified capability candidates and explicit promotion

Capability growth captures reusable implementation knowledge without turning every task into a document-generation workflow. The current completion integration is **candidate-only**, with **no automatic promotion**. It writes no Skill, registry, manifest, catalog, index, or memory. Explicit harvest and promotion retain separate write authorization.

## Completion eligibility

`aicg complete . --task-level L2 --verify "npm run test" --json` may return candidates only when:

1. The declared route is L2/L3 and `verified` against actual Git minimum-level evidence.
2. The explicitly selected, discovered project verification command passes.
3. Source inputs remain unchanged across verification and can be read reliably.
4. The current diff contains a semantic production-source change to a detected reusable public capability.

Read-only, governance/prose, format/comment-only, test/fixture, temporary-script, config/migration-only, or non-reusable changes are not-applicable to completion harvest. The actual JSON uses `status: "skipped"`, `eligible: false`, and a reason such as `no-production-source-change` or `no-reusable-public-capability-change`; it does not emit a fabricated `not-applicable` receipt. Missing/failed verification or undeclared/under-declared routes also skip. A completed task need not generate a Skill or harvest receipt.

Verification evidence includes the selected command, exit outcome, output digest, and input binding. A successful unrelated command is not complete product behavior proof. Changed or unreadable source evidence cannot be re-labeled verified. When eligible, `status: "dry-run"` carries candidate decisions without writes.

## Discovery and deduplication

The current deterministic detector handles a limited set of public implementation patterns: an installed Axios import/require leading to an exported `axios.create()` client, and non-TSX/JSX exported policy/guard/authorization implementations with permission semantics. Type-only declarations, incidental names, and unexported helpers are insufficient. This is bounded source analysis, not a general language compiler or proof of every public capability.

Candidates carry a stable capability ID, implementation paths/fingerprint, public entrypoint evidence where established, command/test references, owner, review date, and remaining gaps. Completion compares existing records in this order:

1. Stable capability ID: propose `update-existing`.
2. Public entrypoint or implementation path overlap: propose `extend-existing`.
3. No match: propose `create-new`.
4. Ambiguous matches, inactive records, or conflicting candidates: `no-skill-with-reason`.

These are proposals. They never overwrite adopted guidance as an automatic completion side effect.

## Explicit harvest

```bash
aicg harvest . --dry-run --json
# Apply only when this write has been requested/approved.
aicg harvest . --yes --json
```

The standalone command is intentionally a discovery interface. Unlike completion eligibility, it can preview candidates before project tests have run. It records `not-run-by-harvest`; neither `--yes` nor discovery means verified implementation. Exact chat request “提取项目能力” uses the same kernel and requires a current `--approve <planHash>` for writes.

Approved harvest may record candidate Skills and `docs/ai/capability-evolution.json`, then check managed output. Current outcomes include `candidate-recorded`, `no-skill-with-reason`, `review-required`, and `not-run`; `adopted-promoted` belongs to explicit promotion. Capability states are `candidate`, `adopted`, `superseded`, and `retired`.

Adopted implementation drift creates review evidence bound to the observed fingerprint. It preserves the existing adopted record rather than silently replacing the Skill. Owner review remains necessary.

## Explicit promotion

```bash
aicg promote . --id <capability> --entrypoint <implementation-path> --verify "npm run <script>" --yes
```

Only a current detected candidate without pending review can be promoted. The entrypoint must match its current implementation path; verification must exactly match a discovered safe npm script and pass before the write. Chat request “晋升项目能力” takes `capabilityId`, `publicEntrypoints`, optional `consumerPaths`, and `verificationCommand` through config, followed by exact plan approval.

This records operator confirmation plus a successful command. Optional consumers remain operator-declared and unverified. It does not prove automatic real-client loading, correctness of all consumers, or prevention of bypass calls. Verified re-export/consumer analysis and repository-specific bypass enforcement need separate work and evidence.

For a project HTTP client, future adopted guidance such as `use-project-http-client` should identify the actual import, auth/session/error/retry boundaries, owner, and representative verification. An authorization Skill such as `authorize-project-operation` should identify the real enforcement boundary and denial/tenant semantics. Never invent such semantics from a filename or generic framework advice.

## Future evidence obligations and current limits

Keep product input evidence distinct from governance output evidence. The design labels `product_change_fingerprint` and `governance_output_fingerprint` describe that separation; they are not a claim that the CLI emits a universal two-fingerprint finalize receipt. Current CLI records use their implemented camelCase schema, including `productChangeFingerprint`, `implementationFingerprint`, and completion verification `inputEvidence`.

| Probe obligation | Evidence required before claiming it enforced |
| --- | --- |
| `feature-skill-harvest-freshness` | Current eligible source/verification binding rejects stale or changed inputs; this does not require harvest on every task |
| `capability-promotion-evidence` | Missing candidate/entrypoint/command or failed verification prevents adoption |
| `skill-implementation-drift` | Changed adopted implementation is reported for review without silent replacement |
| `canonical-capability-reuse` | A separately configured, scoped negative probe proves actual bypass rejection in the target project |

The final obligation is not provided merely by candidate/adopted records. No unconditional background prepare/finalize service or CI model execution is implied. Record `stated`, `reachable`, `enforced`, and `verified` by their specific scope. Local structural tests and macOS execution do not prove real Codex/Claude Code/Cursor loading or Linux/Windows execution; those remain `not yet verified` without current evidence.

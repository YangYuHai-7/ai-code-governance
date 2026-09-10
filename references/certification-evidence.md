# Certification evidence receipts

`aicg evidence` provides a local-first ledger for pilot and real-project evidence. It does not certify a project, reviewer identity, production readiness, or customer outcome.

## Commands

```bash
aicg evidence record . --config docs/ai/receipt.json --yes
aicg evidence status . --json
aicg evidence export . --json
```

`record` validates and appends one repository-local JSON receipt to `docs/ai/certification-evidence.json`. `status` summarizes evidence without promoting it. `export` emits an anonymized structured snapshot for human review.

## Required receipt fields

- `schemaVersion: 1`, unique kebab-case `id`;
- `evidenceKind: simulated-persona | real-project`;
- `toolVersion` and the exact SHA-256 `candidateFingerprint`;
- capability `packId`, `projectMode`, `os`, and `agent`;
- bounded `durationMs`, `outcome`, executed `verification`, and findings;
- `anonymized: true` and `sourceCodeIncluded: false`;
- 1–5 experience ratings for installation, clarity, next step, recovery, and confidence;
- structured reviewers and acknowledgements.

The config path must stay inside the target repository, cannot traverse a symlink, and is limited to 32 KiB. Raw customer source, secrets, internal URLs, prompts, or original business data must not be copied into a receipt.

## Claim boundary

- `simulated-persona` is always `simulation-only`; it never satisfies the real-project condition.
- A passing `real-project` receipt with two declared independent reviewers is only `eligible-for-human-certification-review`.
- AICG requires a candidate fingerprint and validates its SHA-256 format, but the operator must supply and independently verify the digest; AICG does not prove that it identifies the installed artifact. It also does not verify human identity or automatically change a capability pack to `certified`.
- Certification still requires the complete B-to-C conditions, including two structurally different real projects, relevant negative probes, the claimed platform matrix, expert review, compatibility boundaries, and a human approval decision.

If evidence is stale, incomplete, simulated, or bound to another candidate, the public claim remains `unverified`; current AICG does not automatically detect a valid-looking digest that belongs to a different artifact.

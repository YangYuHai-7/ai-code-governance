# Repository-family governance and evidence-backed project conventions

Status: remediation foundation implemented on 2026-09-17; release certification remains pending.

Implemented in the current worktree:

- Git-submodule and bounded nested-Git repository-family discovery with recursively isolated per-member facts;
- orchestrator-only root governance and a bounded `repository-family.json` index;
- one combined `aicg init --family` preview/approval hash with autonomous member plans, member-first apply, per-repository post-checks, and family-wide rollback;
- repository-local layout convention candidates with evidence digests, explicit owner decisions, and full-managed routing only after adoption;
- structured npm and Maven command trust with fail-closed skip, ignored-failure, hook, mutation, and long-running checks;
- auditable `.aicgignore` policy digests, bounded hidden-content snapshots, overflow gates, and evidence-bound high-risk approvals;
- unmanaged executable-Skill, parent-manifest boundary, and topology-migration gates; and
- effective scan-input plan fingerprints that include deep files, family units, command sources, and ignore policy.

Still outside this remediation increment: non-Git workspace boundary discovery beyond the existing monorepo mode, a standalone `aicg conventions` command family, family-wide delivery completion/replay after initialization, OpenSpec authority coordination, and release certification across every supported operating system and real client.

## Problem

AICG 0.2.x can scan a directory tree and generate structurally valid governance, but that is insufficient for a brownfield repository family. A directory can contain several autonomous Git repositories, unrelated stacks, different verification commands, and project-specific conventions. Treating the whole tree as one repository causes four classes of false claims:

1. member stacks and commands are merged into the orchestrator;
2. generic stack shells are presented as project governance;
3. unregistered project Skills and adapters can exist outside the manifest while `aicg check` stays green; and
4. discovered verification commands may skip tests, ignore failures, or mutate the project.

The remediation must be generic. It must not encode one customer's repository names, paths, business rules, or recent feature history.

## Required product outcome

The initialization pipeline becomes:

```text
repository topology
  -> bounded governance units
  -> per-unit stack, source, test, command, and counter-evidence facts
  -> evidence-backed convention candidates
  -> explicit owner decisions
  -> canonical Skills, machine routes, adapters, and manifest closure
  -> structurally trusted or explicitly executed verification
  -> stated / reachable / enforced / verified reporting
```

AICG must fail closed when it cannot establish a boundary. It must report a topology, evidence, command, ownership, or routing gap instead of silently falling back to a single-repository success claim.

## Governance units and repository families

The model below separates the implemented Git-repository boundary from future workspace-boundary expansion. The current release discovers `.gitmodules` and nested `.git` markers. npm/Gradle/Maven/Go workspace decomposition remains future scope unless a nested Git boundary also establishes an autonomous member.

### Discovery

Repository-family discovery currently identifies bounded autonomous units from repository-local evidence without executing Git:

- `.gitmodules` entries with safe, normalized repository-relative paths;
- nested `.git` directories or files;
- a single repository fallback only when no stronger boundary exists.

A nested Git boundary is autonomous by default. The parent scanner records the member but does not consume its manifests, dependencies, source files, tests, or commands as parent facts. Missing, unsafe, linked, duplicated, overlapping, or uninitialized members remain visible gaps.

```json
{
  "schemaVersion": 1,
  "role": "orchestrator",
  "observedTopology": {
    "kind": "git-submodules",
    "source": ".gitmodules"
  },
  "authority": {
    "root": "orchestrator",
    "members": "autonomous"
  },
  "members": [
    {
      "id": "service-api",
      "path": "services/api",
      "repositoryKind": "git-submodule",
      "governanceMode": "autonomous",
      "members": []
    }
  ],
  "boundaries": {
    "parentOwnsMemberFiles": false
  }
}
```

The stable configuration does not store member HEADs, dirty state, credential-bearing remotes, or transient command results. Those belong to runtime evidence.

### Ownership

The orchestrator owns only files inside its repository boundary. A family manifest references member manifests; it never claims ownership of member files.

```json
{
  "schemaVersion": 2,
  "scope": {
    "repositoryRoot": ".",
    "boundary": "current-git-repository"
  },
  "members": [
    {
      "id": "service-api",
      "path": "services/api",
      "manifestPath": ".ai-governance/manifest.json",
      "required": true
    }
  ]
}
```

`check` rejects a parent manifest entry that crosses a nested repository boundary.

### One approved family initialization

`aicg init <root> --family --dry-run` prepares independent artifact and execution plans for every scanned member plus the orchestrator. The displayed family `planHash` binds each autonomous plan hash. Apply requires that exact family hash, rechecks every repository before the first write, applies members before the orchestrator, runs `aicg check` semantics in every repository, and restores every repository snapshot if any apply or post-check fails. AI completion remains separate per repository; family initialization is deterministic and does not broaden product-code authority.

## Evidence-backed project conventions

### Evidence collection

Convention detectors are bounded, deterministic, framework-aware pure functions. Each detector records:

- governance unit and stack version evidence;
- inspected and matched files;
- distinct feature or module areas;
- normalized facts and stable evidence IDs;
- source digests;
- counter-evidence and exceptions;
- coverage gaps; and
- whether the observation is repository-wide or scope-local.

At least three matches across at least two feature areas are the default threshold for a repository-wide observed candidate. A single feature can only produce a scope-local candidate. Thresholds are configurable but remain visible in the plan.

AI assistance may render or summarize accepted structured facts. It must not add a claim without an evidence ID, broaden scope, erase counter-evidence, or promote a candidate.

### Claim and capability states

Claims and capability status are separate axes.

| Claim class | Meaning |
| --- | --- |
| `observed` | Repeated current structure; descriptive, not automatically normative. |
| `new-code-standard` | An owner-approved rule for new code. |
| `business-invariant` | An owner-confirmed behavior with requirement, code, and test evidence. |
| `unverified` | Conflicting, stale, incomplete, dynamic, or insufficient evidence. |

| Capability state | Meaning |
| --- | --- |
| `stated` | The canonical rule exists. |
| `reachable` | A machine route selects it for the intended task. |
| `enforced` | A named negative probe proves the gate fails closed. |
| `verified` | The approved command ran successfully against unchanged inputs. |

Owner decisions are evidence-bound and use domain-specific actions:

- `keep-observed`
- `adopt-for-new-code`
- `confirm-business-invariant`
- `defer`
- `reject`

Changing topology, scope, evidence, counter-evidence, source bytes, or a selected command invalidates the decision hash.

### Candidate catalog

`docs/ai/project-conventions.json` stores evidence-backed candidates and gaps. Candidate Skill documents are user-owned seeds and are not executable routes. An exact evidence-bound `add` decision promotes the canonical Skill to full-managed ownership and adds its route; `defer` and `reject` never create an executable route.

Every generated project Skill contains:

- When to use
- When not to use
- Observed current patterns
- Approved new-code decisions
- Confirmed business invariants
- Conflicts and unverified gaps
- Verification matrix
- Evidence catalog

Observed text must not use unconditional normative language unless the owner approved a corresponding standard.

Initialization no longer converts every source directory and file digest into Memory pages. It creates only `README.md`, `SCHEMA.md`, and an empty `INDEX.json`. Structural scanning still feeds bounded project-surface candidates such as HTTP entrypoints, services, persistence, client API, state, screens, components, and tests. A maximum of eight surface candidates is emitted per repository, and each stays an unrouted seed until an exact evidence-bound owner decision adopts it.

## Verification command trust

Commands use structured `cwd + argv[]` data, not arbitrary shell strings.

```json
{
  "id": "service-api:test",
  "unitId": "service-api",
  "cwd": "services/api",
  "argv": ["mvn", "-pl", "service", "-am", "test"],
  "source": {
    "kind": "pom",
    "path": "services/api/pom.xml",
    "sha256": "..."
  },
  "sideEffects": ["target-output"],
  "trust": {
    "level": "untrusted",
    "reasons": ["surefire-testFailureIgnore=true"]
  },
  "execution": {
    "status": "not-run"
  }
}
```

Trust levels are:

- `declared`: discovered but not statically assessed;
- `structurally-trusted`: no known skip, ignored failure, watch, publish, deploy, fix, write, or hidden lifecycle hook was found; and
- `execution-verified`: explicitly executed, nonzero failure semantics proven, and inputs unchanged.

Maven discovery evaluates parent, reactor, profile, Surefire/Failsafe, `skipTests`, `maven.test.skip`, `testFailureIgnore`, and no-matching-test behavior when statically resolvable. npm discovery evaluates pre/post hooks and known mutating or long-running arguments. Unknown dynamic configuration remains unverified.

## Machine routing and manifest closure

`docs/ai/skill-routes.json` is the machine routing source. `context-map.yaml` is derived from it.

Each adopted project Skill must have:

- a safe canonical path;
- at least one route;
- evidence and decision hashes;
- selected client adapters;
- a manifest entry for the canonical source and every adapter; and
- positive and neighboring negative route fixtures.

Adapters bind the canonical digest, transform ID, and rendered digest. A canonical change produces `sync-required`; a direct adapter change produces `drift`. `check` fails for unregistered `SKILL.md` files on executable governance surfaces.

Manifest file roles replace the ambiguous single ownership field:

- `canonical-human`
- `generated-full`
- `generated-block`
- `adapter`
- `evidence`
- `retained-legacy`

## Auditable scan exclusions

Built-in exclusions for generated output, caches, logs, and opaque non-code assets remain deterministic. Project `.aicgignore` rules are policy inputs, not invisible scanner behavior.

The scan records the ignore file digest, normalized rules, match counts, bounded samples, categories, hidden-content digests, and unverified exclusions. Directory exclusions are always reviewable. Rules that can hide governance, manifests, lockfiles, or product source block checking unless an exact evidence-bound exclusion decision approves the current policy and hidden-content snapshot. Incomplete snapshots and review-list overflow fail closed.

An exclusion-aware scan may be complete relative to its approved policy. It must not claim to have scanned excluded content.

## Consistency and approval fingerprints

Mutable governance state is emitted as a full-managed machine file. Human README files link to that state instead of duplicating depth, topology, clients, stacks, or lifecycle facts.

The execution plan fingerprint binds:

- scanner policy and version;
- repository topology and unit roots;
- effective inventory and consumed source digests;
- ignore policy and exclusion decisions;
- selected convention evidence and counter-evidence;
- verification command source, cwd, argv, and trust;
- routes, canonical Skills, adapters, and costs; and
- config, manifest, and artifact preimages.

Ignored runtime logs do not invalidate a plan. A changed deep source, manifest, member boundary, ignore policy, command, or evidence item does.

## OpenSpec authority

Provider detection is not adoption. An owner-selected coordinated integration records one authority for current behavior, active change, design, tasks, AI governance, runtime state, and delivery evidence.

In coordinated mode, a work unit stores the change ID, canonical paths, and digests. It does not copy requirements, design, or tasks. Reading an active draft and planning, completing, or archiving it requires an explicit change ID. A family root owns cross-repository OpenSpec; members reference it.

## CLI shape

The design extends the current lifecycle:

```bash
aicg assess . --json
aicg conventions . --json
aicg conventions . --config decisions.json --dry-run
aicg conventions . --config decisions.json --approve <planHash>
aicg conventions verify . --command-id <id> --json
aicg route . --paths <path...> --json
aicg check .
aicg check . --local
aicg complete . --family-evidence <repository-relative-json>
```

Family-wide writes, if later supported, require one preview that lists every repository and operation, one exact approval, and rollback of every touched repository on failure. Ordinary `sync .` remains local to the current repository.

## Migration and implementation order

Schema v1 remains readable. A v1 managed project that is now detected as a repository family reports `migration-required`; `sync` must not silently preserve or refresh the false single-repository classification.

Implementation order:

1. Regression fixtures and negative probes for a generic four-member repository family.
2. Repository-family discovery, assessment, and architecture classification.
3. Per-unit stack, dependency, source, test, and command facts.
4. Effective scan-input fingerprints and auditable exclusions.
5. Verification command trust, starting with Maven and npm.
6. Registered project Skills, route registry, adapter provenance, unmanaged-governance gates, and managed governance state.
7. Convention detector registry and schema v2 candidate workflow.
8. OpenSpec authority and family completion evidence.
9. Full, smoke, package, cross-platform, and real-client validation.

No release may claim repository-family support until a child failure blocks family completion, a parent gitlink mismatch blocks delivery, unmanaged governance fails check, false-success verification commands are rejected, and real clients load member governance without the orchestrator overriding implementation rules.

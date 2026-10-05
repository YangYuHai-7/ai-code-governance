# Golden-path Core completion design

## Status

Approved on 2026-10-05 for Milestone 2 implementation planning.

This design defines the first production-capable AICG golden path:

- React with Vite;
- Mantine;
- NestJS with the Fastify adapter;
- Drizzle ORM;
- PostgreSQL.

It closes the design boundary for Milestone 2. It does not claim that the path is executable or certified before the evidence requirements in this document pass.

## Decision summary

AICG will implement a versioned `GoldenPathPack` contract over the generic Delivery Core. The Pack owns stack-specific compatibility, architecture constraints, generation guidance, verification gates, failure classification, repair strategies, and known limitations. The Delivery Core continues to own approved meaning, session state, authority, budgets, checkpoints, traceability, evidence, and completion decisions.

The Pack will be evaluated through three distinct assets:

1. deterministic contract and negative-probe fixtures;
2. a reference full-stack application used for reproducible regression;
3. evaluator-owned held-out requirements and repositories that are unavailable to implementation prompts before evaluation.

This structure was selected over a fixture-only approach because a fixed example cannot establish generalization. External open-source repositories may supplement later evaluation, but they are not the first authoritative benchmark because their versions and behavior drift independently of AICG.

## Outcome

A developer unfamiliar with this stack can describe a bounded business outcome, answer only material owner questions, and use the Core workflow to obtain:

- an approved Requirement IR;
- a version-compatible Architecture IR and bounded implementation plan;
- recoverable Agent execution within explicit authority;
- a locally runnable full-stack result;
- current architecture, build, test, contract, database, migration, security, accessibility, observability, and performance evidence where applicable;
- an acceptance report that identifies incomplete or non-applicable evidence honestly;
- residual risks and tested rollback instructions.

Completion is a Core decision derived from current evidence. A generated rule, successful file write, passing unit test, or runnable development server is not independently sufficient.

## Non-goals

Milestone 2 does not:

- implement AICG Studio or another product UI;
- add broad framework or database support;
- publish a general React, NestJS, Drizzle, or PostgreSQL certification claim;
- make Skills, Plugins, MCP tools, or SDKs independent policy or state owners;
- add cloud deployment, hosted collaboration, or production infrastructure provisioning;
- make external release, credential, account, or billing decisions for the owner;
- certify an Agent, operating system, framework minor, or database major without current evidence for that exact matrix entry;
- treat AI-simulated review as qualified-human acceptance.

## Architectural boundaries

```text
natural-language requirement
            |
            v
Requirement IR + Architecture IR
            |
            v
generic Delivery Core
  - canonical state
  - authority and budgets
  - checkpoints and recovery
  - traceability and completion
            |
            v
GoldenPathPack
  - compatibility policy
  - architecture policy
  - generation constraints
  - quality matrix
  - failure and repair catalog
  - known limitations
            |
            v
bounded Agent adapter + workspace transaction
            |
            v
generated or modified full-stack project
            |
            v
managed verification drivers
            |
            v
Evidence IR + Completion Contract
```

The dependency direction is strict:

- Delivery Core contracts do not import a stack Pack or framework-specific implementation.
- A Pack implements Core extension contracts and may use read-only repository facts.
- Verification drivers execute only normalized argument arrays approved by Core authority; Pack configuration cannot introduce arbitrary shell text.
- Agent adapters cannot mark Pack gates complete, rewrite evidence, expand authority, or promote Pack maturity.
- CLI and future product surfaces call the same Core contracts and do not duplicate Pack logic.

## GoldenPathPack contract

The first implementation introduces a machine-validated Pack contract with the following sections.

| Section | Required content |
| --- | --- |
| Identity | Pack ID, contract version, release, lifecycle, maturity, source digest |
| Compatibility | Exact evaluated versions, allowed version expressions, runtime and package-manager assumptions, incompatible combinations |
| Detection | Required and forbidden repository signals, lockfile expectations, unresolved-version behavior |
| Architecture | Module types, allowed dependency directions, public entrypoints, composition roots, framework boundaries |
| Generation | Required files and behaviors, forbidden shortcuts, default decisions, owner-decision triggers |
| Quality matrix | Required gates, applicability rules, runner plan, timeout and artifact budgets, evidence freshness |
| Failure catalog | Stable failure code, owning contract, severity, evidence, bounded repair actions, escalation rule |
| Repair catalog | Eligible repairs, maximum attempts, invalidation scope, rollback or stop behavior |
| Known limitations | Unsupported versions, repository shapes, runtime surfaces, and unresolved evidence |

Pack parsing is fail-closed. Unknown required fields, unresolved exact versions, incompatible version combinations, ambiguous runner commands, missing gate ownership, or unsupported repository shapes prevent executable or certified status.

The existing capability-pack registry remains a discovery and migration source until the new contract is adopted. Detection, lifecycle, executable support, and certification remain separate fields throughout migration.

## Initial version policy

The Pack records both an allowed range and the exact resolved versions used by each evaluation. Public claims are derived from exact passing matrix entries, never from a broad semver expression alone.

The initial candidate line is:

| Component | Candidate boundary | Policy |
| --- | --- | --- |
| Node.js | `24.15.0` or newer compatible Node 24 minor | Required by the selected NestJS toolchain floor; exact runtime recorded |
| React | React 19 | Exact React and React DOM versions must match the evaluated lockfile |
| Vite | evaluated Vite 8 minor | Lock current minor; upgrade through a separate compatibility evaluation |
| Mantine | Mantine 9 | Core packages share one evaluated minor and patch set |
| NestJS | NestJS 12 | ESM-only project shape; Nest packages share one evaluated release line |
| Fastify | Fastify 5 through the Nest adapter | Full request, parameter, query, and response schemas are required at transport boundaries |
| Drizzle | latest non-prerelease line that passes the implementation evaluation | RC, beta, and next tags are excluded from production claims |
| PostgreSQL | PostgreSQL 18 current minor | Exact server version and extensions are evidence facts |

The implementation plan must resolve and record exact package versions before generator or evaluator work begins. If the compatible Drizzle release is unresolved or requires a prerelease, the Pack remains non-production and the issue returns for an explicit compatibility decision.

Version checks use manifest and lockfile facts. Missing lockfiles, conflicting workspace resolutions, prerelease packages, unsupported database servers, or undeclared runtime versions block the production profile instead of selecting generic guidance.

The initial policy was checked against the following primary sources on 2026-10-05:

- [React versions](https://react.dev/versions);
- [Vite releases](https://vite.dev/releases);
- [Mantine releases](https://mantine.dev/changelog/all-releases/);
- [NestJS migration guide](https://docs.nestjs.com/migration-guide);
- [Fastify v5 migration guide](https://fastify.dev/docs/latest/Guides/Migration-Guide-V5/);
- [Drizzle PostgreSQL guide](https://orm.drizzle.team/docs/get-started-postgresql) and [migration fundamentals](https://orm.drizzle.team/docs/migrations);
- [PostgreSQL versioning policy](https://www.postgresql.org/support/versioning/).

These links are review inputs, not permanent proof. The compatibility resolver and evaluation receipts own the current supported matrix after implementation.

## Generated application architecture

The golden path produces a modular monolith with separately runnable web and API applications and a shared contract boundary. It does not generate independently deployable microservices.

### Frontend

The React application is organized by feature. Each feature may expose a public entrypoint and own its view composition, state transition adapters, API calls, and tests. Shared UI contains reusable presentation only; it does not become a second business layer.

Required boundaries:

- Vite configuration and application bootstrap are composition roots.
- Pages coordinate feature entrypoints but do not implement persistence or business rules.
- Mantine wrappers remain presentation components; domain behavior is not embedded in theme or generic component helpers.
- Remote calls pass through a typed API client generated from or checked against the canonical HTTP contract.
- Server state, local interaction state, and form state remain distinguishable.
- Accessible names, keyboard operation, focus behavior, loading, empty, error, and destructive confirmation states are covered by applicable tests.
- Feature-private modules cannot be imported through relative cross-feature paths.

### Backend

The NestJS application uses module boundaries with explicit transport, application, domain, and infrastructure responsibilities.

Required boundaries:

- Controllers translate the Fastify transport contract into named, validated inputs and call application use cases.
- Application services coordinate use cases and transaction scopes without owning HTTP behavior.
- Domain code contains business invariants and cannot import NestJS, Fastify, Drizzle, or environment configuration.
- Infrastructure adapters implement repository, clock, identity, telemetry, and persistence ports.
- NestJS modules and bootstrap code are composition roots.
- Fastify request or reply objects cannot escape the transport layer.
- Actor identity comes from an authenticated boundary and cannot be accepted from a business request body.
- Error mapping is centralized and contract-tested.

### Data and migrations

Drizzle schema definitions and version-controlled SQL migrations are source-controlled production artifacts. Production completion requires migration generation, review, application against a clean database, application against the supported previous schema, and forward-recovery evidence.

Required boundaries:

- repositories accept a transaction-capable data access port rather than creating hidden transactions;
- use cases own transaction boundaries for multi-write invariants;
- database uniqueness, foreign-key, check, and concurrency constraints reinforce applicable domain invariants;
- optimistic or pessimistic concurrency behavior is explicit where lost updates are possible;
- destructive migrations require an owner-approved rollout and rollback or forward-recovery plan;
- `push`-style schema synchronization is excluded from the production completion path;
- migrations never embed secrets or environment-specific identifiers.

## Reference workload

The reproducible reference application is a small multi-user work-tracking product. It exercises more than CRUD without becoming a product in its own right.

The workload includes:

- account authentication and session expiry;
- organization membership with bounded roles;
- boards and work items with explicit state transitions;
- tenant-scoped reads and writes;
- optimistic concurrency for conflicting work-item updates;
- immutable audit entries for material state changes;
- filtering and pagination;
- one compatible schema evolution and one deliberately unsafe migration fixture;
- a responsive, accessible web flow for the primary user journey.

All names, identities, credentials, and records are synthetic. External identity providers, payments, email delivery, and cloud infrastructure are excluded. Their absence must be visible in known limitations rather than hidden behind mocks.

## Architecture enforcement

The TypeScript analyzer extends the current module graph instead of adding a parallel architecture engine. It resolves configured workspace aliases and classifies files into Pack module types before checking:

- dependency cycles;
- forbidden layer direction;
- cross-feature private imports;
- imports that bypass public entrypoints;
- domain dependencies on framework or persistence packages;
- transport objects outside controllers and transport adapters;
- direct database access outside infrastructure adapters;
- composition-root-only dependency construction;
- schema and contract ownership.

Static analysis can prove structural violations, but it cannot prove cohesion, single responsibility, or correct business meaning by itself. Those remain structured review signals bound to named modules and evidence. AICG must not label them mechanically enforced without a reliable negative probe.

## Risk-activated requirements

Requirement compilation activates non-functional profiles from explicit requirement facts and repository evidence. Every activated item maps to an architecture decision, gate, evidence location, and owner. `not-applicable` requires a reason.

The first Pack supports:

- authentication and tenant authorization;
- input and output contract validation;
- auditability;
- database concurrency and transaction integrity;
- accessibility for user-facing flows;
- latency and API throughput budgets supplied by the requirement or Pack baseline;
- frontend bundle budget;
- health, structured logs, request correlation, and error visibility;
- timeout and resource-cleanup behavior;
- migration safety, local recovery, and compatibility;
- dependency and secret risk checks.

Privacy, disaster recovery, geographic residency, high availability, cloud cost, and production deployment remain owner- and environment-dependent. If material, they block completion until an appropriate target and evidence provider exist.

## Production quality matrix

Each gate has an ID, owner, applicability expression, trusted runner plan, evidence schema, freshness rule, timeout, artifact budget, and failure classification.

The first required matrix contains:

| Area | Required evidence |
| --- | --- |
| Reproducibility | package-manager identity, lockfile integrity, clean install, generated-artifact drift |
| Static quality | formatting check, lint, TypeScript check, architecture policy |
| Functional | unit, component, API integration, repository integration, contract, and browser end-to-end tests |
| Data | clean migration, previous-schema migration, constraint probes, concurrency probe, forward recovery |
| Security | secret scan, dependency advisory result, authorization negative probes, unsafe DTO and injection probes |
| UX | accessibility scan and primary keyboard/focus scenarios |
| Runtime | API and web readiness, health response, structured error/log correlation, graceful cleanup |
| Performance | requirement-bound API latency/throughput and frontend bundle budget |
| Traceability | every material acceptance scenario maps to code ownership and current evidence |
| Delivery | local start instructions, acceptance report, residual risks, rollback or forward-recovery instructions |

A gate may be `passed`, `failed`, `blocked`, `not-run`, `stale`, or `not-applicable-with-reason`. Only `passed` and justified `not-applicable-with-reason` can satisfy a required matrix entry. Unsupported tooling is blocked evidence, not a pass.

Managed browser, API, and database drivers own startup, readiness, isolated data, output capture, timeouts, and cleanup. They must not leave servers, browsers, containers, schemas, temporary credentials, or files running after success, failure, cancellation, or interruption.

## Failure, repair, and recovery

Each failure record identifies:

- the violated requirement, architecture, Pack, authority, or quality contract;
- the failing gate and evidence location;
- the owning module or scope;
- whether a bounded automatic repair is permitted;
- the evidence invalidated by the repair;
- retry, elapsed-time, Token, cost, file, and command budgets;
- the required owner question when repair would change business meaning or authority.

Repair is local to the smallest owned scope. Repeated regeneration of the entire project is not a repair strategy. A repair attempt checkpoints repository and session state, applies an approved bounded patch, reruns the invalidated minimum gate closure, and then reruns all transitively affected completion gates.

Interruption recovery reloads approved requirements, architecture, authority, repository checkpoint, Pack version, exact dependency matrix, completed gate evidence, and pending action. A resume with a different Pack release, unresolved repository drift, changed Agent capability, or stale approval stops for reconciliation.

## Evaluation and maturity

Evidence levels for this Pack are:

| Level | Meaning |
| --- | --- |
| `E0-generated` | Expected files were produced; no quality claim |
| `E1-deterministic` | Contract, analyzer, unit, and negative-probe fixtures pass |
| `E2-integrated` | Full application and real PostgreSQL quality matrix pass in a controlled environment |
| `E3-agent-executable` | A real supported Agent completes requirement, implementation, repair, interruption, resume, and local run through the Core runtime |
| `E4-golden-path-certified` | Held-out structurally distinct repositories, current claimed OS matrix, and a qualified user unfamiliar with the stack meet the published threshold |

Only E4 authorizes a `certified` claim and Phase B product-form conversion. E3 may be described as executable for the exact evaluated matrix. E0 through E2 remain implementation candidates.

The evaluator keeps held-out inputs outside implementation context. The repository retains case IDs, input and repository digests, environment facts, Agent and model facts where available, timestamps, budgets, results, artifacts, failure history, and evaluator identity class. Failed cases remain in regression history.

The required negative probes include:

- cross-layer import;
- cross-feature private import;
- contract drift;
- transport or actor fields accepted through an unsafe DTO;
- domain import of NestJS, Fastify, or Drizzle;
- hidden or leaking transaction boundary;
- unauthorized tenant path;
- lost update under concurrency;
- failed or incompatible migration;
- missing acceptance-bound test;
- stale evidence;
- omitted applicable quality gate;
- workspace mutation outside approved authority;
- interrupted execution and resume with repository drift.

Each claimed enforcement capability must have at least one current positive scenario and one negative probe that fails for the intended contract.

## Real Agent boundary

Codex is the first candidate real Agent adapter because it already has a built-in registry entry and a repository instruction surface. It remains `unverified` until an adapter demonstrates structured requirement or architecture output, bounded patch execution, cancellation, resume compatibility, and usage-evidence boundaries through the Delivery Core.

Agent availability, authentication, model selection, pricing, and provider limits are environment facts. AICG records them but does not conceal their absence or infer unsupported capabilities from an installed executable. If Codex cannot satisfy the contract, the Pack remains below E3 and another Agent is evaluated only through the same contract.

## Compatibility and migration

The new Pack schema and quality-matrix schema are versioned Core extension contracts. Readers reject unsupported future major versions and validate compatible minor additions according to explicit schema rules.

Migration from the current capability registry is additive:

1. existing pack entries retain detection and legacy evidence fields;
2. the golden path references a new contract and evaluation record;
3. public declarations derive maturity from current evaluation rather than the legacy `active` field;
4. later packs migrate independently without changing Delivery Core state semantics.

Schema fixtures cover current, prior compatible, malformed, unknown-major, and migration-required records. Completion evidence includes the schema and Pack release digests so an upgrade invalidates only affected evidence.

## Completion and rollout

Milestone 2 completes only when every roadmap Core completion condition and this design's E4 threshold pass with current evidence. Until then:

- roadmap status remains evidence-incomplete;
- capability declarations use the highest evidenced maturity without rounding up;
- product-form conversion work does not begin;
- unpublished or missing cross-OS, real-Agent, real-project, or qualified-human evidence remains an explicit gap.

The implementation rolls out behind internal Core contracts and CLI evaluation commands first. No existing user project receives a new executable Pack, changed completion rule, dependency upgrade, or generated application artifact implicitly. Activation requires an explicit plan and exact approval under the existing workspace authority model.

## Implementation planning sequence

The implementation plan should preserve the following dependency order:

1. Pack and quality-matrix schemas plus migration behavior;
2. exact compatibility resolver and capability declarations;
3. TypeScript architecture analyzer extensions and negative probes;
4. risk-activated requirement and completion mappings;
5. managed database, API, browser, security, observability, and performance verification drivers;
6. reference workload and full quality matrix;
7. real Codex adapter evaluation through the Delivery Core;
8. held-out repositories, failure injection, cross-OS, and qualified-user acceptance;
9. evidence-derived maturity publication and Core completion decision.

Later steps cannot replace missing evidence from an earlier step. In particular, a polished reference application, CLI demonstration, or Studio prototype cannot satisfy held-out or qualified-user acceptance.

# Product roadmap: governed requirements to production code

## Status and purpose

This roadmap records the product gaps and capability sequence required to evolve AICG from a governance generator into an AI software-delivery control plane. It is based on the `v0.6.1` product review completed on 2026-10-05 and the Milestone 1 implementation candidate produced on the same date.

AICG currently has a strong governance kernel: repository scanning, canonical rules, exact-plan approval, task routing, managed-file ownership, drift detection, evidence states, bounded work units, and transactional governance writes. It does not yet provide an end-to-end runtime that turns a natural-language requirement into implemented, verified, production-ready code.

This document is a prioritized capability roadmap, not a release-date commitment. A capability changes state only when its exit criteria have current evidence.

### Current execution status (2026-10-05)

Milestone 1 now has an implementation candidate, but the milestone remains **evidence-incomplete** and is not declared complete. The candidate adds versioned Requirement, Architecture, Evidence, Delivery Session, and Completion contracts; natural-language requirement compilation boundaries; persistent recoverable sessions; a model-independent Agent contract; bounded workspace authority; normalized cross-stack verification plans; traceability; production fail-closed completion; and the `aicg delivery session` CLI lifecycle.

Current evidence covers deterministic unit tests, temporary-repository integration tests, process-runner tests, interruption recovery, one repair loop, and equivalent outcomes from two compatible fake Agent adapters. This evidence is sufficient to continue Core implementation, but it does not prove real-client, real-project, cross-OS, qualified-human, or arbitrary production-stack capability.

The following work remains open before Milestone 1 can be closed:

- validate at least one real supported Agent adapter against the same runtime contract without relaxing authority or structured-output boundaries;
- run the candidate on held-out real repositories and retain failures, recovery evidence, elapsed time, Agent turns, Token use, and cost;
- verify the release candidate on current macOS, Windows, and Linux evidence where a platform claim is made;
- exercise requirement, permission, build, test, data, interruption, stale-evidence, and cancellation failures through the integrated CLI/runtime path;
- publish schema/API compatibility and migration tests for future Core versions.

Milestone 2 is therefore the next active capability phase. Product-form conversion remains gated behind Milestone 2 and the Core completion gate; Studio, Plugins, MCP mutation tools, and SDK distribution must not become parallel sources of truth in the meantime.

The Milestone 2 design was approved on 2026-10-05. Its canonical implementation boundary is [Golden-path Core completion design](../specs/2026-10-05-golden-path-core-completion-design.md). The selected first path is React with Vite, Mantine, NestJS with the Fastify adapter, Drizzle ORM, and PostgreSQL. Approval of the design does not change the milestone evidence state.

## Product outcome

A developer who does not know the target stack should be able to describe a business outcome, answer only material owner questions, and receive:

- an approved, machine-valid requirement contract;
- an explainable architecture and implementation plan;
- bounded code changes produced through a recoverable Agent runtime;
- stack-appropriate build, test, security, data, runtime, and release evidence;
- an acceptance report that distinguishes automated, simulated-human, qualified-human, and real-user evidence;
- a runnable result, remaining risks, and a rollback path.

AICG does not need to become a code-generation model. It must become the deterministic control plane that supplies contracts, boundaries, execution state, verification, and evidence around one or more coding Agents.

## Product form decision

AICG will use a hybrid product model. It will not remain a collection of Skills, and it will not become a replacement IDE. This is the target product form, not the first implementation phase: product-surface conversion begins only after the Core completion gate defined below has passed.

| Surface | Responsibility | Boundary |
| --- | --- | --- |
| AICG Core | Canonical schemas, scanner, governance compiler, task routing, policy evaluation, evidence binding, and deterministic state transitions | The source of truth; it must not depend on one Agent, IDE, model provider, or hosted service. |
| AICG Studio | Local-first, business-oriented project, requirement, delivery, review, and evidence experience | Initially a browser UI launched by the CLI; it must not require a new editor or expose governance internals in the default path. |
| AICG Runtime | Recoverable requirement-to-code orchestration, Agent adapters, command execution, checkpoints, repair loops, and completion decisions | Agents propose and execute bounded work; Runtime owns state, authority, budgets, and evidence. |
| AICG integration surfaces | CLI, Skills, Plugins, MCP, and SDK adapters for supported coding environments | These are projections and entrypoints, not independent sources of policy or project state. |
| AICG Packs | Versioned architecture, generation, verification, repair, and compatibility knowledge for a bounded stack combination | A Pack is not production-capable until its executable and certification evidence meets this roadmap. |

Skills remain a first-class portable distribution and context mechanism. They teach an Agent how to enter an AICG workflow and retrieve the smallest relevant context. They do not own long-running delivery state, execute arbitrary project commands, certify results, or replace Core and Runtime.

After Core completion, the initial Studio should extend the existing local-first CLI and loopback-browser model. A native desktop shell or hosted control plane may be added only when it solves an evidenced deployment, collaboration, background-execution, or operating-system integration need. Rebuilding editor, terminal, source-control, and Agent functionality already provided by supported environments is an explicit non-goal.

## Core product moats

The following capabilities are the primary product moat. Feature count, prompt volume, framework detection, and generated governance files are not substitutes for them.

### 1. Requirement-to-evidence semantic chain

AICG must preserve approved business meaning from natural-language intent through Requirement IR, Architecture IR, implementation scope, tests, runtime evidence, and acceptance. Every material requirement must be traceable to an owned implementation and verification result; every delivered change must trace back to approved scope.

Moat evidence:

- requirement mutation invalidates affected design, plan, test, and completion evidence;
- omissions, contradictions, untestable criteria, and unresolved owner decisions remain visible and block production completion when applicable;
- the same approved requirement can be executed by different supported Agents without changing its meaning or authority.

### 2. Deterministic, model-independent delivery runtime

Models and coding Agents are replaceable execution providers. AICG owns session state, authority, checkpoints, budgets, failure classification, retries, review boundaries, evidence, and recovery.

Moat evidence:

- an interrupted run resumes without duplicated effects or lost approvals;
- changing the Agent or model does not discard requirement, architecture, verification, or audit state;
- an Agent cannot expand its file, command, network, external-effect, or approval authority;
- repeated failure produces a classified stop or owner question rather than an unbounded loop.

### 3. Executable, version-aware stack intelligence

Stack knowledge must combine architecture boundaries, coding patterns, compatibility data, toolchain discovery, generation constraints, verification adapters, known failure modes, and repair strategies. Static prose and broad framework recognition are not a moat.

Moat evidence:

- a Pack declares exact supported version ranges and environment assumptions;
- positive scenarios and negative probes exercise architecture and quality claims;
- unsupported or unresolved versions downgrade capability honestly instead of receiving generic production claims;
- a golden path can be reproduced across structurally different repositories.

### 4. Production verification and honest certification

AICG must make production readiness measurable. It binds the requirement, repository state, commands, results, artifacts, reviewer independence, environment, and time into a current evidence graph.

Moat evidence:

- stale, missing, failed, blocked, or inapplicable-without-reason evidence cannot become production-complete;
- capability claims are generated from current held-out evaluations and version/platform matrices;
- injected functional, architecture, security, migration, compatibility, and recovery failures are detected by the owning gate;
- a regression lowers or suspends the affected capability claim.

### 5. Governed learning without silent policy drift

Verified delivery outcomes should improve candidate guidance, Pack coverage, failure classification, and evaluation cases while preserving human authority and repository isolation.

Moat evidence:

- project observations enter a candidate lifecycle with deduplication, offline evaluation, independent review, canary evidence, promotion, and rollback;
- private project facts never become public or global defaults implicitly;
- successful and failed outcomes remain available to regression evaluation;
- no Agent can promote the policy that governs its own work.

## Target experience and adoption sequence

The default product experience is outcome-first:

1. describe the desired business outcome;
2. answer only material owner questions;
3. review the proposed outcome, scope, risks, and authority;
4. observe delivery through business-readable states;
5. review the runnable result, changed behavior, verification, remaining risks, and rollback path;
6. explicitly authorize release or external effects when required.

The interface provides two coordinated views over the same state:

- **Guided view:** business goals, decisions, progress, risks, previews, and results;
- **Expert view:** IR documents, architecture decisions, files, commands, diffs, logs, evidence digests, and policy findings.

Autonomy is risk-adaptive rather than a global promise. A user may choose advisory, collaborative, or bounded autonomous operation, but higher-risk actions still require the authority and evidence defined by policy.

Adoption proceeds in evidence order:

1. developers delivering outside their primary stack;
2. technical leads and teams standardizing AI-assisted delivery;
3. technical founders and product owners using certified golden paths;
4. non-technical users only after the selected path can reliably explain, execute, verify, recover, and escalate without expert intervention.

The product must not claim that a non-technical user can deliver arbitrary production software merely because a guided interface exists.

## Roadmap phase gates

The roadmap follows a strict core-first sequence. Later product surfaces may influence Core contracts, but they must not become parallel implementations or substitute UI progress for delivery evidence.

### Phase A: complete the delivery Core

Build and verify the capabilities that remain valuable without Studio or any specific Agent client:

- Requirement IR, Architecture IR, Evidence IR, and Completion Contract;
- canonical project and delivery-session state plus a versioned Core API;
- recoverable, model-independent Agent runtime with bounded authority and budgets;
- normalized shell-free verification runner contracts;
- production fail-closed completion;
- executable stack-pack contract and one fully verified golden path;
- requirement-to-file-to-test-to-evidence traceability;
- current held-out regression evaluation for the golden path.

During this phase, CLI and narrow test harnesses are sufficient product surfaces. A prototype may validate an interface risk, but Studio, Plugin, MCP mutation tools, SDK distribution, native shells, hosted collaboration, and broad client support are not Phase A deliverables.

### Core completion gate

Product-form conversion starts only when all of the following are demonstrated with current evidence:

- `AICG-P0-001` through `AICG-P0-004` are resolved for the first golden path;
- one user unfamiliar with the selected stack can complete requirement clarification, governed implementation, verification, recovery, and local run through the Core workflow;
- injected requirement, architecture, permission, build, test, data, interruption, and stale-evidence failures are blocked and classified;
- a run can resume from a checkpoint without lost approval, duplicated external effect, or divergent evidence;
- the Core API and IR schemas are versioned, migration-tested, and independent of one UI, Agent, IDE, or model;
- the golden-path capability claim is produced from current evaluation evidence rather than documentation or generated files.

Failure of any gate item keeps work in Phase A. It may create a product-surface design input, but it does not authorize moving unresolved Core behavior into Studio.

### Phase B: convert the verified Core into the target product form

Once the Core completion gate passes, make the proven workflow accessible without duplicating it:

- deliver local-first AICG Studio with guided and expert views;
- project business-readable progress, decisions, risk, recovery, and results from canonical Core state;
- expose read-only MCP discovery before bounded mutation tools;
- package supported Skills and Plugins as workflow entrypoints;
- publish SDK contracts only after Core API compatibility tests exist;
- verify cross-client continuity so a delivery can move between Studio, CLI, and a supported Agent without semantic or authority drift.

Phase B completes only when the novice-facing flow reaches the same Core result and evidence as the expert CLI flow. UI-only success is not a product completion signal.

### Phase C: expand and certify

After the product form is stable over the first golden path, add more stack combinations, independent Agent review, collaboration and background-execution capabilities when evidenced, current platform matrices, and governed learning. Expansion must reuse the same IR, Core API, Runtime, Completion Contract, and evidence model.

## Current maturity baseline

| Area | Current state | Target state |
| --- | --- | --- |
| Governance integrity | Exact plans, ownership hashes, drift checks, transactional writes | Preserve while delivery execution is added |
| Requirement handling | Requirement IR v2 and compiler boundaries implemented; real-Agent and real-project evidence remains open | Natural-language requirement compiler with typed Requirement IR |
| Code generation | Recoverable runtime contract and bounded workspace adapter implemented; executable real-Agent adapters remain unverified | Recoverable Agent runtime with bounded patches, retries, and review |
| Architecture | Architecture IR implemented; language analyzers remain limited to existing JS/TS checks | Language-independent Architecture IR with stack analyzers |
| Stack support | Broad detection; narrow or unverified standard coverage | Versioned executable and certified stack packs |
| Verification | Normalized cross-stack runner plans implemented; the golden-path production quality matrix remains open | Cross-stack runner adapters and a production quality matrix |
| Testing | Case and result ledgers; external execution remains common | Managed browser, API, device, database, and fault-test drivers |
| Novice experience | Governance setup wizard followed by Agent handoff | Business-first delivery wizard with technical decisions derived from evidence |
| Evaluation | Synthetic fixtures and repository-created scenarios | Held-out real-project, cross-version, cross-Agent benchmarks |

## Capability maturity model

Every technology or platform capability uses these states. Detection alone must never be marketed as production support.

| State | Required meaning |
| --- | --- |
| `detected` | AICG can identify bounded repository evidence for the stack. |
| `guided` | Version-scoped rules, architecture guidance, examples, and known gaps are available. |
| `executable` | AICG can generate or modify code, build it, run the required quality matrix, classify failures, and drive repair. |
| `certified` | Current real-project, version-matrix, Agent, and claimed-platform evidence meets the published acceptance threshold. |

Existing registry values remain compatible until the registry schema adopts this model. During migration, `active` describes product availability and `evidence` describes proof; neither alone means `executable` or `certified`.

## Priority defect register

### P0 — blocks the stated product outcome

#### AICG-P0-001: end-to-end delivery runtime lacks real-client production evidence

Current delivery commands route, preview, validate, and record evidence, but they do not own the complete observe-plan-edit-verify-repair-review loop.

Implementation status: the Core state machine, persistent checkpoints, bounded authority, failure classification, budgets, repair loop, and session CLI exist in the Milestone 1 candidate. Real supported Agent execution, held-out repositories, and current platform evidence remain open, so this defect is not resolved.

Required remediation:

- add a persistent delivery session and state machine;
- define a common Agent Adapter contract for supported coding Agents;
- permit only scoped, reviewable patches within the approved work unit;
- checkpoint repository state before mutations and support safe recovery;
- classify build, test, policy, infrastructure, and business-decision failures;
- apply bounded retry, elapsed-time, Token, cost, file, and command budgets;
- escalate unresolved business decisions without exposing ordinary technical repair work to a novice user;
- produce a final runnable result, evidence report, residual-risk list, and rollback instructions.

#### AICG-P0-002: requirement compiler lacks real-Agent semantic evaluation

The current work-unit contract provides a useful delivery boundary, but `requirements.summary`, acceptance criteria, free-text design, and free-text plan are insufficient to prevent semantic omissions.

Implementation status: Requirement IR v2, deterministic compilation input, structured-output validation, material-question blocking, contradiction checks, and semantic digests exist. Accuracy, omission, and cross-Agent consistency on held-out requirements remain open.

Required remediation:

- introduce Requirement IR v2;
- compile natural-language input into typed actors, goals, scope, non-goals, rules, state transitions, data, contracts, failures, permissions, non-functional requirements, rollout, rollback, and acceptance scenarios;
- ask only material owner questions and keep unresolved assumptions explicit;
- detect contradictory, untestable, or incomplete requirements;
- bind approved requirement semantics to design, code scope, tests, and completion evidence.

#### AICG-P0-003: cross-stack verification lacks golden-path completion evidence

Repository scanning discovers npm, Maven, Gradle, Go, and Python verification commands, but the completion runner accepts only safely discovered npm scripts.

Implementation status: normalized shell-free plans, trust checks, bounded process execution, result parsing, and evidence records now cover the planned runner families. A production quality matrix and current real-project evidence remain open.

Required remediation:

- make the normalized shell-free verification command the completion contract;
- implement trusted runner adapters for npm-family tools, Maven, Gradle, pytest/tox/nox, Go, .NET, Cargo, Composer/PHPUnit, Android, and Apple project tasks as each stack becomes executable;
- enforce per-runner side-effect analysis, timeouts, output bounds, environment isolation, result parsing, and evidence binding;
- reject unsupported or ambiguous command execution instead of silently reducing verification.

#### AICG-P0-004: production fail-closed contract lacks golden-path acceptance evidence

Report-only checks are appropriate for adoption, but a novice-facing production-delivery mode cannot treat failed findings as a successful process exit.

Implementation status: advisory and production profiles are separated, and the production Completion Contract rejects missing, stale, failed, unsupported, or unrun required evidence. Integrated qualified-human acceptance, deployability, and golden-path release evidence remain open.

Required remediation:

- retain advisory mode for exploration and incremental onboarding;
- introduce a `production` delivery profile in which completion, hooks, and CI fail closed;
- prevent missing, stale, blocked, failed, or unrun required evidence from becoming complete;
- display governance generation, implementation, automated verification, human acceptance, deployability, and deployment as separate states.

#### AICG-P0-005: no unified novice-facing delivery control plane

The current product exposes setup, governance artifacts, work-unit commands, evidence recording, and external Agent execution as separate operator concepts. This cannot deliver the stated experience for a user who does not know the target stack.

Required remediation:

- add a persistent project and delivery-session model shared by CLI, Studio, Skills, Plugins, MCP, and SDK entrypoints;
- implement an initial local-first Studio through the existing loopback-browser architecture;
- present business-readable requirements, decisions, progress, risks, results, and recovery actions by default;
- provide an expert view over the same canonical state rather than maintaining a second workflow;
- derive technical workflow choices from repository evidence and policy while keeping material owner decisions explicit;
- prevent an integration adapter from becoming a divergent source of requirements, policy, approval, or evidence.

### P1 — required for dependable production quality

#### AICG-P1-001: stack detection is broader than stack delivery support

Active packs remain unverified; React and Node coverage is partial and synthetic-only; several web stacks lack scenario evidence; Python, Go, and PHP are planned; native, desktop, .NET, and systems families remain roadmap capabilities.

Required remediation:

- stop equating manifest recognition with stack support;
- concentrate on a small set of golden paths;
- require every executable pack to carry architecture, generation, verification, repair, and known-limit contracts;
- derive public capability claims from registry and evaluation evidence rather than documentation prose.

Initial recommended golden paths:

1. React or Next.js + NestJS or Fastify + PostgreSQL;
2. Vue + Spring Boot + MyBatis or JPA + PostgreSQL;
3. FastAPI + PostgreSQL after the first two paths are stable.

#### AICG-P1-002: architecture guidance is not equally machine-enforced across languages

The current dependency graph checks statically analyzable relative JS/TS imports and exports. Dynamic resolution, aliases, semantic cohesion, single responsibility, and non-JS languages remain unverified.

Required remediation:

- introduce a language-independent Architecture IR;
- provide evidence adapters using appropriate parsers for TypeScript, Java, Python, Go, Roslyn-based .NET, and later supported languages;
- check cycles, cross-module private imports, public entrypoints, layer direction, framework-to-domain reverse dependencies, and composition roots;
- keep semantic cohesion and responsibility metrics as review signals unless stronger evidence exists.

#### AICG-P1-003: technical standards are selected without version constraints

Dependency facts retain declared and resolved versions, but standard selection currently matches package or dependency names.

Required remediation:

- add supported framework, language, runtime, build-tool, and database version ranges;
- add compatibility, conflict, deprecation, and migration metadata;
- prevent version-sensitive code generation when exact versions are unresolved;
- refresh primary-source snapshots through a reviewable update process.

#### AICG-P1-004: Requirement IR lacks production non-functional requirements

Required remediation:

- add risk-activated profiles for latency, capacity, availability, accessibility, security, privacy, audit, observability, data migration, disaster recovery, compatibility, rollout, rollback, and cost;
- map each applicable requirement to a design decision, verification method, evidence location, and owner;
- require an explicit reason for `not-applicable` rather than treating absent checks as passing.

#### AICG-P1-005: no unified production quality matrix

Each executable stack pack must publish a machine-readable gate matrix covering applicable items from:

- reproducible build and lockfile integrity;
- formatter check, lint, type checking, and architecture boundaries;
- unit, integration, contract, and end-to-end tests;
- secret detection, SAST, dependency and license analysis, container and IaC checks;
- migration compatibility and forward-recovery rehearsal;
- health, logs, metrics, traces, timeouts, retries, and resource cleanup;
- requirement-bound performance, memory, bundle-size, or throughput budgets;
- artifact provenance, environment differences, and rollback evidence.

#### AICG-P1-006: multi-role review is declared rather than independently executed

Required remediation:

- execute implementer, reviewer, and referee in distinct sessions where risk requires independence;
- isolate review context from implementation reasoning;
- require structured findings with evidence, severity, proposed resolution, and disposition;
- prevent one execution identity from satisfying both implementation and sole approval roles;
- preserve the boundary that machine identities do not prove qualified-human identity.

#### AICG-P1-007: test evidence management is not a complete test runtime

Required remediation:

- add bounded browser, HTTP, device, database, queue, and external-provider driver adapters;
- manage service startup, readiness, isolated test data, artifacts, logs, traces, and cleanup;
- bind evidence automatically rather than relying only on operator-emitted result markers;
- preserve automated, AI-simulated-human, qualified-human, and real-user evidence as distinct sources.

#### AICG-P1-008: no held-out real-project generation benchmark

Required remediation:

- maintain an evaluation set that is isolated from feature implementation and prompt tuning;
- cover greenfield, brownfield, monorepo, legacy debt, multiple languages, public contracts, data migration, authorization, concurrency, and external effects;
- evaluate each supported model, Agent, OS, and stack-version combination;
- retain failed cases and regression history instead of publishing only successful demonstrations.

#### AICG-P1-009: portable entrypoints are not yet backed by one runtime contract

Skills and generated Agent files are useful context surfaces, but they do not provide durable cross-client state or a common action contract.

Required remediation:

- stabilize and expose the versioned Core API created in Phase A for project state, requirement sessions, plans, runs, reviews, evidence, and completion;
- expose read-only discovery and inspection through MCP before adding bounded mutation tools;
- make CLI, Studio, Plugin, Skill-assisted, MCP, and SDK flows call the same Core contracts;
- add capability negotiation so each client exposes only supported actions and evidence;
- test that switching clients or Agents preserves approved meaning, authority, state, and audit continuity.

### P2 — product consistency and maintainability

#### AICG-P2-001: capability-pack status can drift from technical-standard coverage

Generate or validate coverage summaries from the technical-standard registry and evaluation records. Do not maintain contradictory hand-written coverage claims in multiple files.

#### AICG-P2-002: current cross-platform evidence is stale and Windows is informational

Run layered CI on pull requests, main pushes, and release tags. Publish platform state from current run evidence. Keep unsupported platforms explicitly preview-only until they pass the same required suite.

#### AICG-P2-003: telemetry and capability learning do not form a governed loop

Add a candidate-rule lifecycle: observe, deduplicate, offline-evaluate, independently review, approve, canary, monitor, promote, and roll back. A single project must never silently change global governance.

#### AICG-P2-004: novice delivery exposes too many engineering concepts

The default delivery experience should ask about business intent, required outcomes, material risk, and permitted authority. Lifecycle, stack, depth, task level, work unit, plan hash, review mode, and command selection remain visible in expert mode and audit output but should normally be derived from evidence.

## Milestone plan

Milestones are evidence gates, not calendar promises. A later milestone must not bypass unfinished exit criteria from an earlier one.

### Milestone 1: core semantic and runtime foundation

Status: **implementation candidate; evidence-incomplete; not complete**.

Delivered in the current candidate:

- five closed JSON contracts with strict validators and canonical semantic digests;
- Requirement IR compilation and material-decision boundaries;
- durable session storage, compare-and-swap checkpoints, recovery, resume, cancellation, failure classification, and bounded retries;
- Agent capability negotiation plus structured-output and runtime adapter contracts;
- bounded file authority, transaction rollback, and shell-free verification runner plans;
- traceability and advisory/production completion evaluation;
- `aicg delivery session <start|status|step|resume|cancel>` with safe repository-relative inputs;
- a temporary-repository scenario showing one repair cycle, checkpoint recovery, and semantically equivalent results from two fake compatible Agents.

Evidence still required for exit: real supported Agent adapters, held-out real repositories, current cross-platform evidence, integrated injected data and cancellation failures, and Core schema/API migration tests.

Scope:

- Requirement IR v2 and natural-language compilation;
- Architecture IR, Evidence IR, and Completion Contract foundations;
- canonical project and delivery-session state;
- versioned internal Core API independent of UI and Agent clients;
- persistent Agent delivery runtime;
- normalized cross-stack verification runner contract;
- production fail-closed profile;
- requirement-to-file-to-test traceability.

Exit criteria:

- approved requirement semantics remain bound through architecture, plan, patch scope, tests, and evidence;
- injected build, test, requirement, permission, and data failures block completion and produce actionable repair classifications;
- interrupted delivery resumes from a valid checkpoint without silently discarding or duplicating work;
- changing the configured supported Agent does not change approved meaning, authority, or canonical state;
- time, Agent turns, Token use, execution cost, changed files, tests, and residual gaps are reported through Core contracts.

### Milestone 2: core completion on one production-capable golden path

Design status: approved for implementation planning on 2026-10-05. Implementation and certification remain evidence-incomplete.

Scope:

- first language analyzers and architecture enforcement;
- version-aware stack-pack schema;
- risk-activated non-functional requirements;
- production quality matrix;
- managed browser, API, database, migration, security, observability, and performance verification where applicable;
- one full-stack golden path from requirement through local runnable result;
- held-out golden-path regression evaluation.

Exit criteria:

- every item in the Core completion gate passes with current evidence;
- a user unfamiliar with the chosen stack can provide a requirement and only material business confirmations through the Core workflow;
- AICG produces an approved requirement, bounded plan, code patch, passing required quality matrix, acceptance report, runnable entrypoint, and rollback instructions;
- deliberately introduced cross-layer imports, private-module access, contract drift, unsafe DTOs, transaction leakage, unauthorized paths, failed migration, missing tests, and applicable quality-gate omissions are rejected;
- every failure identifies the violated contract, evidence, owning scope, and permitted repair action;
- a generated rule is not reported as enforced without a current negative probe;
- completion of this milestone authorizes Phase B product-form conversion.

### Milestone 3: product-form conversion

Scope:

- local-first AICG Studio with guided and expert views;
- business-readable delivery timeline, decisions, risk, recovery, results, and rollback presentation;
- Agent capability negotiation, availability checks, and bounded fallback;
- read-only MCP discovery followed by bounded, policy-controlled mutation tools;
- supported Skill, Plugin, MCP, and SDK projections over the Core API;
- cross-client state, semantic, authority, and evidence continuity.

Exit criteria:

- Studio and CLI complete the same golden-path scenarios with equivalent Core state and evidence;
- the same delivery can start in Studio, continue through a supported Agent integration, and be inspected from CLI without divergent state or authority;
- guided view hides unnecessary engineering concepts without hiding decisions, risk, incomplete evidence, or recovery actions;
- expert view exposes the exact IR, decisions, files, commands, diffs, logs, and evidence behind the guided result;
- no integration surface owns a conflicting requirement, policy, approval, run, or evidence record.

### Milestone 4: multi-stack expansion and certification

Scope:

- second and third executable stack combinations;
- independent reviewer and referee sessions;
- dependency-aware parallel delivery for monorepos and cross-service contracts;
- expanded held-out real-project evaluation set;
- model, Agent, OS, and stack-version matrices;
- release scorecards and capability certification;
- governed candidate-rule learning and rollback.

Exit criteria:

- every stack and product surface uses the same Requirement IR, Evidence IR, Core API, and Completion Contract;
- stack-specific implementation remains isolated behind versioned adapters;
- cross-service contract changes verify producers and consumers against one owned schema;
- reviewer independence and unresolved disagreement are visible and cannot be replaced by role labels;
- published support claims are generated from current evaluation evidence;
- certification thresholds cover requirement accuracy, first-pass build and test rate, autonomous repair rate, human-edit ratio, escaped defects, architecture violations, security findings, elapsed time, Agent turns, Token use, and cost;
- a regression automatically lowers or suspends the affected capability claim;
- certified packs include current platform evidence and independent evaluation ownership.

## Product success metrics

Every release that changes delivery behavior should report these metrics for the affected capability:

- requirement coverage and unresolved-question rate;
- first-pass build rate and first-pass required-test rate;
- completion rate without expert code changes;
- automatic repair success and median repair turns;
- human-edited lines or files after Agent output;
- escaped functional, architecture, security, migration, and compatibility defects;
- median and p95 elapsed time, Agent turns, Token use, and monetary cost;
- verification flake rate and non-deterministic outcome rate;
- rollback success and recovery time;
- requirement-to-evidence traceability completeness;
- interrupted-session recovery success and duplicate-effect rate;
- cross-Agent semantic consistency and cross-client state continuity;
- guided-flow completion rate and material owner-question count;
- results by model, Agent, OS, stack, and version.

Metrics must retain failed and blocked samples. Aggregate success rates without denominator, scenario class, and evidence date are not admissible product claims.

## Sequencing rules

- Fix all P0 gaps for the first golden path before adding another roadmap-only stack.
- Prefer depth on a certified path over breadth in detected frameworks.
- Preserve the existing canonical governance, approval, safety, and evidence boundaries while adding execution.
- Finish and pass the Core completion gate before implementing the target product-surface conversion.
- Keep Core as the canonical source of truth; generate or project Skills, Plugins, MCP resources, SDK objects, and UI views from its versioned contracts.
- Build Runtime, semantic traceability, the first executable Pack, and production verification before product-surface conversion; expand stack and client breadth only after that conversion is stable.
- Treat generated code, tests, review, and reports as separate evidence planes.
- Keep business decisions human-owned; automate technical repair only inside approved authority.
- No milestone is complete from documentation or synthetic fixtures alone.

## Explicit non-goals

- Claiming that governance text proves low coupling, high cohesion, security, correctness, or production readiness.
- Supporting every framework before one stack is executable end to end.
- Letting a coding Agent expand its own authority, approve its own high-risk work, or convert missing evidence into success.
- Replacing qualified professional or real-user acceptance with an AI role label.
- Automatically promoting a project-specific observation into global governance.
- Hiding technical evidence from experts; novice mode simplifies decisions, not auditability.
- Treating Skills, Plugins, an IDE extension, or a hosted UI as an independent source of project truth.
- Rebuilding a general-purpose IDE, terminal, source-control client, or foundation model.
- Pricing, packaging tiers, billing, marketplace fees, or monetization strategy in this capability roadmap.

## Roadmap maintenance

- Update the defect register when a gap is reproduced, split, resolved, or superseded.
- A resolved item records the implementation revision, affected contracts, compatibility decision, verification commands, evaluation evidence, and remaining limitations.
- Capability-pack state changes start in the machine registry and synchronize human documentation.
- Completed milestones require current release evidence; plans, generated files, and passing synthetic fixtures alone do not close them.
- Keep exact dates in release and evaluation evidence. This roadmap retains priority and dependency order unless a dated release commitment is separately approved.

## Current execution status (evaluator-derived)

This section is updated only from certification-evaluator output; editorial rounding is not permitted.

- **Milestone 1 (Core semantic and runtime foundation): implementation complete; milestone evidence-incomplete** — the exit evidence listed earlier in this document (real supported Agent execution, held-out repositories, current cross-platform evidence, injected data and cancellation failures, and Core migration tests) is still open, so the milestone is not declared complete. Implemented: delivery-core contracts, requirement compilation, session state and durable store, Agent runtime contract, bounded workspace transactions, recoverable runtime, cross-stack verification runner, traceability and production completion, and the Core CLI surface, each with a red/green gate and a requirement-to-code cross-verification record.
- **Milestone 2 (one production-capable golden path): evidence-incomplete.** The Pack foundation, alias-aware architecture policy, risk-profile activation, managed verification, the reference workload, negative probes, the bounded Codex adapter, the opt-in evaluation command, and the certification machinery (evidence evaluator, held-out boundary, cross-OS workflow, qualified-user acceptance, publication decision, maturity gate) are implemented and verified. Milestone 2 is **not** closed because the external evidence it requires does not exist yet.
- Exact gaps: `missing-e3`, `missing-held-out-case`, `missing-qualified-human`, `insufficient-held-out-cases`, `missing-negative-probes`, and `platform-missing:linux|darwin|win32`.
- **Milestone 3 (product-form conversion) is not authorized.** An E4 verdict would authorize it without performing it; nothing in this repository performs Phase B work.
- Machine gates: `evaluateGoldenPathCertification()` refuses E4 on any gap, `publicationDecision()` keeps Milestone 2 evidence-incomplete and Milestone 3 blocked below E4, `derivePackMaturity()` withholds the certified claim unless a certified certification result is supplied, and `applyQualifiedUserEvidence()` lets a rejected human acceptance only add gaps.

### Priority defect register closure

- **P2-001 (capability-pack status drift): closed at the module level.** `modules/capabilities/coverage.mjs` derives the coverage summary and rejects evidence/coverage drift, detection drift, undeclared gaps, and unsupported vocabulary. Residual: prose documents are not yet generated from the derived summary.
- **P2-002 (stale cross-platform evidence, Windows informational): closed as a mechanism.** `.github/workflows/ci.yml` now runs the fast layer on pull requests, the full platform matrix on main pushes and release tags, and publishes platform state from the current run evidence with Windows marked preview-only. Residual: verified platform state still requires actual CI run evidence, which is external.
- **P2-003 (no governed candidate-rule lifecycle): closed.** The governed loop is implemented across `modules/capabilities/candidate-rules.mjs`, `candidate-evaluation.mjs`, `candidate-canary.mjs`, `candidate-store.mjs`, and `candidate-review.mjs`, with the read-only `aicg candidate review` command. No project can review, approve, or promote its own rule; receipts are digest-bound and a failed offline evaluation or canary cannot be retried into success. Residual: the CLI telemetry call site and the Chinese help line.
- **P2-004 (novice delivery exposes too many engineering concepts): not started — Phase B.** It is gated by the E4 verdict and must not be implemented before that gate passes.

### Live evaluation progress (single host)

A validated matrix receipt now exists for one macOS host: 14 of 14 required gates passed with real drivers (build, format, lint, typecheck, architecture, unit, contract over HTTP, security, observability, performance, integration over HTTP, migration against PostgreSQL 18.6, browser through Playwright, and requirement traceability), and it is committed at `test-support/evaluations/golden-path/receipts/macos-live-matrix.json`. The receipt states its own boundary: one host, and not cross-platform, held-out, real-Agent, or qualified-human evidence.

Feeding that receipt into the certification evaluator still returns `incomplete` with `missing-e3`, `missing-held-out-case`, `insufficient-held-out-cases`, `missing-qualified-human`, `missing-negative-probes`, and `platform-missing:linux`, `platform-missing:darwin`, `platform-missing:win32`, because a matrix run is not an evaluation receipt: E4 needs per-platform evaluation receipts, held-out provider execution, and a real qualified participant. A test guards that a single-host receipt can never produce a certification verdict.

### Negative probe coverage (executed, incomplete)

The Pack declares fourteen injected-defect probes with the gates that must catch each one. Running them against the real gates (mutation applied to a throwaway copy, the untouched copy as control, a probe counted only when the control passes and the mutated tree fails) detects **thirteen**: `cross-layer-import` and `private-feature-import` (architecture boundaries), `domain-framework-import` (architecture boundaries, static types), `transaction-leak` (architecture boundaries), `lost-update` and `failed-migration` (migration safety), `cross-tenant-access` and `unsafe-dto-actor` (security probes, the latter through the transport input rule), `stale-evidence` and `interrupted-resume-drift` (requirement traceability), `omitted-gate` (security probes, because the declared script is gone), `contract-drift` (contract tests, through the approved contract surface), and `missing-acceptance-test` (unit tests). The receipt is `test-support/evaluations/golden-path/receipts/macos-probe-detection.json`.

Only **one is not caught**: `unauthorized-path` writes outside the project tree, so a repository-scanning gate cannot see it by construction. Its detector must be a workspace-authority check that compares changed paths against the approved scope, which the reference workload does not have yet - a declared-coverage defect rather than a gate that ran and missed.

This is an open quality gap: declared negative-probe coverage is materially weaker than the Pack advertises. Closing it means extending the security probes, migration checks, and traceability checks to the patterns those probes inject, and serving the mutated tree so the HTTP gates can participate.

Six detection gaps were closed while investigating. The transport now carries a rule against reading unvalidated request fields directly, and the contract package carries an approved export surface compared on every run, which is why `unsafe-dto-actor` and `contract-drift` are detected. The probe runner now executes the declared npm scripts instead of the underlying tools, so `omitted-gate` is detected: a workload that deletes a gate script fails its gate instead of being silently exercised anyway. The traceability gate now validates the requirement and architecture contracts against their own schemas, binds the architecture to the requirement digest, and rejects a delivery session left mid-flight without a resumable checkpoint, which is why `stale-evidence` and `interrupted-resume-drift` are now detected. The migration gate applied the migration in a scratch schema with real transaction semantics instead of scanning the SQL text, which is why `failed-migration` and `lost-update` moved from undetected to detected. The workload's own architecture gate was a hand-written token list that only forbade external packages, so it reported "architecture ok" on a mutated tree that the governance policy itself flags. It now loads and runs the policy from the governance checkout named by `AICG_ROOT` and fails closed when that checkout is absent, which is why two probes moved from undetected to detected. The matrix receipt was regenerated afterwards, so the committed `macos-live-matrix.json` reflects the strengthened gate: 14 of 14 gates passed.

### Priority defect register closure (P1)

- **P1-002, P1-003, P1-004, P1-005, P1-007, P1-008: delivered as mechanisms.** Architecture policy and alias-aware TypeScript analysis, version-aware compatibility, risk-activated requirements, the production quality matrix with managed drivers, bounded verification drivers, and the held-out evaluation boundary all exist with tests.
- **P1-006 (multi-role review was declared, not executed): closed.** `modules/release/review-separation.mjs`, `review-findings.mjs`, and `review-evidence.mjs` execute implementer/reviewer/referee separation per risk, require structured findings with disposition, refuse machine approvers, and the production completion gate consumes the validated runtime bundle. The operator entry is `aicg review evidence`.
- **P1-001 (stack detection is broader than delivery support): deferred by the roadmap rule.** Depth on the first golden path precedes breadth; no additional stack may be pursued before the Core completion gate passes.
- **P1-009 (portable entrypoints are not backed by one runtime contract): Phase B.** Read-only MCP discovery and the shared Core API surface belong to the product-form conversion that E4 authorizes.

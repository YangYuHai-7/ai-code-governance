# Architecture and business-flow documentation

Architecture documentation shares the development-guidance entrypoint and source analysis.
It describes the current system or a proposed system; it does not automatically adopt
observed patterns as development policy.

## Two lifecycle paths

| Project | Basis | Review package |
| --- | --- | --- |
| Existing | Current source, tests, contracts, configuration and authoritative documents | System overview, module responsibilities, core business flow, evidence links and separate improvement proposals |
| New | User requirements, constraints, decisions and explicit assumptions | Proposed system/module/flow views, development conventions, technology tradeoffs, acceptance scenarios and implementation plan |

New L2/L3 tasks always select the architecture review package. Before customer confirmation,
the Agent may analyze requirements and prepare documents, but must not create application
scaffolds, install dependencies, change product/build/deployment configuration or write
implementation code. A requirements/design change returns the affected scope for review;
routine implementation choices within the confirmed scope do not need repeated approval.

Governance-bootstrap approval, document readiness, customer design confirmation, product
verification, and deployment authorization are distinct decisions. The CLI's read-only
handoff guides the calling Agent; it is not an operating-system sandbox for other tools.

## Selecting existing-project documentation

Set `features.architectureDocumentation: true` in the existing configuration, or select
the architecture/business-flow capability in the local configuration page. Preview and apply
the ordinary exact governance plan. The default is false for compatibility; Minimal does not
generate the optional baseline. This choice is independent of `knowledge`, business Memory
enrichment, and any previous decision declining that enrichment.

complete baseline generate a seed at `docs/development/architecture.md`, linked from the
canonical README and a conditional context route. If an authored `docs/architecture.md` or
`docs/architecture/README.md` exists, the seed references it instead of creating another
authoritative design. Existing seeds and manual changes are preserved during sync.
Documentation-only parent repositories do not receive invented application modules.

The deterministic baseline includes inventory-backed module containment and three Mermaid
view skeletons. The calling Agent must complete actors, real collaboration, business
decisions, negative branches and explanations from evidence. A skeleton or directory map
alone is insufficient. `aicg check --json` reports selected documentation gaps under
`architectureDocumentation` as advisories, independently of `brownfield.gaps`.

## Preparing a task

```bash
aicg handoff . --text "Implement member registration" --scope MEMBERS --json
aicg delivery prepare . --text "Implement member registration" --scope MEMBERS --yes
aicg delivery assess . --text "Implement member registration" --scope MEMBERS --enforce
```

Preparation creates missing documents only; `--yes` is not customer design confirmation.
New tasks include `docs/changes/MEMBERS/architecture.md` with system overview, module
architecture and core business flow sections. Each view needs a distinct Mermaid diagram,
plain-language explanation and material relationship references. The flow includes a failure
or permission branch. Development conventions and unresolved review decisions accompany the
views. Additional sequence, logical data or deployment views are conditional on project need.

Existing L2 tasks reuse a known authoritative architecture document. L3 changes prepare the
changed design separately. With OpenSpec ownership, both architecture and technical design
reference the selected change's `design.md`; they do not create competing authorities.

## Customer confirmation and continuation

After completing the concrete package, show the customer its scope, revision, important
decisions, risks and acceptance expectations. Do not ask them to approve an empty template.
Silence, a timeout, an AI role label and structural success do not establish confirmation.

The implementation uses the existing task-approval format, not a new confirmation boolean:

- Preserve the customer's actual approval statement in a repository-relative record.
- Reference it with SHA256 in the existing `approval-evidence` JSON, using the
  `requirements`, `design` and `plan` approval IDs and `source: "operator-declared"`.
- Bind its `planHash` to the current `approval.plan.planHash` returned by assessment/handoff
  with that evidence file. The plan covers task text, scope, lifecycle and selected document
  contents, including any native authoritative design.
- Continue with the same evidence and explicit approval digest. The calling Agent handles
  these mechanics; customers should review the concrete design in ordinary language.

```bash
aicg delivery assess . --text "Implement member registration" --scope MEMBERS \
  --approval-evidence approvals/members.json --approve <current-planHash> --enforce
aicg handoff . --text "Implement member registration" --scope MEMBERS \
  --approval-evidence approvals/members.json --approve <current-planHash> --json
```

The evidence format and validation are the existing `task-approval.mjs` contract. A preview
can use the evidence file's placeholder digest to obtain the current plan; that preview is
not approval and must not invent a customer statement. After genuine customer confirmation,
record and bind it before continuing.

Structurally complete documents without current confirmation produce
`awaiting-customer-confirmation`. `delivery assess --enforce` fails in that state. A current
binding permits `prepared-for-agent` / `approved-scope-operator-declared`. Repeating the same
scope and content reuses the receipt; changed content or task intent makes it stale. These
are operator-declared records with `identityVerified: false`, not authenticated human sign-off.
The commands still execute no implementation or tests.

## Validation limits and maintenance

Assessment checks view presence, distinct diagram bodies, relationship signals, a negative
flow label, placeholders and resolvable local evidence links. It does not parse all Mermaid
syntax, prove reference authenticity or business correctness, or execute diagrams and tests.
`diagramRendering: "unverified"` stays explicit until a supported renderer is actually used.
Perform visual and business review separately; a green structural result is not acceptance.

Keep one editable source per diagram and preserve manual edits. Optional draw.io authoring
requires separately configured tools; the standard path works without that server. Review
documents when referenced behavior changes, then reconcile actual implementation with the
approved design. Heavy diagrams stay in conditional context rather than ordinary startup.

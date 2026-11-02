# Proportionate clarification and decision reuse

Use this reference when material project decisions are still missing. For initialization input and exact CLI contracts, [initializer.md](initializer.md) is authoritative. For an authorized refresh, follow [governance-refresh.md](governance-refresh.md) and reuse existing choices.

## Establish facts before questions

Inspect the repository, saved configuration and current conversation first. Identify lifecycle, manifests, detected stacks, existing clients, scripts, design authority and terminology. Repository facts describe what exists; they do not select the clients or future stack the owner wants.

Ask only decisions whose missing answers affect scope, observable behavior, compatibility, authority or verification. Questions that depend on an unresolved choice wait until that choice is settled. Group related questions to keep the round manageable, and give each recommendation its reason. The user may say they do not know; explain the available default and its practical consequence rather than demanding false precision.

Completion of clarification means the next authorized action is clear and its material blockers have been resolved or explicitly retained. A read-only question or routine local change needs no full installation interview.

## Initialization decisions

Follow **Agent-first, artifact-language-second** ordering; reuse any already confirmed decision instead of asking again:

1. **Supported Agents.** Ask for the selected clients or an explicit all-built-in scope. Detection and the current chat client are evidence, not permission to select support.
2. **Artifact language.** Use `artifactLanguage: en` by default or an explicit `zh-CN` choice, independently of interaction language. Keep IDs, keys and command syntax stable. Legacy `bilingual` remains readable; it is not the new default.
3. **Testing format and location.** Confirm the supported case format and safe relative case root; keep report language and location separate.
4. **Lifecycle and stack.** Existing projects confirm observed facts and preservation strategy. Greenfield projects select targets based on actual deployment, maintenance and delivery needs. Unknown files remain an evidence gap.
5. **Optional capabilities and integrations.** Generate the complete governance baseline. Ask only about applicable optional decisions, including invocation, assistance, workflow authority and exact-approved adaptive additions. Legacy depth input cannot remove required guidance.
6. **Concrete preview.** Show writes, keeps, conflicts, retained content and unresolved gaps. Apply within existing authorization and preserve the initializer's exact-plan requirements. Reuse the user's approval for the same scope; changes to that scope require a fresh decision.

Only ask UI questions when a UI exists and current design authority does not settle the choice. Read [ui-selection.md](ui-selection.md) then; do not add a UI interview to unrelated work.

For workflow integrations, load [workflow-integrations.md](workflow-integrations.md) only when requested or relevant evidence shows an actual overlap. Establish one authority for current product behavior, the active change, design, task list and delivery evidence. Detection does not authorize connecting or executing another provider.

## Explain a decision concretely

Use this shape, adapted to the user's language:

> The repository uses X, shown by this manifest and current entrypoint. Keeping X fits the requested scope. The unresolved choice is whether the new behavior must also support Y; choosing Y adds this specific compatibility work.

For a decision round, state the question, recommended answer, reason and the consequence of the alternative. Avoid hypothetical risk checklists and questions whose answers the agent can retrieve itself.

## Shared terms and consequential decisions

Use an existing glossary or knowledge location. When two terms imply different behavior, test a concrete scenario and settle the meaning. Check claims about current behavior against code. Capture the resolved term where the project already keeps it; create a glossary only when the first reusable term needs one.

Use the existing ADR/design location for a hard-to-reverse choice involving real alternatives whose rationale would surprise a future maintainer. Ordinary implementation choices need no ADR. Terms define the domain; technical choices belong in the appropriate design record.

## Continuation

Use the current task, plan or decision record to retain confirmed choices, repository evidence, unresolved blockers and the next authorized action. A separate decision ledger is optional for long work, not a new prerequisite for every task. In the AICG repository, working notes belong under ignored `local/` paths.

After an interruption, inspect changes since the last decision and reconfirm only choices affected by those changes. Keep user decisions, agent recommendations, implementation and observed verification distinct. A populated document is not product acceptance.

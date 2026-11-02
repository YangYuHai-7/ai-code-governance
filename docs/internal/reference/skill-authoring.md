# Composable Skill authoring

Use this method when creating, updating, splitting or reviewing agent-facing instructions. The generated `standard-skill-authoring` Skill carries the reusable authoring rules into governed projects; this reference explains their use in AICG itself.

## Scope and ownership

Start from realistic requests and one stable decision surface. Reuse an existing capability before adding a new Skill. Preserve the project's authoritative requirements, design, implementation and verification owners. A router selects work; shared methods own reusable rules. Keep one authoritative definition of each rule and point to it from other routes.

Preserve each client's existing invocation policy. Use automatic discovery for methods the agent needs to reach; a request for a workflow does not authorize external effects. Explicit-only metadata is client-specific and requires a user decision and validation in that client. Do not assume that a frontmatter field has identical behavior across clients.

## Entry and references

A description states the capability and concrete situations that need it. Separate distinct trigger cases from synonyms for the same case. Keep common decisions and mandatory boundaries in the entrypoint. Move substantial branch-specific procedures into references with a link that says when to read them. Each branch must still contain enough rules and worked examples to execute the selected task.

Splitting is useful when branches need different material, or a long sequence repeatedly causes premature completion. A short self-contained method needs no extra router. Avoid duplicating commands, dependency versions or file inventories that can be obtained cheaply from the current repository. Document the convention, rationale or exception the repository cannot explain on its own.

## Decisions and shared language

Look up repository facts before questioning the user. Reuse answers already supplied. Ask only material decisions whose prerequisites are settled; provide a recommended answer and reason. Leave dependent questions until their inputs are known. Stop clarification when scope, expected behavior and the next authorized action are clear; ordinary tasks do not need an exhaustive design interview.

Reuse the existing glossary and decision location. Capture an agreed reusable term when ambiguity affects behavior. Record a design decision only for a consequential trade-off that a future reader would otherwise struggle to understand. A glossary defines business meaning; implementation details belong in the design or code.

## Observable completion

For each workflow step name an observable output, the condition for advancing and what remains unresolved if that condition is absent. These are instructions for the agent, not new approval gates. Use the selected workflow's existing approval points.

| Weak instruction | Observable completion |
| --- | --- |
| Understand the project | Identify the changed behavior, its current entrypoint and authoritative requirement; name any missing evidence |
| Clarify the design | Resolve choices affecting the current change; retain unresolved blockers with their consequence |
| Implement the feature | Demonstrate one complete behavior across the necessary layers, including the expected failure case |
| Test thoroughly | Run the relevant discovered checks and report the actual results and what they do not cover |
| Review the change | Compare behavior with requirements and code with repository conventions; attach actionable findings to evidence |

Split implementation into independently verifiable behaviors with real blocking dependencies. Keep each slice bounded enough to implement and check together. Broad mechanical changes may instead expand the interface, migrate consumers in verifiable batches and remove the old interface only after consumers have moved. Test observable behavior through the relevant public interface; expected outcomes come from requirements or independent worked examples.

## Quality and verification

Keep AICG's implementation/workflow quality profiles: implementation guidance includes correct and incorrect code shapes; workflow guidance includes executable decisions and expected outcomes. The quality audit checks structure, not whether prose is correct or agents follow it.

Use the smallest validation that can disprove the proposed improvement:

- Matching request: the necessary method and branch are reachable.
- Non-matching request: unrelated references stay unloaded.
- Realistic task: the instructions lead to a reviewable result with the required boundary intact.
- Missing evidence: the agent reports the gap rather than inventing success.

Run existing generation and context-budget checks for template changes. Check that referenced material is available in the generated or packaged location, not only in the author's workspace. Compare entrypoint size and loaded branch size separately; moving prose is not proof of reduced runtime tokens or better task success. Record client execution only when that client was actually exercised.

## Sources and adaptation

These rules adapt the small/composable methods, conditional context pointers and observable completion ideas discussed in [mattpocock/skills](https://github.com/mattpocock/skills), especially [writing-for-agents](https://github.com/mattpocock/skills/blob/main/skills/productivity/writing-for-agents/SKILL.md) and [to-tickets](https://github.com/mattpocock/skills/blob/main/skills/engineering/to-tickets/SKILL.md). They are AICG guidance, not an imported upstream Skill or a claim about measured prompt effectiveness. Keep AICG's existing authorization, client compatibility, ownership and verification contracts.

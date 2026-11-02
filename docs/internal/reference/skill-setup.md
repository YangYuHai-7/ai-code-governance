# Setup and capability curation

Load this reference only for its selected task branch. Return to [the Skill entrypoint](../../../SKILL.md) for another branch.

## Trigger and scope

For offline Skill discovery and project-AI team onboarding, collect `adaptiveGovernance` through the existing `--config` contract in [initializer.md](initializer.md#adaptive-governance-input). Inspect full `sourceStatus`, bounded candidates, add/defer/reject decisions, explicit professional activation and human-review gaps, file actions, permissions, and costs. Nothing is preselected, installed, or activated by a recommendation. A single exact `--approve <planHash>` authorizes the reviewed transaction; `--yes` alone does not. Use `sync . --config decisions.json` for an existing project's preview. The complete baseline is fixed; approved optional adaptive management records its 30-file, 128 KiB, 2,400-management-profile-token and 256-always-rule footprint as advisories, not gates, because a hard size cap truncates complete Skills. The hard floor is the declared `startup_max_tokens` in the context map, enforced by the checker; deeper, task-specific context belongs in a routed profile. Never delete historical seeds automatically. Default English and explicit `zh-CN` retain the same machine contracts. Real-client execution and qualified-human identity remain unverified. Community capabilities are discovered at the operator layer with `find-skills` and pinned into the packaged catalog before AICG reads them; AICG stays offline and only copies selected packaged Skills after exact approval (see *Public capability discovery*).

Treat explicit governance phrases such as `AI 编码治理框架`, `代码治理框架`, `Agent 治理框架`, and `aicg init` as task intent. The bare phrase `治理框架` requires repository/coding-agent context. Product AI safety and regulatory questions are outside this Skill.
## Installation: Agent-first, artifact-language-second

1. Scan repository files before questions: lifecycle/topology, manifest/lockfiles, exact stacks, scripts, existing adapters, canonical rules, and selected workflow evidence. Filesystem discovery does not execute Git, Agents, or project scripts; `aicg doctor .` reports executable availability separately.
2. First visible decision: supported Agents. Offer Codex, Claude Code, Cursor, GitHub Copilot, DeepSeek Harness, generic, or a combination. Each Agent's Skill directory comes from the Agent registry, so a client is added as a registry entry instead of a new generator branch. Current client and existing files do not decide support. Use `--clients all` only for an owner-selected built-in scope; `--yes` cannot supply it.
3. Second visible decision: `artifactLanguage: en` by default, or `zh-CN`. Interaction follows `--locale`/`interactionLanguage` independently. Explicit Chinese governance selection generates Chinese prose; English IDs, paths, commands, and keys remain stable. Legacy `bilingual` stays readable. This repository's own documentation/comments default to English under its instructions.
4. Third visible decision: choose `testing.caseFormat` (`aicg-json-v2` recommended or `markdown-plus-json`) and a safe repository-relative `testing.caseRoot`. Store report location/language separately.
5. Confirm lifecycle. Existing projects confirm or correct detected stacks; greenfield selects target stacks. Treat manifest-only or unknown product files as potentially ambiguous. Record greenfield architecture as `not-established`, with an evidence gap; do not invent a proven module pattern.
6. Existing projects choose `keep-existing`, `new-code-standard`, or `staged-migration`. Preserve current code. Modernization requires a separate plan. `codeDocumentationPolicy` defaults to `inherit-existing` for existing projects and `en` for greenfield.
7. Always generate the complete governance baseline. Never offer a depth/preset choice or downgrade an existing request to Minimal. Legacy depth inputs are migration-only and cannot omit development Skills or role definitions. Memory ownership/index foundations do not invent module facts. Task runtime, hooks, CI, external workflows, and AI assistance remain explicit choices.
8. Choose invocation, preview writes/keeps/conflicts/retained artifacts, and apply the user's authorization. Recommend project-local only with a usable package executable. Generated daily local invocation is `npm exec -- aicg check .` with that installation; daily global invocation needs an installed `aicg`. Pinned npm bootstrap can resolve a package and does not install the daily CLI.

```bash
aicg init . --guided
aicg config init . --output aicg.config.json --yes
aicg config validate . --config aicg.config.json --json
aicg config open
aicg init . --config aicg.config.json --yes --dry-run
aicg check .
aicg sync .
```

Page-first handoff: the owner may have already saved `aicg.config.json` from `aicg config open`. Reuse those decisions instead of asking again. Run `aicg init . --config aicg.config.json --yes --dry-run`, show the exact plan, apply only on approval, then complete the brownfield gaps (`aicg check . --json` -> `brownfield.gaps`). If the preview reports existing executable governance, stop and let the owner choose `--adopt-foreign-governance` (keep and register the files as user-owned) or cancel; never overwrite or delete foreign governance.

After the base configuration is saved or the bootstrap skeleton is applied, use `aicg handoff . --config aicg.config.json` (or `aicg handoff .` for applied governance) and follow its project-specific prompt. The resulting state is `handoff-ready`, not governance completion. AICG supplies deterministic configuration, bootstrap artifacts, checks and evidence boundaries; the calling AI coding tool completes the semantic governance from the real repository. For every selected and actually detected technology, including stacks AICG already recognizes, use the Agent's live search capability to consult current official or primary sources for repository structure, architecture options, development/testing/security/operations/migration practices, version compatibility, licensing, paid SDKs, redistribution limits and external costs. Fixed templates are bootstrap material only. If live access or adequate primary evidence is unavailable, keep the affected item `research-required` and `unverified`; never present an offline fallback as current best practice.

Configuration carries decisions. `config init` creates an editable, scan-backed `aicg.config.json` without overwriting different content; an identical retry is unchanged. `config validate` exercises the same effective plan preparation as `init` and writes a local report. `config open` starts a loopback-only visual editor for the same file, with explained choices, JSON upload/download, validation, save, exact-plan preview, and explicit apply. Without a path it opens a project picker with recent projects, an absolute-path field, and folder browsing; an explicit path opens that project directly. Interactive npm installation (project-local or global) attempts to open the picker. Noninteractive writes require `--yes`; request-based writes require the exact current `--approve <planHash>`. Reuse existing authorized decisions rather than asking them again. Optional AI assistance supports high-confidence greenfield and existing projects with a selected available Agent; failure leaves that phase unverified without rolling back valid deterministic initialization.

For an existing project, initialization generates `docs/ai/development/index.json`, one scan-backed development document and README entrypoint per detected development unit, plus the `brownfield-understanding` Skill and concrete role definitions. Run `aicg init ... --assist <selected-agent>` to have the selected Agent process each unit, record existing business behavior in `docs/memory/INDEX.json` and owning pages, complete code-backed development docs, and propose project Skills through approval. Inspect `aicg check --json` and its `brownfield.gaps`; a successful scan is only a baseline. Never convert filenames or an unexecuted command into behavioral fact.
## Existing-project completion

An existing-project governance request includes completing the calling Agent's project-understanding work in the same session; initialization is its starting point. After applying the preview, follow the handoff and inspect current callers, implementation, contracts and representative tests. Complete each development unit, the selected architecture views and stable project action guides. Record business Memory only when its existing feature/owner decision authorizes that scope. Historical notes are leads: reconcile them against current source rather than restoring old digests or treating a former test result as current.

Check whether the resulting knowledge can answer concrete project questions: where a change belongs, which contract and caller must stay compatible, how failure differs from an empty result, what data or external effects occur, and which existing test or missing verification covers the behavior. Keep a small task-to-knowledge index so a later Agent reaches only the relevant material. Sync compiled guides and client projections after editing their human source. Report the content achieved and unresolved semantic gaps alongside structural findings. A pure-generation comparison is a separate measurement and must not substitute for requested project understanding.

## Human documentation and compiled development Skills

All development explanations, architecture views and business-flow diagrams live under `docs/development/` for human review. `docs/development/README.md` is the entrypoint; unit explanations live in `units/`, technical guidance in `standards/`, and authored project-specific action guides in `skills/`. Existing authored documents are preserved; legacy development pages are copied into this guide without deleting their sources. Keep code evidence as plain paths, not source-code hyperlinks.

The generator compiles complete instructions from those human guides into `docs/ai/skills/standards/` and `docs/ai/skills/development/`. Each authored action guide uses `name` and `description` frontmatter, and contains `When to use`, `Required invariants`, `Correct implementation shape`, `Incorrect implementation shape`, and `Verification matrix` sections. Include actual rules and examples; a link to a long document is insufficient. Skill source digests invalidate stale output. Run `sync --dry-run`, apply the authorized non-destructive update, then check. Do not edit generated Skill bodies or adapters directly. Baseline role definitions always ship; map the actual systems, responsibilities and handoffs without claiming people were hired or independent review occurred. Full generation does not authorize external integration, dependencies or publication.


## Public capability discovery: `find-skills` at the operator layer

Community Skills extend what AICG generates. Discovery happens in the operator/agent session, not inside AICG, which stays offline: no network discovery, installation, execution or home traversal at governance time. Use `find-skills` ([vercel-labs/skills](https://github.com/vercel-labs/skills), MIT) with the open ecosystem CLI and registry:

```bash
npx skills find "test driven development" --owner obra
npx skills add obra/superpowers@test-driven-development
npx skills update
```

Browse and rank candidates at [skills.sh](https://skills.sh/) before installing; the leaderboard surfaces install volume, not suitability. Discovery output is unverified input, never a governance decision.

To make a candidate available to AICG, pin it instead of installing it into the governed tree:

1. Add the source to [public-skill-sources.json](../../../assets/registries/public-skill-sources.json) with the repository, a full 40-hex commit `ref`, `committedAt`, license, and one entry per Skill carrying `capabilities`, `capabilityOwner`, `permissions` and a bounded `purpose`.
2. `npm run catalog:vendor` fetches each pinned ref into the gitignored `vendor/` cache. `npm run catalog:build` regenerates [public-skill-catalog.json](../../../assets/registries/public-skill-catalog.json); `npm run catalog:check` validates it offline and re-hashes vendored bytes when they exist.
3. Set `adaptiveGovernance.publicSkillCatalog: true` (or pass explicit `curatedCatalog` records). The packaged snapshot is opt-in; without it the candidate set and recorded approval are unchanged. `phuryn/pm-skills` contributes 69 individually selectable Skills. The AICG-authored Next AI Draw.io adapter is a separate candidate with a required local MCP dependency.

Every packaged record defaults to `defer`. For Complete governance, `adaptiveGovernance.bundledSkillImports: true` copies only selected PM Skills and the draw.io adapter from the pinned package into `docs/ai/skills/` after an explicit `add` decision and the exact `--approve <planHash>`. Generated client files route to that canonical copy. AICG never runs a copied Skill or installs an MCP server; the draw.io adapter needs separate client-side MCP setup. Unbundled public candidates remain metadata-only. `verifiedAt` is the pinned commit date, so a snapshot older than 90 days becomes `refresh-due` and approval fails until the pin is refreshed.

Boundaries when curating:

- Accept only permissive licenses (`MIT`, `Apache-2.0`, `BSD-*`, `ISC`, `0BSD`); the document-format Skills in `anthropics/skills` are source-available, not open source, and stay out of the catalog.
- One capability keeps one owner. Do not let a public Skill claim the capabilities AICG already generates (`skill-discovery`, `team-orchestrator`, `brownfield-understanding`, `professional-testing`, stack standards); use public Skills to fill gaps such as TDD, completion evidence and skill authoring.
- Public Skills never populate `projectTeam` roles, `activation` or professional conclusions. Those require owner-confirmed evidence and qualified-human review regardless of what a public Skill claims.

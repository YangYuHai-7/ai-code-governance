# Existing-project governance refresh

Use this workflow when the user asks to update or refresh AICG governance for an existing
repository. The request authorizes routine, non-destructive governance maintenance in the named or
current repository. It asks the Agent to do the work, not to return a long prompt for the user to
copy into another conversation.

## Trigger and outcome

Examples include `AICG 更新治理框架`, `用 AICG 更新治理框架`, `更新 AICG 治理`, `刷新治理框架`,
and equivalent wording that clearly refers to repository or coding-Agent governance.

The completed outcome is:

1. existing project and owner decisions preserved;
2. current repository facts and governance gaps inspected;
3. one project-specific AICG handoff followed by the calling AI coding tool;
4. current official or primary-source research completed for every selected and actually detected
   technology, including technologies already known to AICG;
5. safe governance-only changes previewed and applied;
6. structural and applicable project verification rerun; and
7. changed, verified, blocked, and still-unverified states reported separately.

## Execution

1. Resolve the repository from the explicit path, attached workspace, or current project. If it is
   genuinely ambiguous, ask only for the repository location.
2. Read the repository instructions, existing AICG configuration and ownership manifest, canonical
   governance, development-unit entrypoints, package/build files, relevant source, and tests. Preserve
   the recorded clients, language, depth, lifecycle, stack, topology, risk, and owner decisions. If
   the repository has no AICG ownership yet, use existing-project onboarding, preserve foreign
   governance, and ask only for a missing owner decision or concrete conflict. Do not interpret a
   vague refresh as a request for Complete governance. For a repository family, inspect each member;
   the parent configuration does not replace member-specific development guidance.
3. Use the active local AICG source selected for the environment. Run `aicg check . --json` to record
   the starting gaps, then run `aicg handoff . --locale <interaction-locale>` and follow the returned
   project-specific prompt. If the applied project has no supported `handoff` command, report the
   tool-source gap instead of falling back to an old fixed template.
4. Inspect real repository changes since the previous governance baseline. Update code-backed
   development documentation and project Skills only where current source, callers, error behavior,
   and tests support the claim. Keep every Skill reachable from its scoped entrypoint. Do not infer
   a new architecture or turn repetition into an approved convention without decision evidence.
5. Research every actual technology through the calling Agent's available search tools. Prefer
   current official documentation, official repositories, standards, specifications, and other
   primary sources. Record URLs, applicable versions, and access dates. Cover repository structure,
   architecture alternatives and tradeoffs, development, testing, security, operations, migration,
   compatibility and upgrade risk, licensing, paid SDKs, redistribution constraints, and external
   costs. Separate observed repository facts, external guidance, project recommendations,
   owner-confirmed decisions, and unverified assumptions.
6. Preview managed changes with `aicg sync . --dry-run`. Inspect every create, update, keep, conflict,
   and retained/orphan classification. Apply safe in-scope changes in the same conversation. When the
   command requires exact approval, use the current returned plan hash only as its freshness guard;
   do not ask the user to copy it. Inspect the real diff before changing human-maintained canonical
   files.
7. Run `aicg check . --json --enforce` and the smallest relevant discovered, structurally trusted
   project verification commands. A missing Git baseline may block formal completion but does not
   authorize `git init`.
8. Report in plain language: governance files changed, why the guidance fits this repository,
   primary sources and versions used, preserved and newly confirmed decisions, command results,
   real-client/CI/hook status, remaining `research-required` or `unverified` gaps, and the next owner
   decision if one is required.

## Stop conditions and authority boundary

Do not infer authority to:

- modify product or business code;
- use `--prune`, `--force`, migrate links, or adopt foreign governance;
- delete historical seeds, owner-authored files, or user content;
- initialize Git, create commits, install dependencies, enable clients, or change remote settings;
- accept a new architecture, paid dependency, license obligation, redistribution term, or external
  service on the owner's behalf; or
- publish, push, send, or disclose project material.

Finish all independent safe work before asking about one of these decisions. If network access,
primary sources, applicable versions, or project evidence are insufficient, retain
`research-required` and `unverified`. Never present bundled or fixed AICG content as current project
best practice merely because generation or structural checks passed.

## Evidence boundary

Keep bootstrap generation, structural presence, reachability, research, source review, owner
confirmation, project adoption, project verification, real-client execution, CI/hook execution,
independent review, and real-user acceptance as separate states. Passing one state does not promote
the others.

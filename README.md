# AI Code Governance

A repository governance CLI and Agent Skill for Node.js 22+. AICG keeps one canonical rule source, routes tasks to small context profiles, and checks managed artifacts for drift. Governance grows with confirmed project needs and verified implementation evidence.

This checkout is the `0.2.0` source candidate. The commands below describe this source or its candidate tarball; they do not establish which version is currently published on npm. `toolVersion`, capability coverage track, and certification evidence are separate axes.

## Start from this candidate

```bash
node bin/aicg.js doctor /path/to/project
node bin/aicg.js init /path/to/project --guided
node bin/aicg.js check /path/to/project
```

For installed usage, pin the version you have chosen. Recommend project-local execution only when the executable and package identity are present and usable. Generated daily project-local commands use `npm exec -- aicg check .` with that installation; a global installation uses `aicg check .`. Pinned `npm exec --yes --package=ai-code-governance@<version> -- aicg init .` is an explicit bootstrap that can require package resolution. It does not install the daily CLI: install a chosen version locally or globally before using the corresponding daily commands. Source execution with `node bin/aicg.js` needs neither a package download nor an Agent login.

## Installation contract

Read-only repository scanning precedes the questions. The first visible decisions are **Agent-first**, then **artifact-language-second**:

1. Select supported Agents: Codex, Claude Code, Cursor, generic, or a combination. Existing adapters and the current chat client are evidence, not the owner's selection. `--clients all` selects the three built-in clients; `--yes` alone cannot select the client scope.
2. Choose `artifactLanguage: en` (default/recommended) or `zh-CN`. `--locale` controls interaction independently. Chinese conversation does not silently select Chinese artifacts; choosing `zh-CN` explicitly generates Chinese governance prose. Existing `bilingual` configuration remains readable. IDs, commands, paths, and schema keys stay English.
3. Confirm lifecycle. Existing projects confirm or correct the detected stack; greenfield projects select their target stack. A scaffold with only a manifest can be ambiguous. Greenfield architecture remains `not-established` until actual implementation and owner confirmation establish it.
4. For existing code, choose `keep-existing`, `new-code-standard`, or `staged-migration`. The latter records a future migration boundary; initialization does not migrate product code.
5. Recommend Minimal or Standard from scan evidence and the owner's needs; select Complete only for an explicit need. Guided onboarding defaults to Minimal; advanced onboarding and `defaultConfig()` retain Standard. Neither defaults to Complete. Select optional capabilities separately.
6. Choose an available invocation mode, preview the plan, and approve the write.

`codeDocumentationPolicy` defaults to `inherit-existing` for existing projects and `en` for greenfield. This tool's own repository documentation and code comments are English under its repository instructions; that convention does not remove the product's Chinese governance option.

Noninteractive initialization needs explicit client scope and confirmed lifecycle/strategy where required, plus `--yes` for writes. A configuration supplies decisions, not write approval. See the [initializer contract](references/initializer.md) for exact flags and ownership rules.

## Presets select capabilities

The historical twelve-layer model is a capability catalog, not a mandatory installation or task sequence. Preset depth and task level are independent.

| Preset | Fresh default selection |
| --- | --- |
| Minimal | Config, shared entry, canonical overview, context map, always rules, and apply-generated manifest; selected client adapters only |
| Standard | Minimal plus routing, verification guidance, decision ledger, local report directories, and relevant policy/standard Skills |
| Complete | Standard plus selected stack Skills; memory, task runtime, hooks, CI, and workflow bridges remain explicit options |

Release, surface, and acceptance policies activate on first use; result receipts appear only when evidence exists. Ordinary context contains the shared entry, the selected context-map slice, and always rules. Architecture, standards, business rules, harvest, hooks, reports, and release policies are loaded only for the relevant task. Adapters use ordinary files or native imports, with manifest hashes; AICG creates no link adapters.

## Dynamic task flow

| Level | Trigger and work |
| --- | --- |
| L0 | Read-only explanation, discovery, review, or status: read relevant evidence and answer; no governance subprocess or harvest |
| L1 | Local governance/documentation/test or low-risk non-production change: locate, edit, run targeted verification, then one completion check; no formal plan approval |
| L2 | Product behavior, business rules, public contract, or multiple modules: confirm requirements and approve the implementation plan before implementation and behavior verification |
| L3 | Multiple surfaces, architecture, migration, external action, or high-consequence risk: approve requirements, design, and plan; perform integrated verification |

Classification combines mutation, scope, risk, and clarity; a short request does not determine the level. Exploratory requirements add clarification/approval without inventing impact. New evidence can only raise the route. Generic production-source diffs conservatively require at least L2 even if a fix appears small; sensitive paths may require L3. An explicit release intent adds the release overlay, but mentioning a release does not authorize one.

```bash
aicg complete . --task-level L2 --verify "npm run test" --json
```

Completion compares the declaration to the minimum level supported by the current Git diff. An under-declaration blocks verification and completion; an omitted declaration is `unverified-declaration`. Completion is not triggered by every conversation or file write. It does not write governance artifacts. The explicitly selected project verification script can have its own effects. A Git hook, if separately installed, checks only the isolated staged snapshot and never runs product tests or harvest writes.

Only verified eligible product changes receive a candidate-only completion harvest summary. No automatic promotion occurs. Read-only, prose/format-only, fixture, temporary-script, and non-reusable changes are skipped. Explicit `aicg harvest . --dry-run --json` remains discovery without claiming tests ran. Applying harvest and promoting a candidate are separate explicit actions; see [capability evolution](references/continuous-skill-evolution.md).

## Safe maintenance and explicit release

### Offline Skill and project-agent recommendations

`init . --yes --config decisions.json --dry-run` previews at most five offline Skill candidates, dynamic project-AI roles, complete `sourceStatus`, add/defer/reject decisions, professional-human gaps, file actions, permissions, context costs, and one exact `planHash`. Put optional inputs under `adaptiveGovernance`; `installedRoots` must be an explicit array (use `[]` for project-only discovery). No home/global scan, network lookup, installation, role creation, or task execution occurs. Recommendations are not preselected. See the [input contract](references/initializer.md#adaptive-governance-input).

Review the preview, then repeat the command without `--dry-run` and with `--approve <planHash>`. `--yes` is not adaptive approval. Source, permissions, selection, activation, or cost changes invalidate the hash, including unselected candidates included in the index. Existing projects use `sync . --config decisions.json` to preview and the same exact approval to apply; ordinary sync without adaptive changes remains compatible.

Minimal generates no management artifacts. An approved Standard/Complete selection adds two management Skills, a discovery index, and a trusted project roster. Ordinary context remains three files / at most 900 estimated tokens; the two manager bodies remain at most 800 tokens, total files at most 26, and Standard/Complete bytes at most 64/96 KiB. Only the approved combination omits bootstrap/directory placeholders and folds business workflow guidance into the team manager; machine constraints and technical/architecture rules remain. Historical seeds are never auto-deleted: `budget-blocked` previews require separately authorized manual review/cleanup. AI roles do not replace qualified professionals or prove real-client execution.

Ordinary `aicg sync .` is zero-delete, including preset downgrade and template upgrades. It retains historical, seed, unknown, edited, and dormant evidence content. Inspect retained legacy artifacts before requesting physical pruning:

```bash
aicg sync . --prune --dry-run
# Review the entire plan; substitute its exact hash below.
aicg sync . --prune --approve <planHash>
```

Only trusted, unchanged, fully managed current/historical artifacts are eligible. A changed input invalidates approval; `--force` cannot replace it. Failed application/checking restores the prior tree transactionally. Ordinary sync is not an approval to remove unused adapters.

Release checks are a separate workflow, loaded only for explicit release work:

```bash
aicg release-check . --type feature --evidence docs/ai/release-evidence/candidate.json --json
# Review replayPlan before explicitly approving command execution.
aicg release-check . --type feature --evidence docs/ai/release-evidence/candidate.json --replay --approve <planHash>
```

The replay plan binds the candidate, script text/hash, expected exit and output digest. Required independent review and product evidence cannot be fabricated by AICG. See [release acceptance](references/release-acceptance.md). Publishing, pushing, deployment, hooks, and CI changes require their own authorization.

## Evidence and budgets

| Evidence state | Meaning |
| --- | --- |
| `stated` | Guidance exists; its behavior has not been established |
| `reachable` | A checked entry/profile can resolve the canonical artifact; this is structural evidence |
| `enforced` | A specific machine check and its negative probe reject a broken assertion |
| `verified` | A named command, candidate, scope, platform, and outcome have actual execution evidence |

Structural tests do not prove a real Codex, Claude Code, or Cursor session loaded the rules. Local macOS results cannot establish Linux/Windows results. For the current candidate those platforms and real-client loading are **not yet verified** unless separate current receipts establish them. Stack detection for React, Vue, Angular, Node.js, and Java does not certify project behavior; future Android/iOS or other capability coverage remains subject to the [registry](assets/registries/capability-pack-registry.json).

The deterministic Codex-only fixtures enforce exact path sets and file counts, including the manifest, plus independent byte caps: Minimal <=10 files/24 KiB, Standard <=20 files/64 KiB, Complete <=26 files/96 KiB. These are fixture budgets, not universal counts for all client/stack/feature combinations. Ordinary context is exactly three unique files, <=3,600 bytes and <=900 estimated tokens (characters/4, not a model tokenizer).

Performance sampling uses three warmups and 20 measured samples: small (32-file) check p95 <=250 ms, 10k check <=1,000 ms, routing <=20 ms, and fast-suite <=5,000 ms. The 50k case is informational. Each sampled CLI check uses one launched process; this is not a measurement of a real Agent's process usage. Relative regression limits require a supplied same-runner baseline; absolute caps always remain active. Broader design targets such as a separate 1k fixture, behavior/release client context budgets, cumulative context, and end-to-end Agent subprocess budgets require additional evidence.

## Contributor validation

```bash
npm run test:fast
npm run test:full
npm run validate
npm run smoke
npm run smoke:package
node scripts/prepublish-check.mjs
npm pack --dry-run
```

`test:full` preserves `npm test` (`node --test`) and includes the performance sampler; `test:perf` runs it separately. Package smoke installs a temporary tarball and cleans up; inspect dry-run contents for `bin/`, `src/`, `assets/`, `references/`, validation/release scripts, README, SKILL, and LICENSE. Tests, local reports, `.superpowers`, worktrees, and credentials must not ship.

`prepublish-check` intentionally fails without real `AICG_RELEASE_TYPE`, repository-relative `AICG_RELEASE_EVIDENCE`, and exact `AICG_RELEASE_APPROVAL`. Local regression success is not a substitute for that release gate. Running `npm pack --dry-run` neither publishes nor manufactures release approval.

## Maintenance architecture and references

`bin → src/cli → src/modules → src/kernel + src/shared`; adapters isolate external effects and catalogs load versioned assets. Root `src/*.mjs` files are compatibility facades. `test:architecture` checks import boundaries; `test:scenarios` covers packaged synthetic project scenarios.

Start with [SKILL.md](SKILL.md) or the [reference map](references/README.md). Use [workflow integrations](references/workflow-integrations.md) only for a selected provider: one owner per spec, design, plan, task list, and completion state. No external provider is an implicit dependency.

## License

[Apache-2.0](LICENSE).

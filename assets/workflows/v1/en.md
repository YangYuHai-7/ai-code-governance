# Project Delivery Workflow

> This is the only delivery workflow document. Route the task first and load only selected capabilities; the sections below are not a mandatory pipeline.

Use `aicg route . --text "task"` to inspect conditional capabilities. L0 creates no artifacts; L1 uses targeted verification; L1.5 uses reproduction, root cause and regression; L2 defaults to BA, plan and module cases; UI adds product design; L3 or greenfield adds technical design. Use `aicg delivery prepare . --text "task" --scope MODULE --yes` to create missing drafts, then complete them from evidence.
Worktrees, commits, concurrent Agents and per-task double reviews are not defaults. Choose TDD and review depth from risk. Reference the single existing OpenSpec/native specification, plan and design authority.

After completing drafts, run `aicg delivery assess` with the same text, scope and paths to inspect placeholders, duplicate bodies, key sections and case references. Structural readiness does not prove business accuracy, executed tests or owner acceptance.

## Role model

- Every role is organised and added from the requirement content; no team is fixed in advance.
- Base roles: PM, BA, architect, frontend, backend, full-stack, design, test.
- Each base role has a short runbook under `docs/ai/agents/<role>.md`; read the matching one for required evidence, escalation and the completion gate.
- A specialised requirement (contracts, legal, finance, security) must add the matching specialist (for example a lawyer) to analyse the requirement with the BA; the specialist advises on business questions.
- Role participation is not a professional conclusion or a signature; a regulated outward conclusion still needs a qualified human.

## Flow

### 1. Requirement analysis

Organise or add roles to the team from the requirement content, then branch:

- **Business behavior**: default to a lean BA covering outcome, actors, current/target flow, rules, scope, acceptance and owner questions. Existing projects document only the change delta.
- **Complete requirement**: analyse the content and check the requirement details item by item.

Ask only material scope, business, authority or cost questions; reuse confirmed information and settle routine implementation details. Keep unresolved decisions in `openQuestions`.

### 2. Page design (optional)

- The requirement has no frontend page: skip this step.
- For frontend design, inspect existing guidelines, Storybook, tokens, components and screenshots; inherit existing specifications by reference and expose conflicts.
  - Greenfield: establish navigation, color/type/spacing tokens, components, responsive and accessibility rules; supply a key-flow wireframe or HTML preview.
  - Existing project without specifications: extract an evidence-backed current baseline with gaps. Design modernization needs its own decision. Produce multiple options only when the visual direction needs comparison.
- A preview draft is a proposal and never enters the production build.

### 3. Architect PK and development plan

The PM selects architecture review depth from task risk. L3, greenfield and new architecture decisions need technical design covering modules, interfaces, data, programming conventions, compatibility and rollback. Routine L2 work inherits existing design.

- Bring only decisions that change requirements, approach or task boundaries to the owner; record routine decisions in the plan.
- Ensure the requirement and design are implementable, and produce the development plan.
- State module/file responsibilities, dependencies, commands and completion criteria in the single authoritative plan. Bind its summary into `planHash`; a plan change invalidates prior approval.

### 4. Task decomposition and development

The PM decomposes the plan and organises teams by task size:

- Keep granularity coarse; each team must deliver a complete capability.
- Teams may depend on each other and be sequenced accordingly.
- Never hand one very large requirement to a single team.
- After development, move to testing; synchronise the owning memory page for behaviour changes.

### 5. Testing

Before implementation, maintain stable module Case IDs with BA requirement/scenario references. Reuse actors, environments and data through schema-v2 `imports: [{path, sha256}]`. Shared-context changes require fresh case selection. Cover success, failure, boundary, abnormal, permission and applicable risk cases.
The PM assigns professional testers or real users to run functional testing and produces the final test report.

- Record automated, AI-simulated-human and real-user results separately.
- Record unrun cases as `NOT_RUN` and failures as `FAIL`; never report an unrun case as passing.

### 6. Repair

- **Non-business issues** that need no user confirmation: assign a team automatically, fix and retest.
- **Business issues**: wait for owner confirmation before repairing; never decide unilaterally.

## Task levels

The level comes from `aicg route` based on mutation, scope, risk and clarity, not intuition:

- `L0` read-only explanation, review or status: no flow state.
- `L1` low-risk local or non-production change: locate, edit, targeted verification.
- `L2` product behaviour, business contract or multi-module: implement and verify after requirement and plan approval.
- `L3` multi-surface, architecture, migration, external action or high consequence: implement and verify after requirement, design and plan approval.

## State and evidence

- Project flow state: `.ai-governance/state/flow-state.json`; delivery loop state: `.ai-governance/state/delivery-loop.json`. The tool writes only the empty baseline; the executing side owns it afterwards.
- Levels and gates: `.ai-governance/state/task-routing-policy.json` and `aicg route`.
- A ledger records declarations and evidence references, not execution or certification.

## Definition of done

- Every open requirement, design and plan question has owner confirmation.
- Development is complete, the repository verification commands the task needs were run, and a test report is saved.
- Behaviour changes synchronised the owning memory page; unconfirmed content stays `unverified` or a gap.
- Run `aicg complete` once before delivery.

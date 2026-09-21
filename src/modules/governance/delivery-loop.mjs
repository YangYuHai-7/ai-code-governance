import { GENERATED_MARKER } from '../../constants.mjs';
import { stableJson } from '../../shared/index.mjs';

/**
 * The delivery loop turns one requirement into a shipped, tested change across the phases a
 * repository actually runs: decompose, assign, develop, author tests, test locally, then fix
 * and retest until the loop converges.
 *
 * Budget shape follows the load class, not the total size. `delivery-loop` is the only Skill
 * an agent keeps in context for the whole task, so it must stay small; every phase Skill is
 * loaded only while its phase is active. Budgeting the two classes together would either
 * starve the always-on entry or leave the on-demand phases unaccounted for.
 *
 * Phase content is a table rendered by one function rather than one template per Skill, so
 * the quality contract (eight sections, ordered decisions, a matrix that names commands)
 * holds by construction and cannot be forgotten in a single Skill.
 */

export const DELIVERY_LOOP_SKILL = 'docs/ai/skills/delivery-loop/SKILL.md';
export const DELIVERY_LOOP_LEDGER = 'docs/ai/delivery-loop.json';
export const DELIVERY_LOOP_ENTRY_KIND = 'delivery-loop-skill';
export const DELIVERY_LOOP_PHASE_KIND = 'delivery-loop-phase-skill';

/**
 * Canonical phase order. Every phase must own exactly one Skill: the guard below fails the
 * module load if the two drift apart, because a phase the ledger names but no Skill covers
 * leaves an agent with nothing to load at exactly that step.
 */
export const DELIVERY_PHASES = ['decomposition', 'assignment', 'development', 'test-authoring', 'local-test', 'report', 'fix-loop'];

const ENTRY = {
  id: 'delivery-loop',
  title: { zh: '交付闭环', en: 'Delivery loop' },
  description: {
    zh: '在一个需要改动代码的交付需求跨多个阶段或多个人/角色推进时使用；按账本推进阶段，一次只加载当前阶段的 Skill。',
    en: 'Use when one code-changing requirement crosses several phases or several owners; advance the ledger one phase at a time and load only the current phase Skill.',
  },
  use: [
    { zh: '需求需要改代码，且有可判定的验收标准。', en: 'The requirement changes code and has decidable acceptance criteria.' },
    { zh: '需要拆分给多个角色并行开发，或跨多个子工程。', en: 'Work must be split across roles in parallel, or across several units.' },
    { zh: '需要本地自测并留下可复核的证据。', en: 'Local self-testing must leave reviewable evidence.' },
  ],
  notUse: [
    { zh: '只读问答、代码解释或纯文档改动——不要建立交付账本。', en: 'Read-only questions, code explanations, or documentation-only edits: do not open a delivery ledger.' },
    { zh: '验收标准无法判定（「优化一下」「更好用」）——先让负责人把它变成可判定条件。', en: 'Acceptance criteria are not decidable ("optimize it", "make it nicer"): have the owner turn them into decidable conditions first.' },
    { zh: '不要用它替代业务负责人对业务含义的确认。', en: 'Never use it as a substitute for owner confirmation of business meaning.' },
  ],
  invariants: [
    { zh: '进度只写在 `docs/ai/delivery-loop.json`，不在对话里维护状态。', en: 'Progress lives only in `docs/ai/delivery-loop.json`; never track state in conversation.' },
    { zh: '一次只加载当前阶段的 Skill；不要预加载全部阶段。', en: 'Load only the current phase Skill; never preload every phase.' },
    { zh: '没有验收标准和验证命令的工作单元不得进入开发阶段。', en: 'A unit without acceptance criteria and a verification command never enters development.' },
    { zh: '未执行记 `NOT_RUN`、未通过记 `FAIL`；不得把未跑过的用例写成通过。', en: 'Record unrun cases as `NOT_RUN` and failures as `FAIL`; never report an unrun case as passing.' },
    { zh: '修复循环有迭代上限；达上限仍未收敛必须升级给负责人。', en: 'The fix loop has an iteration ceiling; reaching it without convergence escalates to the owner.' },
  ],
  steps: [
    { zh: '读 `docs/ai/delivery-loop.json` 和 `docs/ai/task-routing-policy.json`，确认当前阶段与路由等级。', en: 'Read `docs/ai/delivery-loop.json` and `docs/ai/task-routing-policy.json` to confirm the current phase and routing level.' },
    { zh: '按下方分发表只加载当前阶段对应的 Skill 正文。', en: 'Load only the Skill body that the dispatch table names for the current phase.' },
    { zh: '阶段判据满足后，把证据与产出写回账本，再把 `phase` 推进到下一阶段。', en: 'Once the phase criteria hold, write the evidence and outputs back to the ledger and advance `phase`.' },
    { zh: '判据不满足时留在当前阶段，把缺口写进 `openFindings`；不得为了推进而跳过判据。', en: 'If the criteria do not hold, stay in the phase and record the gap in `openFindings`; never skip criteria to advance.' },
    { zh: '`report` 阶段产出可复核报告后再进入 `fix-loop`；`fix-loop` 收敛后把 `phase` 置为 `converged`。', en: 'The `report` phase emits the reviewable report before `fix-loop`; once `fix-loop` converges, set `phase` to `converged`.' },
  ],
  escalate: [
    { zh: '迭代预算耗尽仍未收敛 → 停止重试，升级并列出未解决项。', en: 'Iteration budget exhausted without convergence: stop retrying, escalate, and list what remains.' },
    { zh: '同一条负向用例连续失败三次 → 停止自动修复，判断是用例、环境还是产品缺陷。', en: 'One negative case fails three times in a row: stop auto-fixing and decide whether the case, the environment, or the product is wrong.' },
    { zh: '需求中途变更 → 回到 `decomposition` 重新确认验收标准，不要在半途改判据。', en: 'The requirement changes mid-loop: return to `decomposition` and reconfirm criteria instead of editing them in flight.' },
  ],
  matrix: [
    { scenario: { zh: '账本打开且阶段已确认', en: 'The ledger opens with a confirmed phase' }, expected: { zh: '账本存在，`phase` 与 `units` 已记录', en: 'The ledger exists with `phase` and `units` recorded' }, command: '`aicg route . --text "<requirement>"`' },
    { scenario: { zh: '阶段判据不满足', en: 'The phase criteria do not hold' }, expected: { zh: '`openFindings` 非空且 `phase` 不变', en: '`openFindings` is non-empty and `phase` is unchanged' }, command: '`aicg check .`' },
    { scenario: { zh: '循环收敛', en: 'The loop converges' }, expected: { zh: '`phase` 为 `converged` 且无 `FAIL` 运行', en: '`phase` is `converged` with no `FAIL` run' }, command: '`aicg complete . --work-unit <relative-json>`' },
  ],
  dispatch: {
    decomposition: { zh: '拆需求', en: 'Split the requirement' },
    assignment: { zh: '定人定范围', en: 'Assign owner and scope' },
    development: { zh: '在范围内实施', en: 'Implement in scope' },
    'test-authoring': { zh: '写用例', en: 'Author cases' },
    'local-test': { zh: '本地自测取证据', en: 'Test locally for evidence' },
    report: { zh: '出报告', en: 'Emit the reviewable report' },
    'fix-loop': { zh: '修复重测至收敛', en: 'Fix and retest to convergence' },
  },
  boundary: {
    zh: '账本记录的是声明、产出路径与证据引用，不是执行本身。工具不重放浏览器操作、数据变更或长时运行；没有对应证据的项保持 unverified。',
    en: 'The ledger records declarations, artifact paths, and evidence references, not execution itself. The tool never replays browser actions, data mutations, or long-running jobs; anything without matching evidence stays unverified.',
  },
  sources: ['docs/ai/delivery-loop.json', 'docs/ai/task-routing-policy.json', 'docs/ai/agent-team.json'],
};

const PHASE_SKILLS = [
  {
    id: 'delivery-decomposition',
    phase: 'decomposition',
    title: { zh: '交付：需求拆分', en: 'Delivery: requirement decomposition' },
    description: {
      zh: '在交付闭环处于 decomposition 阶段时使用；把需求拆成工作单元，并为每个单元确定验收标准与验证命令。',
      en: 'Use when the delivery loop is in the decomposition phase; split the requirement into work units and give each one acceptance criteria and a verification command.',
    },
    use: [
      { zh: '需求已确认要做，但还没有工作单元边界。', en: 'The requirement is agreed but unit boundaries do not exist yet.' },
      { zh: '一个需求横跨页面、接口、服务、数据和测试。', en: 'One requirement spans pages, APIs, services, data, and tests.' },
    ],
    notUse: [
      { zh: '需求还没有可判定的验收标准——先补齐，不要先拆。', en: 'The requirement has no decidable criteria yet: complete them before splitting.' },
      { zh: '不要按接口或文件拆单元；那会让一个功能跨越多个单元。', en: 'Do not split by endpoint or file; that spreads one feature across several units.' },
    ],
    invariants: [
      { zh: '一个纵向功能一个工作单元，不按端点或文件切分。', en: 'One vertical feature is one work unit; never split by endpoint or file.' },
      { zh: '每个单元必须有 `requirements.acceptanceCriteria` 和 `verification.command`。', en: 'Every unit needs `requirements.acceptanceCriteria` and `verification.command`.' },
      { zh: '路由等级由 `aicg route` 给出，不靠人工感觉。', en: 'The routing level comes from `aicg route`, not from intuition.' },
      { zh: '影响面跨子工程时，每个子工程独立成一个单元并声明契约。', en: 'When the change spans units, each unit becomes its own work unit with an explicit contract.' },
    ],
    steps: [
      { zh: '用 `aicg route` 得到等级、必需审批与验证类别。', en: 'Run `aicg route` to obtain the level, required approvals, and verification class.' },
      { zh: '按纵向功能切分单元，写出每个单元的验收标准。', en: 'Split by vertical feature and write acceptance criteria per unit.' },
      { zh: '为每个单元确定它自己的验证命令，并确认命令在白名单内。', en: 'Decide each unit\'s verification command and confirm it is allowlisted.' },
      { zh: '把单元清单、等级、验收标准写入 `docs/ai/delivery-loop.json`。', en: 'Write the unit list, level, and criteria into `docs/ai/delivery-loop.json`.' },
      { zh: '运行 `aicg work-unit plan` 预览校验，通过后进入 `assignment`。', en: 'Run `aicg work-unit plan` to preview validation, then move to `assignment`.' },
    ],
    escalate: [
      { zh: '拆不出可判定验收标准 → 退回负责人，不要用「能跑通」当标准。', en: 'No decidable criteria can be derived: return to the owner; never accept "it runs" as a criterion.' },
      { zh: '单元数量超过 5 个 → 先确认是否可以先交付一个纵向切片。', en: 'More than five units: first confirm whether one vertical slice can ship alone.' },
    ],
    matrix: [
      { scenario: { zh: '需求带明确验收标准', en: 'The requirement carries decidable criteria' }, expected: { zh: '得到等级与验证类别', en: 'A level and verification class are returned' }, command: '`aicg route . --text "<requirement>"`' },
      { scenario: { zh: '单元边界可判定', en: 'Unit boundaries are decidable' }, expected: { zh: '每个单元有验收标准与验证命令', en: 'Every unit has criteria and a verification command' }, command: '`aicg work-unit plan . --work-unit <relative-json>`' },
      { scenario: { zh: '单元结构合法', en: 'Unit structure is valid' }, expected: { zh: '计划预览通过且无结构错误', en: 'The plan preview passes with no structural error' }, command: '`aicg check .`' },
    ],
    boundary: {
      zh: '拆分的语义正确性由人和后续测试证据确认；工具只校验结构与命令可信度。',
      en: 'The semantic correctness of the split is confirmed by people and later test evidence; the tool only validates structure and command trust.',
    },
    sources: ['docs/ai/task-routing-policy.json', 'docs/ai/lifecycle.md', 'docs/ai/delivery-loop.json'],
  },
  {
    id: 'delivery-assignment',
    phase: 'assignment',
    title: { zh: '交付：角色分配', en: 'Delivery: role assignment' },
    description: {
      zh: '在 delivery-loop 处于 assignment 阶段时使用；把工作单元分配给已审批角色，并冻结并行单元的写入范围。',
      en: 'Use when the delivery loop is in the assignment phase; map units to approved roles and freeze the write scope of parallel units.',
    },
    use: [
      { zh: '存在两个以上可独立推进的工作单元。', en: 'Two or more units can progress independently.' },
      { zh: '改动涉及多个专业面（前端、后端、数据、测试）。', en: 'The change touches several disciplines (frontend, backend, data, tests).' },
    ],
    notUse: [
      { zh: '只有一个单元且范围很小——不要为了并行而并行。', en: 'A single small unit: do not parallelize for its own sake.' },
      { zh: '不要按角色名自动创建 Skill 或提升权限。', en: 'Never create Skills or elevate permissions from a role name.' },
    ],
    invariants: [
      { zh: '角色只能取自 `docs/ai/agent-team.json` 的已审批名单。', en: 'Roles come only from the approved roster in `docs/ai/agent-team.json`.' },
      { zh: '每个文件在同一时刻只有一个写入者。', en: 'Every file has exactly one writer at a time.' },
      { zh: '并行单元之间不得共享可写文件；共享契约先冻结。', en: 'Parallel units never share writable files; shared contracts are frozen first.' },
      { zh: '子 agent 的回执必须带回命令、退出码和输出摘要。', en: 'Each sub-agent receipt must carry the command, exit code, and output summary.' },
    ],
    steps: [
      { zh: '读 roster 与单元的 `roles.recommendations`，为每个单元选定一个 owner。', en: 'Read the roster and each unit\'s `roles.recommendations`, then select one owner per unit.' },
      { zh: '检查单元之间的写入范围是否重叠；重叠则串行化或先冻结契约。', en: 'Check whether unit write scopes overlap; if they do, serialize or freeze the contract first.' },
      { zh: '为每个单元派发一个子 agent，并在派发里写明工作单元路径、写入范围和验证命令。', en: 'Dispatch one sub-agent per unit, naming the work unit path, write scope, and verification command.' },
      { zh: '子 agent 完成后回收回执；先核对写入范围没有越界，再更新单元的 `status`。', en: 'Collect receipts as sub-agents finish; verify the write scope was respected before updating the unit `status`.' },
      { zh: '所有单元进入 `implementing` 完成后，把账本 `phase` 推进到 `test-authoring`。', en: 'When every unit reaches a finished `implementing` state, advance the ledger `phase` to `test-authoring`.' },
    ],
    escalate: [
      { zh: '两个单元必须改同一文件 → 合并为一个单元或改为串行。', en: 'Two units must edit the same file: merge them or serialize.' },
      { zh: '发现无人负责的专业面 → 升级，不要用一个角色顶替另一个专业判断。', en: 'A discipline has no owner: escalate instead of letting one role stand in for another\'s judgment.' },
    ],
    matrix: [
      { scenario: { zh: '工作单元分配到已审批角色', en: 'Units map to approved roles' }, expected: { zh: '每个单元恰有一个 owner 且角色在 roster 内', en: 'Each unit has exactly one owner drawn from the roster' }, command: '`aicg team .`' },
      { scenario: { zh: '并行写入范围无重叠', en: 'Parallel write scopes do not overlap' }, expected: { zh: '无共享可写文件', en: 'No writable file is shared' }, command: '`aicg route . --text "<task>" --paths <relative-path,...>`' },
      { scenario: { zh: '回执带回证据', en: 'Receipts carry evidence' }, expected: { zh: '含写入范围、命令与退出码', en: 'The write scope, command, and exit code are present' }, command: '`aicg work-unit status . --work-unit <relative-json>`' },
    ],
    boundary: {
      zh: '工具只校验角色来自已审批名单、范围不重叠；它不启动、不监控、也不代表任何角色做出专业判断。',
      en: 'The tool only checks that roles come from the approved roster and scopes do not overlap; it never launches, monitors, or makes a professional judgement on a role\'s behalf.',
    },
    sources: ['docs/ai/agent-team.json', 'docs/ai/delivery-loop.json', 'docs/ai/lifecycle.md'],
  },
  {
    id: 'delivery-development',
    phase: 'development',
    title: { zh: '交付：开发实施', en: 'Delivery: development' },
    description: {
      zh: '在 delivery-loop 处于 development 阶段时使用；在规定写入范围内实施工作单元，自测后交回执，不越界改动。',
      en: 'Use when the delivery loop is in the development phase; implement the unit within its assigned write scope, self-check, and hand back a receipt without touching anything outside it.',
    },
    use: [
      { zh: '工作单元已分配 owner 且写入范围已冻结。', en: 'The unit has an owner and a frozen write scope.' },
      { zh: '改动需要遵守项目约定与技术标准 Skill。', en: 'The change must follow project-convention and technical-standard Skills.' },
    ],
    notUse: [
      { zh: '不要在没有验收标准时开始写代码。', en: 'Do not start writing code without acceptance criteria.' },
      { zh: '不要顺手重构授权范围之外的文件——那是另一个工作单元。', en: 'Never opportunistically refactor files outside the authorized scope; that is a different unit.' },
    ],
    invariants: [
      { zh: '只改本工作单元 `scope` 内声明的路径。', en: 'Change only the paths declared in this unit\'s `scope`.' },
      { zh: '开工前读该单元的开发文档、项目约定 Skill 与适用技术标准 Skill。', en: 'Before editing, read the unit development document, project-convention Skills, and applicable technical-standard Skills.' },
      { zh: '行为变更必须同步 Memory 归属决策。', en: 'A behaviour change must be accompanied by a Memory ownership decision.' },
      { zh: '不把未验证的推断写成结论；不确定项保留为 gap。', en: 'Never write unverified inference as conclusion; keep unknowns as gaps.' },
    ],
    steps: [
      { zh: '读取工作单元与其开发文档，确认写入范围、验收标准和验证命令。', en: 'Read the unit and its development document to confirm write scope, criteria, and verification command.' },
      { zh: '加载适用的项目约定与技术标准 Skill，只读取正文一次。', en: 'Load the applicable project-convention and technical-standard Skills once, reading each body once only.' },
      { zh: '在范围内实施改动，并同步更新受影响的开发文档。', en: 'Implement the change within scope and update the affected development documentation.' },
      { zh: '先跑该单元的验证命令自测，把命令、退出码与输出摘要写进回执。', en: 'Run the unit\'s verification command as a self-check and put the command, exit code, and output summary in the receipt.' },
      { zh: '更新单元 `status` 并把回执写入账本，`phase` 推进到 `test-authoring`。', en: 'Update the unit `status`, write the receipt into the ledger, and advance `phase` to `test-authoring`.' },
    ],
    escalate: [
      { zh: '改动必须超出授权范围 → 停下，回到 `decomposition` 调整单元边界。', en: 'The change must exceed the authorized scope: stop and return to `decomposition` to adjust unit boundaries.' },
      { zh: '发现架构级改动 → 升级，走架构决策记录，不要自行决定。', en: 'An architecture-level change is required: escalate through an architecture decision record instead of deciding alone.' },
      { zh: '验证命令不存在或不在白名单内 → 升级，不要临时发明验证方式。', en: 'The verification command is missing or not allowlisted: escalate instead of inventing a verification method.' },
    ],
    matrix: [
      { scenario: { zh: '改动落在授权范围内', en: 'Changes stay within the authorized scope' }, expected: { zh: '无范围外文件被修改', en: 'No out-of-scope file is modified' }, command: '`aicg work-unit status . --work-unit <relative-json>`' },
      { scenario: { zh: '单元自测已执行', en: 'The unit self-check has run' }, expected: { zh: '回执含命令、退出码与输出摘要', en: 'The receipt carries the command, exit code, and output summary' }, command: '`aicg check .`' },
      { scenario: { zh: '行为已变更', en: 'Behaviour changed' }, expected: { zh: 'Memory 归属决策已同步', en: 'The Memory ownership decision is synchronized' }, command: '`aicg check .`' },
    ],
    boundary: {
      zh: '工具校验范围、结构与证据形状，不判断实现质量，也不代表任何专业角色签署结论。',
      en: 'The tool validates scope, structure, and evidence shape; it never judges implementation quality or signs off on a professional role\'s behalf.',
    },
    sources: ['docs/ai/delivery-loop.json', 'docs/ai/project-conventions.json', 'docs/ai/technical-standards.json'],
  },
  {
    id: 'delivery-test-authoring',
    phase: 'test-authoring',
    title: { zh: '交付：测试用例编写', en: 'Delivery: test case authoring' },
    description: {
      zh: '在 delivery-loop 处于 test-authoring 阶段时使用；为每个工作单元编写可执行的测试用例，并声明它的 driver。',
      en: 'Use when the delivery loop is in the test-authoring phase; write executable test cases per unit and declare each one\'s driver.',
    },
    use: [
      { zh: '工作单元已实现，需要可复核的用例集。', en: 'Units are implemented and need a reviewable case set.' },
      { zh: '需要覆盖正向、负向和边界行为。', en: 'Positive, negative, and boundary behaviour must be covered.' },
    ],
    notUse: [
      { zh: '不要只写正向用例——负向用例是缺陷的主要来源。', en: 'Do not write positive cases only; negative cases are where defects surface.' },
      { zh: '不要用「手工看一眼」代替可执行步骤。', en: 'Never replace executable steps with "eyeball it manually".' },
    ],
    invariants: [
      { zh: '每个必需用例必须有前置、步骤、最终断言和清理。', en: 'Every required case needs preconditions, steps, a final assertion, and cleanup.' },
      { zh: '每个用例声明 `automation.kind`（agent/command/manual）与 driver。', en: 'Every case declares `automation.kind` (agent/command/manual) and a driver.' },
      { zh: '用例步骤必须可由浏览器、接口、终端或数据驱动真正执行。', en: 'Case steps must be genuinely executable by a browser, API, terminal, or data driver.' },
      { zh: '数据用例必须自己创建并清理数据，不依赖遗留状态。', en: 'Data cases create and clean up their own data and never depend on leftover state.' },
    ],
    steps: [
      { zh: '为每个工作单元列出验收标准，逐一映射成至少一个必需用例。', en: 'List each unit\'s acceptance criteria and map every one to at least one required case.' },
      { zh: '为每条验收标准补一个负向或边界用例。', en: 'Add one negative or boundary case for every criterion.' },
      { zh: '写明前置、步骤、断言、清理，并选定 driver。', en: 'Write preconditions, steps, assertions, cleanup, and pick the driver.' },
      { zh: '运行 `aicg test-case init` 生成清单，再运行 `validate` 校验结构。', en: 'Run `aicg test-case init` to produce the manifest, then `validate` to check structure.' },
      { zh: '把清单路径写入账本，`phase` 推进到 `local-test`。', en: 'Write the manifest path into the ledger and advance `phase` to `local-test`.' },
    ],
    escalate: [
      { zh: '验收标准写不成可执行断言 → 回到 `decomposition` 重写标准。', en: 'A criterion cannot become an executable assertion: return to `decomposition` and rewrite it.' },
      { zh: '某个用例只能用人工判断 → 显式标记 `manual` 并说明为什么无法自动化。', en: 'A case can only be judged by a person: mark it `manual` explicitly and say why it cannot be automated.' },
    ],
    matrix: [
      { scenario: { zh: '每条验收标准有用例覆盖', en: 'Every acceptance criterion has case coverage' }, expected: { zh: '必需用例数与验收标准数匹配', en: 'Required case count matches the criterion count' }, command: '`aicg test-case init . --yes`' },
      { scenario: { zh: '每条标准有负向或边界用例', en: 'Every criterion has a negative or boundary case' }, expected: { zh: '负向用例存在且标记 `required`', en: 'A negative case exists and is marked `required`' }, command: '`aicg test-case validate .`' },
      { scenario: { zh: '按范围取出执行包', en: 'Select the execution packet by scope' }, expected: { zh: '执行包只含当前范围的用例', en: 'The packet contains only the current scope\'s cases' }, command: '`aicg test-case select . --scope <id>`' },
    ],
    boundary: {
      zh: '工具校验清单结构与覆盖映射，不判断断言语义是否正确，也不执行用例。',
      en: 'The tool validates manifest structure and the coverage mapping; it neither judges assertion semantics nor executes cases.',
    },
    sources: ['docs/ai/delivery-loop.json', 'docs/ai/development/index.json', 'docs/ai/skills/standards/professional-testing/SKILL.md'],
  },
  {
    id: 'delivery-local-test',
    phase: 'local-test',
    title: { zh: '交付：本地自测', en: 'Delivery: local self-test' },
    description: {
      zh: '在 delivery-loop 处于 local-test 阶段时使用；在本机装依赖、跑代码、驱动浏览器并操作数据，把证据写回账本。',
      en: 'Use when the delivery loop is in the local-test phase; install dependencies, run the code, drive the browser, operate on data, and write the evidence back to the ledger.',
    },
    use: [
      { zh: '需要在本机真实运行被测代码。', en: 'The code under test must genuinely run on the local machine.' },
      { zh: '需要浏览器、接口或数据层面的行为证据。', en: 'Browser, API, or data-level behaviour evidence is required.' },
    ],
    notUse: [
      { zh: '不要在没有可回滚环境时执行破坏性数据操作。', en: 'Never run destructive data operations without a rollback path.' },
      { zh: '不要用「命令返回 0」代替用例断言——退出码不等于行为正确。', en: 'Never substitute a zero exit code for a case assertion; exit status is not behavioural correctness.' },
    ],
    invariants: [
      { zh: '先装依赖再跑测试；依赖安装失败要如实记录，不要绕过。', en: 'Install dependencies before running tests; record install failures honestly instead of working around them.' },
      { zh: '每个用例的执行证据至少含命令、退出码、输出摘要、时间戳。', en: 'Each run\'s evidence carries at least the command, exit code, output summary, and timestamp.' },
      { zh: '浏览器与数据操作只允许在本地或专用测试环境进行。', en: 'Browser and data operations happen only on local or dedicated test environments.' },
      { zh: '执行结果只记 `PASS`/`FAIL`/`BLOCKED`/`NOT_RUN`，不写「大概可以」。', en: 'Record only `PASS`/`FAIL`/`BLOCKED`/`NOT_RUN`; never write "probably works".' },
    ],
    steps: [
      { zh: '按仓库既有锁文件安装依赖；无锁文件则记录这一事实。', en: 'Install dependencies using the repository\'s lockfile; if none exists, record that fact.' },
      { zh: '用 `aicg test-case select` 取出当前范围的执行包。', en: 'Use `aicg test-case select` to obtain the execution packet for the current scope.' },
      { zh: '逐条执行用例：命令驱动的跑命令，浏览器/数据驱动的走对应 driver。', en: 'Execute cases one by one: command-driven cases run commands, browser/data-driven cases use their driver.' },
      { zh: '把每条结果与证据通过 `aicg test-case record` 写回账本。', en: 'Write each result and its evidence back through `aicg test-case record`.' },
      { zh: '把运行记录写入账本 `runs`，`phase` 推进到 `report`。', en: 'Write the run records into the ledger `runs` and advance `phase` to `report`.' },
    ],
    escalate: [
      { zh: '环境缺依赖或权限导致无法执行 → 记 `BLOCKED` 并升级，不要伪造证据。', en: 'A missing dependency or permission blocks execution: record `BLOCKED` and escalate; never fabricate evidence.' },
      { zh: '用例步骤在当前环境不可实现 → 记 `BLOCKED` 并说明需要什么环境。', en: 'A case step is impossible in the current environment: record `BLOCKED` and state what environment it needs.' },
      { zh: '需要真实生产数据才能验证 → 停止，改用脱敏样本或升级。', en: 'Verification would need real production data: stop, switch to a de-identified sample, or escalate.' },
    ],
    matrix: [
      { scenario: { zh: '依赖已安装', en: 'Dependencies are installed' }, expected: { zh: '安装命令与结果已记录', en: 'The install command and result are recorded' }, command: '`aicg test-case select . --scope <id>`' },
      { scenario: { zh: '每条用例有执行结果', en: 'Every case has an execution result' }, expected: { zh: '状态取值合法且证据非空', en: 'Status values are valid and evidence is non-empty' }, command: '`aicg test-case record . --results <relative-json>`' },
      { scenario: { zh: '证据可复核', en: 'Evidence is reviewable' }, expected: { zh: '命令、退出码、输出摘要、时间戳齐备', en: 'Command, exit code, output summary, and timestamp are all present' }, command: '`aicg check .`' },
    ],
    boundary: {
      zh: '本地记录不等于认证。工具不重放这些操作，只校验证据结构；完整证据仍为 unverified，仅表示可用于人工复核。',
      en: 'A local record is not certification. The tool never replays these operations and only validates evidence shape; complete evidence stays unverified and merely becomes eligible for human review.',
    },
    sources: ['docs/ai/delivery-loop.json', 'docs/ai/acceptance-contract.json', 'docs/ai/verification-profiles.yaml'],
  },
  {
    id: 'delivery-report',
    phase: 'report',
    title: { zh: '交付：产出可复核报告', en: 'Delivery: emit the reviewable report' },
    description: {
      zh: '在交付闭环处于 report 阶段时使用；把本机自测的结果、证据引用与未解决项汇总成一份负责人可复核的报告，再进入修复重测。',
      en: 'Use when the delivery loop is in the report phase; summarize local self-test results, evidence references, and unresolved items into an owner-reviewable report before entering the fix loop.',
    },
    use: [
      { zh: '本机自测已完成，账本 `runs` 非空，需要一份可复核的结论。', en: 'Local self-testing is done, ledger `runs` is non-empty, and a reviewable conclusion is needed.' },
      { zh: '进入修复重测之前，需要先固定「哪些通过、哪些失败、哪些没跑」这一事实。', en: 'Before the fix loop, the fact set of what passed, failed, and never ran must be frozen.' },
    ],
    notUse: [
      { zh: '不要用报告替代证据本身——报告只汇总引用，不产生新事实。', en: 'Never let the report replace the evidence itself: it aggregates references and creates no new fact.' },
      { zh: '账本没有任何运行记录时不要出报告，不要写「大概通过」。', en: 'Do not emit a report with an empty ledger and never write "probably passes".' },
      { zh: '不要为了让报告好看而把 `FAIL`/`BLOCKED` 改写成通过。', en: 'Never rewrite `FAIL`/`BLOCKED` as passing to make the report look better.' },
    ],
    invariants: [
      { zh: '报告只引用账本中已记录的证据，不新增任何未经执行的事实。', en: 'The report cites only evidence already recorded in the ledger and adds no unexecuted fact.' },
      { zh: '每条结论必须能追到具体的 evidence 引用（命令、退出码、输出摘要、时间戳）。', en: 'Every conclusion traces to a specific evidence reference: command, exit code, output summary, and timestamp.' },
      { zh: '`FAIL`、`BLOCKED`、`NOT_RUN` 必须如实计入并分列，不得与通过项混在一起。', en: '`FAIL`, `BLOCKED`, and `NOT_RUN` are counted truthfully and listed separately from passing items.' },
      { zh: '未解决项写入 `residualRisk` 并在报告中单列，不得隐藏。', en: 'Unresolved items go into `residualRisk` and appear as their own section; nothing is hidden.' },
    ],
    steps: [
      { zh: '从账本收集 `runs`、`openFindings`、`residualRisk`，确认报告范围。', en: 'Collect `runs`, `openFindings`, and `residualRisk` from the ledger and confirm the report scope.' },
      { zh: '按 `PASS`/`FAIL`/`BLOCKED`/`NOT_RUN` 分类汇总，逐条给出证据引用。', en: 'Group results by `PASS`/`FAIL`/`BLOCKED`/`NOT_RUN` and give an evidence reference per entry.' },
      { zh: '把报告写入 `reports/testing/`，不与账本证据内容冲突。', en: 'Write the report into `reports/testing/` without contradicting the recorded ledger evidence.' },
      { zh: '把报告路径记入账本，`phase` 推进到 `fix-loop`。', en: 'Record the report path in the ledger and advance `phase` to `fix-loop`.' },
    ],
    escalate: [
      { zh: '存在 `FAIL`/`BLOCKED` 却要求直接收敛 → 拒绝，并把未解决项升级给负责人。', en: 'Convergence is demanded while `FAIL`/`BLOCKED` exist: refuse and escalate the unresolved items to the owner.' },
      { zh: '证据缺失导致结论无法复核 → 记 `BLOCKED`，不要用推断补齐证据。', en: 'Missing evidence makes a conclusion unreviewable: record `BLOCKED` and never fill the gap with inference.' },
      { zh: '报告与账本不一致 → 以账本为准，并把这处不一致记入 `openFindings`。', en: 'The report and the ledger disagree: the ledger wins, and the disagreement is recorded in `openFindings`.' },
    ],
    matrix: [
      { scenario: { zh: '自测已产生运行记录', en: 'Self-test produced run records' }, expected: { zh: '账本 `runs` 非空且状态取值合法', en: 'Ledger `runs` is non-empty with valid status values' }, command: '`aicg test-case select . --scope <id>`' },
      { scenario: { zh: '每条结论可追溯', en: 'Every conclusion is traceable' }, expected: { zh: '结论均对应到非空证据引用', en: 'Each conclusion maps to a non-empty evidence reference' }, command: '`aicg check .`' },
      { scenario: { zh: '报告已入账', en: 'The report is recorded' }, expected: { zh: '报告路径已写入账本且 `phase` 为 `fix-loop`', en: 'The report path is in the ledger and `phase` is `fix-loop`' }, command: '`aicg complete . --work-unit <relative-json>`' },
    ],
    boundary: {
      zh: '报告是账本记录的汇总，不是认证。工具不重放执行、不判断修复质量，只校验报告引用的证据结构与账本一致；报告本身保持 unverified，仅表示可用于人工复核。',
      en: 'The report aggregates ledger records; it is not certification. The tool never replays execution or judges fix quality, and only validates that the evidence a report cites matches the ledger; the report stays unverified and merely becomes eligible for human review.',
    },
    sources: ['docs/ai/delivery-loop.json', 'docs/ai/acceptance-results.json', 'docs/ai/acceptance-contract.json'],
  },
  {
    id: 'delivery-fix-loop',
    phase: 'fix-loop',
    title: { zh: '交付：修复与重测直到收敛', en: 'Delivery: fix and retest until convergence' },
    description: {
      zh: '在 delivery-loop 处于 fix-loop 阶段时使用；对失败分类、修复、重测，直到收敛或触及迭代上限后升级。',
      en: 'Use when the delivery loop is in the fix-loop phase; classify failures, fix, retest, and either converge or escalate at the iteration ceiling.',
    },
    use: [
      { zh: '本地自测产生了 `FAIL` 或 `BLOCKED`。', en: 'Local self-test produced `FAIL` or `BLOCKED`.' },
      { zh: '修复之后必须重新跑同一批用例确认没有回归。', en: 'After a fix the same case set must be rerun to confirm no regression.' },
    ],
    notUse: [
      { zh: '不要为了让用例通过而修改用例断言——先判定是产品缺陷还是用例缺陷。', en: 'Never edit an assertion just to make a case pass; first decide whether the product or the case is wrong.' },
      { zh: '不要在未收敛时宣布完成。', en: 'Never declare completion before convergence.' },
    ],
    invariants: [
      { zh: '每个失败必须先分类：产品缺陷、用例缺陷、环境缺陷。', en: 'Every failure is classified first: product defect, case defect, or environment defect.' },
      { zh: '修复后必须重跑同一批用例，不只跑修的那条。', en: 'After a fix, rerun the whole case set, not only the repaired case.' },
      { zh: '迭代次数受账本 `iterations.budget` 约束，不得自行放宽。', en: 'Iterations are bounded by the ledger `iterations.budget`; never widen it yourself.' },
      { zh: '无法在本次交付内解决的问题进 `residualRisk`，不隐藏。', en: 'Anything unsolvable within this delivery goes into `residualRisk`; nothing is hidden.' },
    ],
    steps: [
      { zh: '逐条读失败结果，分类为产品、用例或环境缺陷。', en: 'Read each failure and classify it as a product, case, or environment defect.' },
      { zh: '用例缺陷改用例；环境缺陷改环境或记 `BLOCKED`；产品缺陷才改代码。', en: 'Fix case defects in the case, environment defects in the environment or as `BLOCKED`, and only then change code for product defects.' },
      { zh: '修复后重跑同一批用例，把新一轮结果追加进账本 `runs`。', en: 'Rerun the same case set after fixing and append the new run to the ledger `runs`.' },
      { zh: '`iterations.used` 加一；仍有失败则回到上一步。', en: 'Increment `iterations.used`; if failures remain, return to the previous step.' },
      { zh: '全部用例通过或剩余项已进入 `residualRisk` 后，产出结果报告并把 `phase` 置为 `converged`。', en: 'When all cases pass or the remainder is in `residualRisk`, produce the result report and set `phase` to `converged`.' },
      { zh: '运行 `aicg check` 与 `aicg complete` 收口，记录仍未验证的边界。', en: 'Run `aicg check` and `aicg complete` to close out, recording the boundaries that stay unverified.' },
    ],
    escalate: [
      { zh: '`iterations.used` 达到预算 → 停止，输出未解决项清单并升级。', en: '`iterations.used` reaches the budget: stop, list the unresolved items, and escalate.' },
      { zh: '同一条负向用例连续失败三次 → 停止自动修复，请人判断。', en: 'One negative case fails three times consecutively: stop auto-fixing and ask a person.' },
      { zh: '修复需要扩大需求范围 → 停下，回到 `decomposition` 重新确认。', en: 'The fix would expand the requirement: stop and return to `decomposition` to reconfirm.' },
    ],
    matrix: [
      { scenario: { zh: '失败已分类', en: 'Every failure is classified' }, expected: { zh: '每条 `FAIL` 都有合法分类', en: 'Each `FAIL` carries a valid classification' }, command: '`aicg test-case record . --results <relative-json>`' },
      { scenario: { zh: '修复后无回归', en: 'No regression after the fix' }, expected: { zh: '新一轮重跑覆盖全部原有用例', en: 'The new run covers every original case' }, command: '`aicg check .`' },
      { scenario: { zh: '收敛可判定', en: 'Convergence is decidable' }, expected: { zh: '`phase` 为 `converged` 且未解决项已登记', en: '`phase` is `converged` and every unresolved item is registered' }, command: '`aicg complete . --work-unit <relative-json>`' },
    ],
    boundary: {
      zh: '收敛判据基于记录的用例结果，不基于感觉。工具不判断修复质量，也不重放失败现场。',
      en: 'Convergence is judged from recorded case results, not from impression. The tool neither judges fix quality nor replays a failure scene.',
    },
    sources: ['docs/ai/delivery-loop.json', 'docs/ai/acceptance-results.json', 'docs/ai/skills/standards/professional-testing/SKILL.md'],
  },
];

function pick(value, zh) {
  return zh ? value.zh : value.en;
}

// A phase named by the ledger with no Skill behind it would strand the agent at that step,
// and a Skill whose phase is not in the ledger would never be reached. Fail loudly at load.
const coveredPhases = PHASE_SKILLS.map((skill) => skill.phase);
if (coveredPhases.length !== DELIVERY_PHASES.length || DELIVERY_PHASES.some((phase) => !coveredPhases.includes(phase))) {
  throw new Error(`Delivery loop phases and phase Skills have drifted: ledger names ${DELIVERY_PHASES.join(', ')} but Skills cover ${coveredPhases.join(', ')}.`);
}

function bullets(items, zh) {
  return items.map((item) => `- ${pick(item, zh)}`).join('\n');
}

function numbered(items, zh) {
  return items.map((item, index) => `${index + 1}. ${pick(item, zh)}`).join('\n');
}

/**
 * One row per phase, and nothing else. This table is the whole progressive-disclosure
 * mechanism: it is the only reason the entry can stay small while the phase Skills carry the
 * detail. Omitting a phase here would make that Skill unreachable, so it is generated from
 * the same list the ledger uses rather than written by hand.
 */
function dispatchTable(zh, dispatch) {
  const rows = DELIVERY_PHASES.map((phase) => {
    const skill = PHASE_SKILLS.find((candidate) => candidate.phase === phase);
    return `| \`${phase}\` | \`${skill.id}\` — ${pick(dispatch[phase], zh)} |`;
  });
  return [`| ${zh ? '阶段' : 'Phase'} | ${zh ? '加载' : 'Load'} |`, '| --- | --- |', ...rows].join('\n');
}

/**
 * One renderer for every Skill in the loop. The section order and the three-column matrix
 * are what the Skill quality contract checks, so rendering them here keeps every phase Skill
 * compliant without restating the contract.
 */
function renderSkillBody(config, skill) {
  const zh = config.artifactLanguage === 'zh-CN';
  const matrix = [
    `| ${zh ? '场景' : 'Scenario'} | ${zh ? '期望结果' : 'Expected result'} | ${zh ? '命令' : 'Command'} |`,
    '| --- | --- | --- |',
    ...skill.matrix.map((row) => `| ${pick(row.scenario, zh)} | ${pick(row.expected, zh)} | ${row.command} |`),
  ].join('\n');
  return `---
name: ${skill.id}
description: ${pick(skill.description, zh)}
---

# ${pick(skill.title, zh)}

<!-- ${GENERATED_MARKER} -->

## When to use

${bullets(skill.use, zh)}

## When not to use

${bullets(skill.notUse, zh)}

## Required invariants

${bullets(skill.invariants, zh)}

## Decision flow

${numbered(skill.steps, zh)}
${skill.dispatch ? `\n## Phase dispatch\n\n${dispatchTable(zh, skill.dispatch)}\n` : ''}
## Exceptions and escalation

${bullets(skill.escalate, zh)}

## Verification matrix

${matrix}

## Project evidence boundary

${pick(skill.boundary, zh)}

## Sources

${skill.sources.map((source) => `- \`${source}\``).join('\n')}
`;
}

/**
 * The ledger the loop writes its state into. It is a `seed`: the tool writes the empty
 * baseline once and never overwrites runtime progress, because a regenerated ledger would
 * erase the very evidence the loop exists to keep.
 */
export function deliveryLoopLedger(config) {
  const zh = config.artifactLanguage === 'zh-CN';
  return stableJson({
    schemaVersion: 1,
    phase: 'decomposition',
    phases: DELIVERY_PHASES,
    requirement: { text: '', taskLevel: null, acceptanceCriteria: [] },
    units: [],
    iterations: { budget: 5, used: 0 },
    runs: [],
    openFindings: [],
    residualRisk: [],
    boundary: zh
      ? '本文件是交付循环的运行时状态。工具只写入空基线，之后由执行方维护；账本记录声明与证据引用，不等于执行或认证。'
      : 'Runtime state of the delivery loop. The tool writes only the empty baseline; the executing side owns it afterwards. It records declarations and evidence references, not execution or certification.',
  });
}

export function buildDeliveryLoopArtifacts(config) {
  const artifacts = [{
    path: DELIVERY_LOOP_LEDGER,
    content: deliveryLoopLedger(config),
    ownership: 'seed',
    kind: 'delivery-loop-ledger',
    source: 'template:delivery-loop-ledger',
  }, {
    path: DELIVERY_LOOP_SKILL,
    content: renderSkillBody(config, ENTRY),
    ownership: 'full',
    kind: DELIVERY_LOOP_ENTRY_KIND,
    source: 'template:delivery-loop',
  }];
  for (const skill of PHASE_SKILLS) {
    artifacts.push({
      path: `docs/ai/skills/${skill.id}/SKILL.md`,
      content: renderSkillBody(config, skill),
      ownership: 'full',
      kind: DELIVERY_LOOP_PHASE_KIND,
      source: 'template:delivery-loop',
    });
  }
  return { artifacts };
}

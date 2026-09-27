/**
 * Project delivery roles are agent definitions, not process Skills.
 *
 * Each emitted \`docs/ai/agents/<role>.md\` is a small prompt that says who does a step, what
 * they receive, what proves the work, and what they must not decide alone. Three properties are
 * deliberate:
 *
 * 1. Only the roles a project actually needs are emitted (surface-filtered), with a conservative
 *    fallback: a greenfield or unknown repository keeps the whole vocabulary.
 * 2. Each role carries project context (stacks, development units, surface and test examples) so
 *    its capabilities describe this repository instead of a generic template.
 * 3. The document is generated in the configured artifact language.
 *
 * Owner-approved project roles from the adaptive team are emitted next to the base roles. An
 * unapproved proposal never becomes a loadable role; it stays in the team roster ledger.
 */
const NL = String.fromCharCode(10);
const t = (zh, en) => ({ zh, en });
const pick = (value, zh) => (zh ? value.zh : value.en);
const bullets = (items, zh) => items.map((item) => '- ' + pick(item, zh)).join(NL);
const numbered = (items, zh) => items.map((item, index) => (index + 1) + '. ' + pick(item, zh)).join(NL);

const SECTIONS = {
  when: t('何时使用', 'When to use'),
  inputs: t('输入', 'Inputs'),
  steps: t('步骤', 'Steps'),
  never: t('禁止', 'Do not'),
  out: t('输出', 'Output'),
  evidence: t('必需证据', 'Required evidence'),
  escalation: t('升级条件', 'Escalation'),
  gate: t('完成门禁', 'Completion gate'),
  context: t('项目上下文', 'Project context'),
};
const INTRO = t('这是一个 AI 交付角色。它通过 \`docs/WORKFLOW.md\` 的流程参与，永不替代负责人或专业人员的决定。',
  'This is an AI delivery role. It participates through the workflow in \`docs/WORKFLOW.md\` and never replaces an owner or specialist decision.');

// surface: coordination (always), frontend, backend, both.
const ROLES = [
  {
    id: 'pm', surface: 'coordination',
    description: t('交付 PM。按需求组织团队、拆分与分配任务，推动流程收敛。', 'Delivery PM. Organises the team from the requirement, runs task decomposition and assignment, and drives the flow to convergence.'),
    when: [t('需求需要团队、plan 交接、任务拆分或测试分配时。', 'A requirement needs a team, a plan hand-off, task decomposition, or a test assignment.')],
    inputs: [t('已确认的需求及其验收标准', 'The confirmed requirement and its acceptance criteria'), t('docs/WORKFLOW.md 与当前流程/交付状态', 'docs/WORKFLOW.md and the current flow/delivery state')],
    steps: [t('按需求内容组织或新增角色', 'Organise or add roles from the requirement content'), t('指派架构师做 PK，并把问题汇总给负责人', 'Assign architects to PK and collect the questions for the owner'), t('把已批准的 plan 拆成完整能力，绝不把一个大需求丢给一个团队', 'Decompose the approved plan into complete capabilities, never one large requirement to one team'), t('指派专业测试或真实用户测试并收集报告', 'Assign professional testing or real-user testing and collect the report'), t('非业务问题自动派修；业务问题留给负责人确认', 'Route non-business fixes automatically and park business issues for owner confirmation')],
    never: [t('不替负责人决定业务含义', 'Do not decide business meaning on the owner behalf'), t('不批准负责人未确认的 plan', 'Do not approve a plan the owner has not confirmed')],
    out: t('团队分配、拆分清单、分阶段交接、最终报告指针。', 'Team assignment, decomposition list, staged hand-offs, and the final report pointer.'),
    runbook: {
      evidence: [t('流程账本中绑定的需求文档路径与摘要', 'The requirement document path and digest bound in the flow ledger'), t('已批准的开发 plan 及其 planHash', 'The approved development plan and its planHash'), t('每团队一个完整能力的拆分清单', 'The decomposition list with one complete capability per team'), t('流程账本中绑定的最终测试报告路径', 'The final test report path bound in the flow ledger')],
      escalation: [t('出现业务问题：记入 blockedOnOwner，绝不自行决定', 'A business question arrives: record it in blockedOnOwner and never decide it alone'), t('需求无法拆成完整能力', 'A requirement cannot be split into complete capabilities'), t('一个团队要同时承担一个以上完整能力', 'One team would have to own more than one complete capability')],
      gate: t('L2/L3 的 aicg complete 需要已批准的需求与 plan、绑定的测试报告，以及覆盖改动行为的工作单元。', 'aicg complete requires an approved requirement and plan for L2/L3, a bound test report, and one work unit covering the changed behaviour.'),
    },
  },
  {
    id: 'ba', surface: 'coordination',
    description: t('业务分析师。把一句话或完整需求变成结构化、可判定的需求文档。', 'Business analyst. Turns a one-line or complete requirement into a structured requirement document with decidable acceptance criteria.'),
    when: [t('需求没有文档、没有验收标准，或还有未决问题。', 'A requirement has no document, no acceptance criteria, or unresolved questions.')],
    inputs: [t('原始需求', 'The raw requirement'), t('相关代码与 Memory 页', 'Relevant code and memory pages')],
    steps: [t('把需求重述为完整需求', 'Restate the requirement as a complete one'), t('列出可由证据判定的验收标准', 'List acceptance criteria that evidence can decide'), t('保留未决问题，并给出推荐答案与来源', 'Keep open questions with a recommended answer and its source'), t('答案一旦改变范围或业务含义，必须问负责人', 'Ask the owner whenever an answer changes scope or business meaning')],
    never: [t('不写无法用证据判定的验收标准', 'Do not write acceptance criteria that cannot be decided by evidence'), t('不从代码结构推断业务规则', 'Do not invent business rules from code structure')],
    out: t('含 summary、acceptanceCriteria、openQuestions 的需求文档。', 'A requirement document with summary, acceptanceCriteria and openQuestions.'),
    runbook: {
      evidence: [t('含 summary、acceptanceCriteria、openQuestions 的需求文档', 'A requirement document with summary, acceptanceCriteria and openQuestions'), t('每个未决问题都有推荐答案与证据来源', 'Every open question with a recommended answer and its evidence source')],
      escalation: [t('问题会改变范围、业务含义或外部契约', 'A question changes scope, business meaning or an external contract'), t('验收标准无法由仓库证据判定', 'Acceptance criteria cannot be decided by repository evidence')],
      gate: t('plan 工作开始前，需求文档必须存在且摘要与流程账本一致。', 'The requirement document must exist and its digest must match the flow ledger before plan work starts.'),
    },
  },
  {
    id: 'architect', surface: 'coordination',
    description: t('架构师。针对真实代码做同行 PK，产出可实施的开发 plan。', 'Architect. Runs the peer PK against the actual code and produces an implementable development plan.'),
    when: [t('需求与设计已确认、plan 到期时。', 'The requirement and design are confirmed and a plan is due.')],
    inputs: [t('需求文档', 'The requirement document'), t('当前代码与测试', 'The current code and tests'), t('相关规则与 Memory 页', 'The relevant rules and memory pages')],
    steps: [t('先独立写一版 plan 草案', 'Draft the plan alone first'), t('与至少一个同行方案和一个裁判做 PK', 'PK with at least one peer proposal and a referee'), t('对照真实代码检查遗漏、不确定与未闭环逻辑', 'Check omissions, uncertainties and unclosed logic against real code'), t('把问题连同推荐答案交回负责人', 'Return questions with recommended answers for the owner'), t('把 plan 摘要绑定进 planHash', 'Bind the plan summary into planHash')],
    never: [t('不跳过独立草案直接 PK', 'Do not skip the solo draft and go straight to PK'), t('不悄悄扩大需求范围', 'Do not silently widen scope beyond the requirement')],
    out: t('开发 plan，以及 PK 问题与推荐答案。', 'A development plan plus the PK questions and recommended answers.'),
    runbook: {
      evidence: [t('PK 之前写下的独立 plan 草案', 'A solo plan draft written before the PK'), t('至少一个同行方案与裁判记录，摘要互不相同', 'At least one peer proposal and a referee record with distinct digests'), t('遗漏、不确定与未闭环逻辑清单及推荐答案', 'An omission, uncertainty and unclosed-logic list with recommended answers'), t('绑定进 planHash 的 plan 摘要', 'The plan summary bound into planHash')],
      escalation: [t('需求与代码对某个不变式不一致', 'The requirement and the code disagree about an invariant'), t('边界改动会影响多个模块或外部契约', 'A boundary change would affect multiple modules or an external contract')],
      gate: t('aicg complete 会重算 plan 哈希；需求、路径或范围变化都会使批准失效。', 'aicg complete recomputes the plan hash; any requirement, path or scope change invalidates the approval.'),
    },
  },
  {
    id: 'frontend', surface: 'frontend',
    description: t('前端工程师。在既有设计系统与 API 契约内实现已确认的界面与客户端行为。', 'Frontend engineer. Implements confirmed UI and client behavior inside the existing design system and API contracts.'),
    when: [t('已确认需求改动了页面、组件或客户端状态。', 'A confirmed requirement changes pages, components or client state.')],
    inputs: [t('plan 与所属 Memory 页', 'The plan and the owning memory pages'), t('相邻实现与测试', 'Neighboring implementation and tests')],
    steps: [t('复用最近的既有组件、状态与 API 模块', 'Reuse the nearest existing component, state and API modules'), t('分离传输、状态与展示职责', 'Keep transport, state and presentation responsibilities separate'), t('构建界面前先读取流程账本中的设计决定', 'Load the page design decision from the flow state before building UI'), t('运行目标验证并记录结果', 'Run the target verification and record the result')],
    never: [t('不发明文档契约之外的 API 形状', 'Do not invent API shapes outside the documented contract'), t('不把预览草稿当成已批准的生产设计', 'Do not treat a preview draft as approved production design')],
    out: t('实现与聚焦的验证证据。', 'Implementation plus focused verification evidence.'),
    runbook: {
      evidence: [t('已记录的设计决定：default 或所选草稿', 'The recorded page design decision: default or the chosen draft'), t('改动的组件、状态与 API 路径', 'The changed component, state and API paths'), t('改动表面的验证结果', 'A verification result for the changed surface')],
      escalation: [t('API 契约缺失或有歧义', 'The API contract is missing or ambiguous'), t('设计系统里没有匹配的模式', 'The design system has no matching pattern')],
      gate: t('L2/L3 交付要更新所属 Memory 页并绑定验证结果。', 'L2/L3 delivery updates the owning memory page and binds a verification result.'),
    },
  },
  {
    id: 'backend', surface: 'backend',
    description: t('后端工程师。按仓库分层与契约约定实现已确认的服务端行为。', 'Backend engineer. Implements confirmed server behavior with the repository layering and contract conventions.'),
    when: [t('已确认需求改动了服务、API、数据访问或后台任务。', 'A confirmed requirement changes services, APIs, data access or background work.')],
    inputs: [t('plan 与所属 Memory 页', 'The plan and the owning memory pages'), t('相邻实现与测试', 'Neighboring implementation and tests')],
    steps: [t('复用最近的服务、仓储与 schema 模式', 'Reuse the nearest service, repository and schema patterns'), t('显式处理校验、授权、错误与副作用', 'Keep validation, authorization, errors and side effects explicit'), t('同一次改动内更新所属 Memory 页', 'Update the owning memory page in the same change'), t('运行目标验证并记录结果', 'Run the target verification and record the result')],
    never: [t('不绕过分层直接访问数据', 'Do not bypass the repository layer for data access'), t('不记录就不改外部契约', 'Do not change an external contract without recording it')],
    out: t('实现与聚焦的验证证据。', 'Implementation plus focused verification evidence.'),
    runbook: {
      evidence: [t('改动的服务、API、数据访问与迁移路径', 'The changed service, API, data-access and migration paths'), t('已记录的校验、授权、错误与副作用决定', 'Validation, authorization, error and side-effect decisions recorded'), t('已更新的所属 Memory 页', 'The updated owning memory page'), t('改动行为的验证结果', 'A verification result for the changed behaviour')],
      escalation: [t('schema 或迁移改动触及生产数据', 'A schema or migration change touches production data'), t('外部契约发生变化', 'An external contract changes')],
      gate: t('L2/L3 交付需要含 Memory 覆盖与逐例结果的工作单元。', 'L2/L3 delivery requires a work unit with canonical memory coverage and per-case results.'),
    },
  },
  {
    id: 'fullstack', surface: 'both',
    description: t('全栈工程师。当一个负责人比交接更清晰时，交付跨界面、API 与数据的纵向能力。', 'Full-stack engineer. Delivers one vertical capability across UI, API and data when one owner is clearer than a hand-off.'),
    when: [t('一个小纵向能力同时跨客户端与服务端，且一个负责人更清晰。', 'A small vertical capability spans client and server and one owner is clearer.')],
    inputs: [t('plan 与两侧所属 Memory 页', 'The plan and both owning memory pages')],
    steps: [t('保持界面、API 与数据同属一个纵向工作单元', 'Keep one vertical work unit across UI, API and data'), t('一次确认契约，两侧都按它实现', 'Confirm the contract once and implement both sides against it'), t('同一次改动内更新两侧 Memory 页', 'Update both owning memory pages in the same change')],
    never: [t('不把一个纵向能力拆成互不相干的端点任务', 'Do not split one vertical capability into disconnected endpoint tasks')],
    out: t('可运行的纵向切片与验证证据。', 'A working vertical slice plus verification evidence.'),
    runbook: {
      evidence: [t('跨界面、API 与数据的一个纵向工作单元', 'One vertical work unit across UI, API and data'), t('两侧 Memory 页均已更新', 'Both owning memory pages updated'), t('整个切片的验证结果', 'A verification result for the whole slice')],
      escalation: [t('纵向切片超出单个完整能力', 'The vertical slice grows beyond one complete capability'), t('客户端与服务端契约无法一次达成一致', 'The client and server contracts cannot be agreed once')],
      gate: t('一个工作单元、两侧 Memory 页、一次验证运行。', 'One work unit, both memory pages, and one verification run.'),
    },
  },
  {
    id: 'designer', surface: 'frontend',
    description: t('产品设计师。产出页面设计决定：沿用既有设计系统的默认方案，或三版粗略预览稿。', 'Product designer. Produces the page design decision: default from the existing design system, or three rough preview drafts.'),
    when: [t('需求涉及页面，且负责人需要在设计方向间选择。', 'A requirement involves a page and the owner must choose a design direction.')],
    inputs: [t('需求与既有设计系统', 'The requirement and the existing design system')],
    steps: [t('负责人选默认时，按既有设计系统设计并记录 design.status=default', 'If the owner chooses default, design from the existing system and record design.status=default'), t('负责人选三版时，产出三版粗略预览稿并记录所选', 'If the owner chooses three designs, produce three rough preview drafts and record the chosen one'), t('预览草稿绝不进入生产构建', 'Keep preview drafts out of the production build')],
    never: [t('不把预览草稿当成已确认设计', 'Do not treat a preview draft as a confirmed design'), t('不重设计无关表面', 'Do not redesign an unrelated surface')],
    out: t('已记录的设计决定，以及可选的预览草稿。', 'A recorded design decision, with optional preview drafts.'),
    runbook: {
      evidence: [t('已记录的设计决定；选择三版时含三份预览稿', 'The recorded design decision and, when chosen, the three preview drafts'), t('预览草稿不进入生产构建的说明', 'A note that preview drafts never enter the production build')],
      escalation: [t('负责人尚未在默认与三版之间选择', 'The owner has not chosen between default and three designs'), t('涉及页面但项目没有设计系统', 'A page is involved but no design system exists')],
      gate: t('流程账本记录 design.status；未记录会阻断 L3 页面工作。', 'The flow ledger records design.status; an unrecorded design blocks L3 page work.'),
    },
  },
  {
    id: 'tester', surface: 'coordination',
    description: t('测试。执行专业或真实用户功能测试，并报告通过、失败与从未执行。', 'Tester. Runs professional or real-user functional testing and reports what passed, failed, or was never run.'),
    when: [t('实现完成、需要功能测试报告时。', 'Implementation is complete and a functional test report is due.')],
    inputs: [t('需求的验收标准', 'The requirement acceptance criteria'), t('已实现的改动及其验证命令', 'The implemented change and its verification commands')],
    steps: [t('覆盖适用的成功路径、边界、失败与风险用例', 'Cover the happy path, boundaries, failures and risk cases that apply'), t('自动化、AI 模拟真人与真实用户结果分开记录', 'Keep automated, AI-simulated-human and real-user results separate'), t('未执行记 NOT_RUN，失败记 FAIL', 'Mark unrun cases NOT_RUN and failures FAIL'), t('每个 PASS/FAIL 都附真实证据文件', 'Attach the real evidence file for every PASS or FAIL')],
    never: [t('不把未执行用例报成通过', 'Do not report an unrun case as passing'), t('不把真实用户结果与自动化结果混在一起', 'Do not merge real-user results with automated results')],
    out: t('含逐例证据的功能测试报告。', 'A functional test report with per-case evidence.'),
    runbook: {
      evidence: [t('流程账本中绑定且摘要匹配的测试报告路径', 'A test report path bound in the flow ledger with a matching digest'), t('逐例 PASS/FAIL 且附真实证据文件', 'Per-case PASS/FAIL with a real evidence file'), t('未执行用例标记为 NOT_RUN', 'Unexecuted cases marked NOT_RUN')],
      escalation: [t('失败属于业务决定而非缺陷', 'A failure is a business decision rather than a defect'), t('需要真实用户测试但没有明确授权', 'Real-user testing would be required without explicit authorization')],
      gate: t('L2/L3 完成需要绑定的报告；自动化、模拟真人与真实用户证据保持分离。', 'L2/L3 completion requires the bound report; automated, simulated-human and real-user evidence stay separate.'),
    },
  },
];

const FRONTEND_STACK = /^frontend-|^platform-(?:hybrid-mobile|desktop|android|ios)$/;
const BACKEND_STACK = /^backend-/;
const FRONTEND_FILE = /\.(?:tsx|jsx|vue|svelte|css|scss|less|html)$/i;
const BACKEND_FILE = /\.(?:java|go|rb|php|py|cs)$/i;
const TEST_FILE = /(?:^|\/)(?:test|tests|spec|specs)\//;
// Directory names that describe a layer rather than a business capability. They never become a
// development unit in the role context or a candidate project role.
const GENERIC_DIRS = new Set(['src', 'lib', 'app', 'apps', 'test', 'tests', 'spec', 'specs', 'api', 'components', 'component', 'ui', 'views', 'pages', 'utils', 'util', 'shared', 'common', 'core', 'config', 'configs', 'hooks', 'store', 'stores', 'state', 'assets', 'styles', 'style', 'public', 'dist', 'build', 'target', 'out', 'node_modules', 'scripts', 'docs', 'doc', 'modules', 'module', 'services', 'service', 'controllers', 'controller', 'models', 'model', 'routes', 'route', 'infra', 'infrastructure', 'db', 'database', 'migrations', 'types', 'typings', 'middleware', 'constants', 'helpers', 'internal', 'pkg', 'cmd', 'server', 'client', 'web', 'backend', 'frontend', 'mobile', 'desktop', 'platform', 'graphql', 'rest', 'grpc', 'e2e', 'integration', 'unit']);
const ROOTS = new Set(['src', 'apps', 'app', 'packages', 'lib', 'services']);
const SERVER_HINT = /(?:^|\/)(?:service|services|repository|repositories|controller|controllers|handler|handlers|model|models|route|routes|middleware|usecase|usecases|entity|entities)(?:\/|\.|$)/i;

// The development unit is the first non-generic directory below a source root, so
// src/modules/billing and src/billing both name a business unit while src/api and
// src/components stay layers and never become one.
function developmentUnit(relative) {
  const parts = relative.split('/');
  if (parts.length < 3 || !ROOTS.has(parts[0])) return null;
  const index = parts.slice(1, -1).findIndex((part) => !GENERIC_DIRS.has(part));
  if (index < 0) return null;
  return parts.slice(0, index + 2).join('/');
}

function stackIds(config, scan) {
  if (Array.isArray(config?.stacks) && config.stacks.length) return config.stacks;
  return (scan?.stacks ?? []).map((stack) => stack.id);
}

/** Surface classification with a conservative fallback: never leave a project roleless. */
export function detectProjectSurfaces(config, scan) {
  const stacks = stackIds(config, scan);
  const frontend = stacks.some((id) => FRONTEND_STACK.test(id));
  const backend = stacks.some((id) => BACKEND_STACK.test(id));
  const greenfield = config?.initialization?.lifecycle === 'greenfield';
  return { frontend, backend, known: frontend || backend, fallback: greenfield || !(frontend || backend) };
}

export function projectRoleContext(config, scan) {
  const files = (scan?.files ?? []).filter((file) => file.type === 'file' && typeof file.relative === 'string');
  const counts = new Map();
  for (const file of files) {
    const unit = developmentUnit(file.relative);
    if (!unit) continue;
    counts.set(unit, (counts.get(unit) ?? 0) + 1);
  }
  const modules = [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 5)
    .map(([dir, count]) => ({ dir, count }));
  const sample = (regex) => files.filter((file) => regex.test(file.relative)).map((file) => file.relative).slice(0, 3);
  return {
    projectName: config?.projectName ?? scan?.projectName ?? null,
    stacks: stackIds(config, scan),
    modules,
    frontendSample: sample(FRONTEND_FILE),
    backendSample: sample(new RegExp(SERVER_HINT.source + '|' + BACKEND_FILE.source, 'i')),
    testSample: files.filter((file) => TEST_FILE.test(file.relative) || /\.(?:test|spec)\./.test(file.relative)).map((file) => file.relative).slice(0, 3),
  };
}

export function selectAgentRoles(config, scan) {
  const surfaces = detectProjectSurfaces(config, scan);
  return ROLES.filter((role) => {
    if (role.surface === 'coordination') return true;
    if (surfaces.fallback) return true;
    if (role.surface === 'frontend') return surfaces.frontend;
    if (role.surface === 'backend') return surfaces.backend;
    if (role.surface === 'both') return surfaces.frontend && surfaces.backend;
    return true;
  });
}

function contextLines(role, context, zh) {
  if (!context) return [];
  const lines = [];
  if (context.projectName) lines.push('- ' + (zh ? '项目' : 'Project') + ': \`' + context.projectName + '\`');
  if (context.stacks.length) lines.push('- ' + (zh ? '检测到的技术栈' : 'Detected stacks') + ': ' + context.stacks.map((id) => '\`' + id + '\`').join(', '));
  if (role.surface !== 'frontend' && context.modules.length) {
    for (const entry of context.modules) lines.push('- ' + (zh ? '开发单元' : 'Development unit') + ': \`' + entry.dir + '\` (' + entry.count + (zh ? ' 个文件' : ' files') + ')');
  }
  const samples = role.surface === 'frontend' ? context.frontendSample
    : role.surface === 'backend' ? context.backendSample
      : role.surface === 'both' ? [...context.frontendSample, ...context.backendSample]
        : [...context.modules.map((entry) => entry.dir), ...context.testSample];
  if (samples.length) lines.push('- ' + (zh ? '本项目具体表面' : 'Concrete surfaces in this project') + ': ' + samples.map((item) => '\`' + item + '\`').join(', '));
  return lines;
}

function renderRole(role, { zh, context }) {
  const runbook = role.runbook;
  const contextSection = contextLines(role, context, zh);
  return [
    '---', 'name: ' + role.id, 'description: ' + pick(role.description, zh), '---', '',
    '# ' + role.id, '',
    pick(INTRO, zh), '',
    '## ' + pick(SECTIONS.when, zh), '', bullets(role.when, zh), '',
    '## ' + pick(SECTIONS.inputs, zh), '', bullets(role.inputs, zh), '',
    '## ' + pick(SECTIONS.steps, zh), '', numbered(role.steps, zh), '',
    '## ' + pick(SECTIONS.never, zh), '', bullets(role.never, zh), '',
    '## ' + pick(SECTIONS.out, zh), '', pick(role.out, zh), '',
    ...(contextSection.length ? ['## ' + pick(SECTIONS.context, zh), '', contextSection.join(NL), ''] : []),
    '## ' + pick(SECTIONS.evidence, zh), '', bullets(runbook.evidence, zh), '',
    '## ' + pick(SECTIONS.escalation, zh), '', bullets(runbook.escalation, zh), '',
    '## ' + pick(SECTIONS.gate, zh), '', pick(runbook.gate, zh), '',
  ].join(NL);
}

/**
 * Only an owner-approved adaptive-team role becomes a loadable role document. A recommendation
 * stays in the team roster ledger, so "proposed" never silently means "assigned".
 */
export function approvedProjectRoles(config) {
  const team = config?.agentTeam;
  if (!team || team.enabled !== true || !Array.isArray(team.roleProposals)) return [];
  return team.roleProposals.filter((role) => role && typeof role.id === 'string' && role.status === 'approved-available');
}

/**
 * Evidence-bound business-role proposals. AICG still never invents business rules: a proposal is
 * emitted only when a real development unit is corroborated by an independent signal (a test, a
 * document, or the project name). It is marked unconfirmed and never counts as an assigned role.
 */
export function proposedProjectRoles(config, scan, context) {
  if (config?.initialization?.lifecycle !== 'existing') return [];
  if (approvedProjectRoles(config).length > 0) return [];
  const files = (scan?.files ?? []).filter((file) => file.type === 'file' && typeof file.relative === 'string');
  const paths = files.map((file) => file.relative);
  const lowered = paths.map((relative) => relative.toLowerCase());
  const project = (context?.projectName ?? '').toLowerCase();
  const units = new Map();
  for (const relative of paths) {
    const unit = developmentUnit(relative);
    if (!unit) continue;
    if (!units.has(unit)) units.set(unit, []);
    units.get(unit).push(relative);
  }
  const proposals = [];
  for (const [unit, members] of [...units.entries()].sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))) {
    const name = unit.split('/').pop().toLowerCase();
    if (name.length < 3) continue;
    // A test or a document must corroborate the unit. The project name alone is too weak: a
    // fixture called "...-new-code-..." would otherwise turn a one-file unit into a "domain".
    const testMatches = lowered.filter((relative) => (TEST_FILE.test(relative) || /\.(?:test|spec)\./.test(relative)) && relative.includes(name));
    const docMatches = lowered.filter((relative) => /\.(?:md|mdx)$/.test(relative) && relative.includes(name));
    if (testMatches.length === 0 && docMatches.length === 0) continue;
    const evidence = [];
    if (testMatches.length) evidence.push('test coverage names ' + name + ': ' + testMatches.join(', '));
    if (docMatches.length) evidence.push('documentation names ' + name + ': ' + docMatches.join(', '));
    if (project.includes(name)) evidence.push((context?.projectName ? 'project name ' + context.projectName : 'project name') + ' matches ' + name);
    proposals.push({ id: name + '-domain-specialist', domain: name, unit, evidence, paths: members.slice(0, 4) });
    if (proposals.length >= 2) break;
  }
  return proposals;
}

function renderProposedRole(proposal, { zh, context }) {
  return [
    '---', 'name: ' + proposal.id,
    'description: ' + (zh ? proposal.domain + ' 业务域的候选角色（尚未确认）。' : 'Proposed business role for the ' + proposal.domain + ' domain (unconfirmed).'),
    '---', '',
    '# ' + proposal.id, '',
    zh ? '> 候选角色，尚未获得负责人确认。它只能协助提问与梳理术语，不得据此做出业务或专业结论。' : '> Proposed role, not confirmed by the owner. It may only help question and map terminology; it must not produce business or professional conclusions.', '',
    '## ' + pick(SECTIONS.context, zh), '',
    '- ' + (zh ? '项目' : 'Project') + ': \`' + (context?.projectName ?? '') + '\`',
    '- ' + (zh ? '业务域' : 'Domain') + ': \`' + proposal.domain + '\`',
    '- ' + (zh ? '开发单元' : 'Development unit') + ': \`' + proposal.unit + '\`',
    ...proposal.paths.map((relative) => '- ' + (zh ? '证据路径' : 'Evidence path') + ': \`' + relative + '\`'),
    ...proposal.evidence.map((entry) => '- ' + entry),
    '',
    '## ' + pick(SECTIONS.when, zh), '',
    '- ' + (zh ? '任务涉及该业务域的术语、规则或边界时，协助 BA 澄清并列出待负责人确认的问题。' : 'When a task touches this domain terminology, rules or boundaries, help the BA clarify and list questions for the owner.'),
    '',
    '## ' + pick(SECTIONS.never, zh), '',
    '- ' + (zh ? '不给出专业结论、不代替负责人确认、不对外承诺。' : 'No professional conclusion, no owner decision, no outward commitment.'),
    '',
    '## ' + pick(SECTIONS.gate, zh), '',
    zh ? '只有负责人在自适应团队里明确采纳后，才生成已批准角色文件；未采纳前本文件保持候选。' : 'Only an explicit owner adoption in the adaptive team turns this into an approved role document; until then it stays a proposal.',
    '',
  ].join(NL);
}

function renderProjectRole(role, { zh, context }) {
  const responsibilities = (role.responsibilities ?? []).map((item) => '- ' + item);
  const capabilities = (role.capabilities ?? []).map((item) => '- ' + (zh ? '能力：' : 'Capability: ') + '\`' + item + '\`');
  const outOfScope = (role.outOfScope ?? []).map((item) => '- ' + item);
  return [
    '---', 'name: ' + role.id,
    'description: ' + (zh ? (role.title + '：负责人已批准的项目专属角色。') : (role.title + ': owner-approved project role.')),
    '---', '',
    '# ' + role.id, '',
    zh ? '这是负责人已批准的项目专属角色，提供业务判断辅助；专业结论仍由合格真人负责。' : 'This is an owner-approved project role that assists business judgement; a qualified human still owns any professional conclusion.', '',
    '## ' + pick(SECTIONS.context, zh), '',
    '- ' + (zh ? '项目' : 'Project') + ': \`' + (context?.projectName ?? '') + '\`',
    ...(role.domainNeedIds ?? []).map((id) => '- ' + (zh ? '业务域' : 'Domain') + ': \`' + id + '\`'),
    '',
    '## ' + pick(SECTIONS.when, zh), '',
    '- ' + (zh ? '任务命中该角色的业务域或能力时参与评审与提问。' : 'Join review and questioning when a task hits this role domain or capabilities.'),
    '',
    '## ' + pick(SECTIONS.evidence, zh), '',
    ...responsibilities, ...capabilities,
    '',
    '## ' + pick(SECTIONS.never, zh), '',
    ...(outOfScope.length ? outOfScope : ['- ' + (zh ? '不给出专业结论或对外承诺。' : 'No professional conclusion or outward commitment.')]),
    '',
    '## ' + pick(SECTIONS.gate, zh), '',
    zh ? '专业判断必须由合格真人复核；本文件不代表授权或签名。' : 'Professional judgement requires qualified-human review; this file is not authority or a signature.',
    '',
  ].join(NL);
}

export function buildAgentArtifacts(config, scan) {
  const zh = config?.artifactLanguage === 'zh-CN';
  const context = projectRoleContext(config, scan);
  const artifacts = selectAgentRoles(config, scan).map((role) => ({
    path: 'docs/ai/agents/' + role.id + '.md',
    content: renderRole(role, { zh, context }),
    ownership: 'seed',
    kind: 'project-agent-role',
    source: 'template:project-agents',
  }));
  const taken = new Set(artifacts.map((artifact) => artifact.path));
  for (const role of approvedProjectRoles(config)) {
    const relative = 'docs/ai/agents/' + role.id + '.md';
    if (taken.has(relative)) continue;
    taken.add(relative);
    artifacts.push({ path: relative, content: renderProjectRole(role, { zh, context }), ownership: 'seed', kind: 'project-agent-role', source: 'approved-project-team' });
  }
  for (const proposal of proposedProjectRoles(config, scan, context)) {
    const relative = 'docs/ai/agents/' + proposal.id + '.md';
    if (taken.has(relative)) continue;
    taken.add(relative);
    artifacts.push({ path: relative, content: renderProposedRole(proposal, { zh, context }), ownership: 'seed', kind: 'project-agent-role-candidate', source: 'proposed-from-project-evidence' });
  }
  return { artifacts };
}

/**
 * The project delivery workflow is one human-readable document, not a family of phase Skills.
 *
 * Task evidence selects requirement analysis, page design, technical decisions, planning,
 * development, testing and repair. The sections are capabilities rather than a fixed sequence.
 * file so an agent can read the whole path once instead of loading a Skill per phase. Runtime
 * progress lives in the machine state under `.ai-governance/state/`; the document never stores it.
 */
import { readBoundedRepositoryFile } from '../../adapters/filesystem/repository-state.mjs';
import { PACKAGE_ROOT } from '../../constants.mjs';
import { isSafeRelative, normalizeRelative, sha256 } from '../../shared/index.mjs';

export const WORKFLOW_DOC = 'docs/WORKFLOW.md';
export const WORKFLOW_KIND = 'project-workflow';

const NL = String.fromCharCode(10);

function zh() {
  return [
    '# 项目交付治理工作流',
    '',
    '> 本文件是本项目唯一的交付流程文档。先运行动态路由，只加载本次需要的能力；以下章节不是必经流水线。',
    '',
    '先使用 `aicg route . --text "任务"` 查看条件能力。L0 无产物；L1 定向验证；L1.5 复现、根因与回归；L2 默认 BA、plan 和模块用例；页面增加产品设计；L3 或新项目增加技术设计。执行方使用 `aicg delivery prepare . --text "任务" --scope MODULE --yes` 创建缺失草稿，然后依据证据补全。',
    '不默认创建 worktree、提交、并发 Agent 或逐任务双评审；TDD 和评审深度按改动风险选择。已有 OpenSpec/原生规格、计划和设计只引用唯一权威。',
    '',
    '草稿补全后，用相同 text、scope 和 paths 执行 `aicg delivery assess` 只读检查占位符、重复正文、关键章节和用例引用。结构就绪不代表业务正确、测试已执行或负责人已验收。',
    '',
    '## 角色模型',
    '',
    '- 所有角色按需求内容动态组织与添加，不预先固定团队。',
    '- 基础角色：PM、BA、架构师、前端、后端、全栈、设计、测试。',
    '- 每个基础角色在 `docs/ai/agents/<角色>.md` 有一份运行手册；按角色读取其中的必需证据、升级条件与完成门禁。',
    '- 专业性强的需求（例如合同、法律、财务、安全）必须引入对应专业人员（例如律师），与 BA 一起分析需求；业务问题由专业人员给出建议。',
    '- 角色参与不构成专业结论或签署；对外受监管的最终结论仍需具备资质的真人确认。',
    '',
    '## 流程',
    '',
    '### 1. 需求分析',
    '',
    '按需求内容组织或添加角色到团队，然后分两种情况：',
    '',
    '- **业务行为需求**：默认产出轻量 BA，包含目标、角色、现状/目标流程、业务规则、范围、验收标准和待确认事项；老项目只补本次增量。',
    '- **完整需求**：分析需求内容并逐项检查需求细节。',
    '',
    '只询问会改变范围、业务、权限或重大成本的问题；已确认信息直接引用，常规实现细节由执行方处理。未确认问题保留在 `openQuestions`。',
    '',
    '### 2. 页面设计（可选）',
    '',
    '- 需求不涉及前端页面：跳过本步骤。',
    '- 需要前端页面设计：先查已有设计规范、Storybook、主题 token、组件和截图。规范存在时直接继承并引用，冲突请求负责人决定。',
    '  - 新项目：建立设计原则、导航、字体/颜色/间距、组件、响应式和无障碍规范，并提供关键流程的样式图或 HTML 预览。',
    '  - 老项目缺规范：从实际页面和代码提取现状基线，标明证据与缺口；不借整理规范自动重设计。仅需要比较视觉方向时给出多个方案。',
    '- 预览稿只是提案，不进入生产构建。',
    '',
    '### 3. 架构师 PK 与开发 plan',
    '',
    'PM 按任务风险选择架构评审深度。L3、新项目或新增架构决定需要技术设计，覆盖模块、接口、数据、工程规范、兼容与回滚。常规 L2 沿用已有设计。',
    '架构文档与开发规范共用分析入口。老项目根据源码与现有权威设计整理系统总览图、模块架构图、核心业务流程图和证据引用；新项目先根据用户需求形成这三类图、开发规范及实施计划。Markdown/Mermaid 是默认来源，时序、数据和部署视图按需增加。',
    '新项目必须将具体方案交由客户确认，确认前只做分析与方案文档，不创建应用骨架、不安装依赖、不改产品或构建部署配置、不写实现代码。结构就绪仍是 awaiting-customer-confirmation；客户确认后通过现有 approval-evidence 与 approve 绑定当前方案继续，同版本同范围不重复询问，重大变更重新确认。批准记录为 operator-declared，不证明真人身份或交付验收。',
    '',
    '- 只把会改变需求、方案或任务划分的问题交给负责人；常规细节在计划中记录决定。',
    '- 保证需求与设计最终处于可实施状态，并产出开发 plan。',
    '- plan 明确模块与文件职责、依赖顺序、验证命令和完成条件；引用既有正式计划。plan 摘要绑定进 `planHash`；plan 变更使旧批准失效。',
    '',
    '### 4. 任务拆分与开发',
    '',
    'PM 根据开发 plan 拆分任务并按规模组织团队分配：',
    '',
    '- 颗粒度不要过细；每个团队都要完成完整功能。',
    '- 允许团队之间有依赖关系并据此安排先后开发。',
    '- 不得把一个很大的需求直接分给一个团队。',
    '- 完成后进入测试；行为变更同步所属记忆页。',
    '',
    '### 5. 测试',
    '',
    '开发前按模块维护稳定 Case ID，并引用 BA requirement/scenario。公共角色、环境、数据通过 schema-v2 `imports: [{path, sha256}]` 复用；选取用例后共享文件变化必须重选。覆盖成功、失败、边界、异常、权限和相关风险。',
    'PM 分配专业测试或真实用户进行功能测试，给出最终测试报告。',
    '',
    '- 自动化、AI 模拟真人与真实用户的结果必须分开记录。',
    '- 未执行的用例记 `NOT_RUN`，未通过的记 `FAIL`；不得把未跑过的用例写成通过。',
    '',
    '### 6. 修复',
    '',
    '- 不需要用户确认的**非业务问题**：自动安排团队修复并重测。',
    '- **业务问题**：置为等待负责人确认，确认后再修复；不得自行拍板。',
    '',
    '## 任务分级',
    '',
    '等级由 `aicg route` 依据改动、范围、风险和清晰度给出，不靠人工感觉：',
    '',
    '- `L0` 只读解释、评审、状态：不建立流程状态。',
    '- `L1` 本地低风险或非生产改动：定位、修改、定向验证。',
    '- `L2` 产品行为、业务契约或多模块：需求与 plan 获批后实施、验证。',
    '- `L3` 多面、架构、迁移、外部动作或高后果：需求、设计、plan 全部获批后集成实施与验证。',
    '',
    '## 状态与证据',
    '',
    '- 项目流程状态：`.ai-governance/state/flow-state.json`；交付循环状态：`.ai-governance/state/delivery-loop.json`。工具只写空基线，之后由执行方维护。',
    '- 分级与门禁：`.ai-governance/state/task-routing-policy.json` 与 `aicg route`。',
    '- 账本记录的是声明与证据引用，不等于执行或认证。',
    '',
    '## 完成定义',
    '',
    '- 需求、设计与 plan 的未决问题都已获得用户确认。',
    '- 开发完成并运行任务所需的仓库验证命令，保存测试结果报告。',
    '- 行为变更同步所属记忆页；未确认的内容保持 `unverified` 或 gap。',
    '- 交付前运行一次 `aicg complete`。',
    '',
  ].join(NL);
}

function en() {
  return [
    '# Project Delivery Workflow',
    '',
    '> This is the only delivery workflow document. Route the task first and load only selected capabilities; the sections below are not a mandatory pipeline.',
    '',
    'Use `aicg route . --text "task"` to inspect conditional capabilities. L0 creates no artifacts; L1 uses targeted verification; L1.5 uses reproduction, root cause and regression; L2 defaults to BA, plan and module cases; UI adds product design; L3 or greenfield adds technical design. Use `aicg delivery prepare . --text "task" --scope MODULE --yes` to create missing drafts, then complete them from evidence.',
    'Worktrees, commits, concurrent Agents and per-task double reviews are not defaults. Choose TDD and review depth from risk. Reference the single existing OpenSpec/native specification, plan and design authority.',
    '',
    'After completing drafts, run `aicg delivery assess` with the same text, scope and paths to inspect placeholders, duplicate bodies, key sections and case references. Structural readiness does not prove business accuracy, executed tests or owner acceptance.',
    '',
    '## Role model',
    '',
    '- Every role is organised and added from the requirement content; no team is fixed in advance.',
    '- Base roles: PM, BA, architect, frontend, backend, full-stack, design, test.',
    '- Each base role has a short runbook under `docs/ai/agents/<role>.md`; read the matching one for required evidence, escalation and the completion gate.',
    '- A specialised requirement (contracts, legal, finance, security) must add the matching specialist (for example a lawyer) to analyse the requirement with the BA; the specialist advises on business questions.',
    '- Role participation is not a professional conclusion or a signature; a regulated outward conclusion still needs a qualified human.',
    '',
    '## Flow',
    '',
    '### 1. Requirement analysis',
    '',
    'Organise or add roles to the team from the requirement content, then branch:',
    '',
    '- **Business behavior**: default to a lean BA covering outcome, actors, current/target flow, rules, scope, acceptance and owner questions. Existing projects document only the change delta.',
    '- **Complete requirement**: analyse the content and check the requirement details item by item.',
    '',
    'Ask only material scope, business, authority or cost questions; reuse confirmed information and settle routine implementation details. Keep unresolved decisions in `openQuestions`.',
    '',
    '### 2. Page design (optional)',
    '',
    '- The requirement has no frontend page: skip this step.',
    '- For frontend design, inspect existing guidelines, Storybook, tokens, components and screenshots; inherit existing specifications by reference and expose conflicts.',
    '  - Greenfield: establish navigation, color/type/spacing tokens, components, responsive and accessibility rules; supply a key-flow wireframe or HTML preview.',
    '  - Existing project without specifications: extract an evidence-backed current baseline with gaps. Design modernization needs its own decision. Produce multiple options only when the visual direction needs comparison.',
    '- A preview draft is a proposal and never enters the production build.',
    '',
    '### 3. Architect PK and development plan',
    '',
    'The PM selects architecture review depth from task risk. L3, greenfield and new architecture decisions need technical design covering modules, interfaces, data, programming conventions, compatibility and rollback. Routine L2 work inherits existing design.',
    'Architecture documentation and development standards share analysis. Existing projects use source and authoritative designs for system overview, module architecture and core business flow diagrams with evidence references. New projects derive these views, conventions and an implementation plan from user requirements. Markdown/Mermaid is the default source; add sequence, data and deployment views only when justified.',
    'New projects present the concrete design for customer confirmation before application scaffolds, dependency installation, product/build/deployment configuration or implementation code. Structural readiness remains awaiting-customer-confirmation. Reuse existing approval-evidence and approve bindings to continue the current design; do not repeat approval for the same revision and scope, and reconfirm material changes. Records are operator-declared, not authenticated human identity or product acceptance.',
    '',
    '- Bring only decisions that change requirements, approach or task boundaries to the owner; record routine decisions in the plan.',
    '- Ensure the requirement and design are implementable, and produce the development plan.',
    '- State module/file responsibilities, dependencies, commands and completion criteria in the single authoritative plan. Bind its summary into `planHash`; a plan change invalidates prior approval.',
    '',
    '### 4. Task decomposition and development',
    '',
    'The PM decomposes the plan and organises teams by task size:',
    '',
    '- Keep granularity coarse; each team must deliver a complete capability.',
    '- Teams may depend on each other and be sequenced accordingly.',
    '- Never hand one very large requirement to a single team.',
    '- After development, move to testing; synchronise the owning memory page for behaviour changes.',
    '',
    '### 5. Testing',
    '',
    'Before implementation, maintain stable module Case IDs with BA requirement/scenario references. Reuse actors, environments and data through schema-v2 `imports: [{path, sha256}]`. Shared-context changes require fresh case selection. Cover success, failure, boundary, abnormal, permission and applicable risk cases.',
    'The PM assigns professional testers or real users to run functional testing and produces the final test report.',
    '',
    '- Record automated, AI-simulated-human and real-user results separately.',
    '- Record unrun cases as `NOT_RUN` and failures as `FAIL`; never report an unrun case as passing.',
    '',
    '### 6. Repair',
    '',
    '- **Non-business issues** that need no user confirmation: assign a team automatically, fix and retest.',
    '- **Business issues**: wait for owner confirmation before repairing; never decide unilaterally.',
    '',
    '## Task levels',
    '',
    'The level comes from `aicg route` based on mutation, scope, risk and clarity, not intuition:',
    '',
    '- `L0` read-only explanation, review or status: no flow state.',
    '- `L1` low-risk local or non-production change: locate, edit, targeted verification.',
    '- `L2` product behaviour, business contract or multi-module: implement and verify after requirement and plan approval.',
    '- `L3` multi-surface, architecture, migration, external action or high consequence: implement and verify after requirement, design and plan approval.',
    '',
    '## State and evidence',
    '',
    '- Project flow state: `.ai-governance/state/flow-state.json`; delivery loop state: `.ai-governance/state/delivery-loop.json`. The tool writes only the empty baseline; the executing side owns it afterwards.',
    '- Levels and gates: `.ai-governance/state/task-routing-policy.json` and `aicg route`.',
    '- A ledger records declarations and evidence references, not execution or certification.',
    '',
    '## Definition of done',
    '',
    '- Every open requirement, design and plan question has owner confirmation.',
    '- Development is complete, the repository verification commands the task needs were run, and a test report is saved.',
    '- Behaviour changes synchronised the owning memory page; unconfirmed content stays `unverified` or a gap.',
    '- Run `aicg complete` once before delivery.',
    '',
  ].join(NL);
}

export function workflowDocument(config) {
  return config?.artifactLanguage === 'zh-CN' ? zh() : en();
}

export function validateWorkflowPreservation(config) {
  const binding = config.workflowPreservation;
  if (binding === undefined) return;
  if (!binding || typeof binding !== 'object' || Array.isArray(binding)
    || Object.keys(binding).some(key => !['contentSha256', 'approvalPath', 'approvalSha256'].includes(key))
    || !/^[a-f0-9]{64}$/.test(binding.contentSha256 ?? '')
    || !/^[a-f0-9]{64}$/.test(binding.approvalSha256 ?? '')
    || typeof binding.approvalPath !== 'string' || !isSafeRelative(binding.approvalPath)
    || normalizeRelative(binding.approvalPath) !== binding.approvalPath) {
    throw new Error('Invalid workflow preservation binding.');
  }
}

function containsTemplate(content, template) {
  const lines = content.split('\n');
  let position = 0;
  for (const line of template.split('\n')) {
    const found = lines.indexOf(line, position);
    if (found < 0) return false;
    position = found + 1;
  }
  return true;
}

function preservedWorkflow(config, root) {
  validateWorkflowPreservation(config);
  const binding = config.workflowPreservation;
  if (!root) throw new Error('Workflow preservation requires a repository root.');
  const approvalBytes = readBoundedRepositoryFile(root, binding.approvalPath, 64 * 1024).bytes;
  if (sha256(approvalBytes) !== binding.approvalSha256) throw new Error('Workflow approval digest mismatch.');
  const receipt = JSON.parse(approvalBytes.toString('utf8'));
  if (receipt.kind !== 'workflow-content-preservation' || receipt.status !== 'APPROVED'
    || receipt.source !== 'owner-message' || receipt.path !== WORKFLOW_DOC || receipt.sha256 !== binding.contentSha256) {
    throw new Error('Workflow approval does not bind the preserved content.');
  }
  const bytes = readBoundedRepositoryFile(root, WORKFLOW_DOC).bytes;
  if (sha256(bytes) !== binding.contentSha256) throw new Error('Workflow content digest mismatch.');
  const content = bytes.toString('utf8');
  const current = workflowDocument(config);
  if (containsTemplate(content, current)) return { content, status: 'current', templateVersion: 2 };
  // This immutable historical baseline is independent of future generator edits.
  // Receipt integrity remains mandatory; arbitrary removed or reordered gates fail.
  const language = config.artifactLanguage === 'zh-CN' ? 'zh-CN' : 'en';
  const baseline = readBoundedRepositoryFile(PACKAGE_ROOT, `assets/workflows/v1/${language}.md`, 64 * 1024).bytes.toString('utf8');
  if (!containsTemplate(content, baseline)) throw new Error('Workflow preservation cannot remove or reorder template rules from a supported baseline.');
  return { content, status: 'preserved-legacy', templateVersion: 1,
    pendingTemplateLines: current.split('\n').filter(line => line && !content.split('\n').includes(line)) };
}

export function buildWorkflowArtifacts(config, root = null) {
  const preserved = config.workflowPreservation ? preservedWorkflow(config, root) : null;
  return {
    compatibility: preserved ? { status: preserved.status, templateVersion: preserved.templateVersion,
      pendingTemplateLines: preserved.pendingTemplateLines ?? [] } : { status: 'current', templateVersion: 2 },
    artifacts: [{
      path: WORKFLOW_DOC,
      content: preserved ? preserved.content : workflowDocument(config),
      ownership: config.workflowPreservation ? 'seed' : 'full',
      kind: WORKFLOW_KIND,
      source: 'template:project-workflow',
    }],
  };
}

import { governanceBootstrapCommand, governanceCommand } from './compiler.mjs';
import { architectureHandoffGuidance } from './architecture-documentation.mjs';

const RESEARCH_AREAS = Object.freeze([
  'repository-structure',
  'architecture-options',
  'development-practices',
  'testing-practices',
  'security-practices',
  'operations-practices',
  'migration-and-compatibility',
  'licensing-paid-sdk-and-external-costs',
]);

function unique(values) {
  return [...new Set(values.filter((value) => typeof value === 'string' && value.trim()).map((value) => value.trim()))];
}

function selectedTechnologies(config, scan) {
  return unique([
    ...(config.stacks ?? []),
    ...(scan?.stacks ?? []).map((entry) => entry.id),
    ...(config.technologyPackages ?? []),
  ]);
}

function selectedClients(config) {
  return unique(config.clientSupport?.selectedClients ?? config.clients ?? []);
}

// These are instructions for the calling Agent, not a runtime completion receipt.
function completionGuidance(config, zh) {
  const command = governanceCommand(config);
  return zh ? [
    '交付目标：一次接收本任务后，连续完成当前版本、以实际代码为准的治理框架和已授权项目知识整理；交付实际文件，不只交计划、扫描结果、初始化骨架或一段让我再转交的提示词。当前代码没有实现的功能不得写成已有能力。',
    '复用页面已保存的选择和本次已有授权，不重复询问相同范围。能从源码、配置或测试查出的事实由你查；只有缺失的负责人决定或实际权限阻塞才询问，并继续完成不依赖该答案的工作。',
    '按下面的完成清单逐项落实：',
    '1. 核对当前工作树、构建清单、锁文件、调用方、关键实现和代表性测试，记录实际版本、开发单元和证据位置。历史知识只作线索；删除的路径和变化的行为须更新，不能直接恢复旧摘要。',
    '2. 根据真实代码完成开发单元说明、选定的系统/模块/业务流程、接口与数据契约、异常和降级分支、现有测试与运行方式；把源码事实、建议和未确认业务决定分开。没有代码的部分按需求或缺口说明，不能画成已经实现。',
    '3. 整理可复用的项目动作指南，写明适用任务、具体规则、例子、验证方法和完成条件；按需要补术语与任务到知识的索引，只加载任务命中的知识。业务 Memory 严格服从已配置开关和已有授权，候选 Skill 不自动视为已采纳。',
    `4. 编辑人工权威来源后，用 ${command} sync . --dry-run 检查创建、更新、保留和冲突，应用已授权的常规更新；核对编译正文、客户端投影、链接、具体源码引用和来源新鲜度。`,
    '5. 用项目自身问题核对知识可用性：一个功能该改哪里、哪些调用方与契约要同步、失败和空结果有何区别、会写哪些数据或访问哪些外部服务、用什么现有测试验证。每个回答都给出当前代码和知识入口，文件数量不能替代这项核对。',
    '6. 收尾再次核对本轮实际源码；期间发生变化的部分须增量更新相关知识。逐项列出交付位置、内容核对结果、实际执行结果与剩余缺口。必需内容仍是占位、断链、陈旧引用或没有项目行为说明时继续补齐；真实阻塞无法消除时明确报告未完成项。结构检查通过、知识整理、真实客户端加载和产品运行分别报告，不把绿色检查当成全部完成。',
  ] : [
    'Delivery goal: accept this task once and carry it through to current-code governance and authorized project knowledge. Deliver actual files, not only a plan, scan, initialized skeleton, or another prompt for me to relay. Never describe unimplemented behavior as an existing capability.',
    'Reuse saved page choices and existing authorization without asking again about the same scope. Look up repository facts yourself. Ask only for a missing owner decision or actual permission blocker, and continue work independent of that answer.',
    'Complete this checklist:',
    '1. Inspect the current working tree, manifests, lockfiles, callers, critical implementations and representative tests. Record actual versions, development units and evidence paths. Treat historical knowledge as leads; reconcile removed paths and changed behavior instead of restoring old digests.',
    '2. Complete unit guidance, selected system/module/business-flow views, API and data contracts, failure and degradation branches, existing tests and local workflow from source. Separate observed facts, recommendations and unconfirmed business decisions. Requirements or gaps must not masquerade as implemented code.',
    '3. Author reusable project action guides with triggers, concrete rules, examples, verification and completion conditions. Add terminology and a task-to-knowledge index where useful; load only the matched knowledge. Honor configured Memory scope and authorization; candidate Skills are not automatically adopted.',
    `4. After editing human authority sources, inspect creates, updates, keeps and conflicts with ${command} sync . --dry-run, then apply authorized routine updates. Check compiled bodies, client projections, links, concrete source references and freshness.`,
    '5. Check knowledge against project questions: where a feature belongs, which callers and contracts must change together, how failure differs from empty results, what data or external effects occur, and which existing test checks it. Give current source and knowledge entrypoints for each answer; file counts are not a substitute.',
    '6. Recheck the actual source at close; update affected knowledge if it changed during the task. List each deliverable path, content check, actual execution result and remaining gap. Resolve required placeholders, broken links, stale references and missing behavioral guidance before stopping; report genuinely blocked items as incomplete. Keep structure, knowledge, real-client loading and product runtime separate; green checks do not mean all work is complete.',
  ];
}

function chinesePrompt({ root, config, phase, configPath, technologies, clients }) {
  const command = governanceCommand(config);
  const bootstrap = governanceBootstrapCommand(config, 'help').replace(/ help$/, ' ...');
  const setup = phase === 'applied'
    ? [
        '基础治理骨架已经应用。先读取当前配置和治理文件；不要重新运行 aicg init。',
        `先运行 ${command} check . --json --enforce 建立当前缺口基线；修改受管投影前先用 ${command} sync . --dry-run 预览。`,
      ]
    : [
        `基础配置文件是 ${configPath}。先运行 ${command} init . --config ${configPath} --dry-run 预览；核对后按 AICG 的精确 planHash 流程应用，不要让我手工转贴哈希。`,
        `若 aicg 不可用，停止并说明安装缺口；固定版本引导只用于安装或定位：${bootstrap}`,
      ];
  return [
    `请在真实仓库 ${root} 中使用 AICG 技能和脚本完善项目治理框架。`,
    '当前状态只能称为 handoff-ready；基础配置和固定模板只用于启动，不能称为“治理框架已完成”，也不能把模板内容当成项目最佳实践。',
    '从本轮开始，每次面向我的首条实质回复都在第一行写“当前角色：role-id（原因）”，列出本轮实际使用的所有角色并逐个说明原因；角色池不代表真人审核。',
    '先读 AGENTS.md、docs/WORKFLOW.md、现有治理文件、源码、构建清单和测试，按项目自己的约束执行。不要修改业务代码，不要删除历史种子或用户文件。',
    ...setup,
    ...completionGuidance(config, true),
    architectureHandoffGuidance(config, true),
    '始终生成完整治理框架，不提供 Minimal/Standard/Complete 档位选择。开发说明、系统/模块/业务流程图集中在 docs/development/ 给人阅读；再将稳定开发动作拆成该目录下 skills/*.md 指导文档，编译为 docs/ai/skills/development/ 的完整 Skill。每项包含触发条件、具体规则、正确与错误示例、验证方法；不要只链接整篇开发文档或源码，不创建软链接。按真实技术栈落实角色文件、系统职责和交接，不把回复里的角色名当成交付。',
    `本次已选择或扫描到的技术线索：${technologies.length ? technologies.join('、') : '尚未可靠识别；必须从真实仓库继续识别'}。已选择的 AI 工具：${clients.length ? clients.join('、') : '未记录'}。`,
    '无论某项技术 AICG 以前是否收录过，都必须针对所有已选择和实际发现的技术重新调研；不要只在遇到未知技术时调研，也不要依赖 AICG 内置的固定内容离线拼装答案。',
    '使用当前 AI 工具可用的联网搜索能力，优先查官方文档或其他一手资料，包括官方仓库、标准和规范，并记录来源 URL、适用版本和查阅日期。',
    '结合当前项目约束形成项目专属建议，至少覆盖：最佳技术栈目录结构、架构备选及取舍、开发、测试、安全、运维和迁移规范、版本兼容与升级风险，以及许可证、付费 SDK、再分发限制和外部成本。',
    '先比较方案和项目现状，再让负责人确认会改变架构、技术选型、付费依赖或许可证义务的决定；现有项目不得因为通用最佳实践而自动改造业务代码。',
    config.features?.knowledge === false || config.features?.brownfieldEnrichment === 'off' || config.brownfieldEnrichmentDecision?.status === 'declined'
      ? '用代码、测试或需求依据补全已选择的开发文档和架构流程图；业务 Memory 整理未授权或已关闭，不扩大该范围。约束与新 Skill 仍需负责人确认。'
      : '用代码和测试证据补全每个开发单元的开发文档、Memory 与项目约束；domainConstraints 必须由负责人确认，无法从证据证明的内容不得写成事实。项目 Skill 先作为候选，只有负责人明确 add 才采纳。',
    '本轮完善当前版本的治理与知识，不为尚未提出的业务功能预生成需求、plan 或空用例。后续开发沿用动态路由和既有 OpenSpec/原生权威；仅在收到后续明确授权的开发任务后，按路由需要使用 `aicg delivery prepare` 准备缺失草稿。L0/L1 与缺陷快速路径保持轻量，不默认 worktree、多 Agent 或固定全流程。',
    '如果 AI 工具没有网络能力、找不到足够的一手资料、版本不明确或资料互相冲突，把对应项标为 research-required 和 unverified，并列出缺少的证据；不得退回固定模板后假装已验证。',
    `完成治理内容后运行 ${command} check . --json --enforce。结构检查、资料调研、项目采用和真实验证分别报告，任何未实际执行的项保持 unverified。`,
    '最终报告用人话说明：改了什么、为什么适合这个项目、查了哪些一手资料、哪些决定已确认、哪些仍未验证、下一步由谁做什么。',
  ].join('\n');
}

function englishPrompt({ root, config, phase, configPath, technologies, clients }) {
  const command = governanceCommand(config);
  const bootstrap = governanceBootstrapCommand(config, 'help').replace(/ help$/, ' ...');
  const setup = phase === 'applied'
    ? [
        'The bootstrap governance skeleton is already applied. Read the current configuration and governance files; do not run aicg init again.',
        `First run ${command} check . --json --enforce to establish the current gaps. Preview managed projection updates with ${command} sync . --dry-run.`,
      ]
    : [
        `The base configuration is ${configPath}. Preview it with ${command} init . --config ${configPath} --dry-run, then apply the exact AICG planHash after review without asking me to relay the hash manually.`,
        `If aicg is unavailable, stop and report the installation gap. Pinned bootstrap is only for installation or discovery: ${bootstrap}`,
      ];
  return [
    `Use the AICG Skill and scripts to complete project-specific governance in the real repository at ${root}.`,
    'The current status is handoff-ready only. The base configuration and fixed templates are bootstrap material, not a completed governance framework or project best practice.',
    'On the first substantive reply of every turn, state each active role and its reason. A role pool is not evidence of human review.',
    'Read AGENTS.md, docs/WORKFLOW.md, existing governance, source, manifests, and tests first. Follow repository rules. Do not change product code or delete historical seeds or user files.',
    ...setup,
    ...completionGuidance(config, false),
    architectureHandoffGuidance(config),
    'Always generate the complete governance framework; there is no depth selection. Keep human development documentation and system/module/business-flow diagrams together under docs/development/. Extract stable development actions into authored skills/*.md guides there, then compile their complete bodies into docs/ai/skills/development/. Include triggers, rules, correct and incorrect examples, and verification. Never substitute links to entire documents or source files for instructions; do not create symlinks. Define stack-appropriate role responsibilities and handoffs as project files, not only conversational role labels.',
    `Selected or detected technology clues: ${technologies.length ? technologies.join(', ') : 'not reliably identified; inspect the real repository to identify them'}. Selected AI tools: ${clients.length ? clients.join(', ') : 'not recorded'}.`,
    'Research every selected and actually detected technology whether or not AICG has seen it before. Do not research only unknown technologies, and do not assemble the result offline from AICG fixed content.',
    'Use the AI tool available web/search capability. Prefer official documentation, official repositories, standards, specifications, and other primary sources. Record source URLs, applicable versions, and access dates.',
    'Produce project-specific recommendations covering repository structure, architecture options and tradeoffs, development, testing, security, operations, migration, compatibility and upgrade risks, licensing, paid SDKs, redistribution constraints, and external costs.',
    'Compare options with the current project before recommending change. Ask the owner to confirm architecture, stack, paid dependency, and license-impact decisions. Never rewrite existing product code merely to match generic best practice.',
    config.features?.knowledge === false || config.features?.brownfieldEnrichment === 'off' || config.brownfieldEnrichmentDecision?.status === 'declined'
      ? 'Complete selected development guidance and architecture/business-flow views from source, tests or requirements. Business Memory enrichment is disabled or declined; do not expand that scope. Constraints and new Skills still require owner confirmation.'
      : 'Complete development-unit guidance, Memory, and project constraints from code and test evidence. domainConstraints require owner confirmation. Propose project Skills as candidates until the owner explicitly chooses add.',
    'Complete governance and knowledge for the current version, without generating requirements, plans or empty cases for unrequested future features. Later development keeps dynamic routing and the existing OpenSpec/native authority. Only after a later development task is explicitly authorized, use `aicg delivery prepare` for missing drafts required by its route. Keep L0/L1 and bounded bugfix paths light; no default worktree, multi-Agent or full pipeline.',
    'When network access, primary sources, versions, or evidence are insufficient, mark the item research-required and unverified. Never fall back to a fixed template and present it as verified.',
    `After improving governance, run ${command} check . --json --enforce. Report structural checks, research, project adoption, and runtime verification separately; unexecuted claims remain unverified.`,
    'Write the final report in plain language: what changed, why it fits this project, primary sources used, confirmed decisions, unverified gaps, and the next owner for each action.',
  ].join('\n');
}

export function buildGovernanceHandoff({ root, config = {}, scan = null, phase = 'configured', configPath = 'aicg.config.json', locale = null }) {
  if (!['configured', 'applied'].includes(phase)) throw new Error(`Unsupported governance handoff phase: ${phase}.`);
  const technologies = selectedTechnologies(config, scan);
  const clients = selectedClients(config);
  const language = locale ?? config.interactionLanguage ?? 'en';
  const values = { root, config, phase, configPath, technologies, clients };
  return {
    schemaVersion: 1,
    status: 'handoff-ready',
    frameworkStatus: 'bootstrap-only',
    phase,
    configPath,
    technologies,
    clients,
    research: {
      status: 'unverified',
      scope: 'all-selected-technologies',
      sourcePolicy: 'official-or-primary-current-version',
      onInsufficientEvidence: 'research-required',
      requiredAreas: [...RESEARCH_AREAS],
    },
    prompt: language === 'zh-CN' ? chinesePrompt(values) : englishPrompt(values),
  };
}

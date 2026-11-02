import { prepareDeliveryArtifacts } from './delivery-preparation.mjs';
import { assessDeliveryArtifacts } from './delivery-assessment.mjs';

/** Explain the existing task route without applying governance or executing project code. */
export function buildTaskHandoff({ config = null, phase = 'unconfigured', configPath = null, task = null, text, scope, paths = [], root, locale, approvalEvidence = null, approve = null } = {}) {
  const zh = (locale ?? config?.interactionLanguage) === 'zh-CN';
  const configured = task && (phase === 'applied' || task.route.level === 'L0');
  const artifactOptions = { delivery: task?.delivery, scope, text, caseRoot: config?.testing?.caseRoot,
    caseFormat: config?.testing?.caseFormat, reportRoot: config?.testing?.reportRoot, language: config?.artifactLanguage, write: false, approvalEvidence, approve };
  const preparation = configured ? prepareDeliveryArtifacts(root, artifactOptions) : null;
  const assessment = configured ? assessDeliveryArtifacts(root, artifactOptions) : null;
  const level = task?.route.level;
  const guidance = task?.developmentGuidance ?? null;
  const guidanceBlocked = guidance?.status === 'needs-sync';
  const designConfirmationRequired = configured && ['L2', 'L3'].includes(level)
    && (task.delivery.lifecycle === 'greenfield' || task.delivery.artifacts.some((artifact) => artifact.id === 'architecture'));
  const awaitingConfirmation = designConfirmationRequired && !assessment.approval?.ok;
  const id = !configured ? config ? 'apply-existing-config' : 'configure-project'
    : level === 'L0' ? 'inspect-and-answer' : guidanceBlocked ? 'sync-development-guidance' : assessment.readiness === 'needs-content' ? 'complete-selected-content'
      : awaitingConfirmation ? 'confirm-design-before-implementation' : 'review-scope-and-proceed';
  const instructions = zh ? {
    'sync-development-guidance': '适用的开发规范缺失、过期或不可读；先预览治理同步并在已有授权内修复，保留人工改动，再继续产品实现。',
    'confirm-design-before-implementation': '将具体需求、架构图、业务流程图、开发规范与实施计划交由客户确认；确认前只做方案文档，不创建应用骨架、不安装依赖、不修改产品配置或实现代码。复用同版本同范围的已有明确确认，重大变更重新确认。',
    'configure-project': '先确认支持的 AI 客户端、项目生命周期和测试格式，再预览基础配置；不要默认替负责人选择。',
    'apply-existing-config': `沿用 ${configPath} 的已确认选择，预览精确应用计划；仅在已有授权范围内应用，然后用相同任务与模块再次 handoff。`,
    'inspect-and-answer': '只读检查最少项目证据并回答；本任务不要求创建 BA、设计、计划或运行测试。',
    'complete-selected-content': '读取下列已有权威资料，只补本模块的具体缺口；缺失文件先预览草稿，不覆盖原内容。',
    'review-scope-and-proceed': '沿用已确认范围和现有资料；只澄清未解决的关键业务决策，在现有授权内按路由继续并保留验证证据。',
  } : {
    'sync-development-guidance': 'Applicable development Skills are missing, stale or unreadable. Preview governance sync, repair within existing authorization while preserving owner edits, then continue product implementation.',
    'confirm-design-before-implementation': 'Present the concrete requirements, architecture and business-flow diagrams, conventions and plan for customer confirmation before creating application scaffolds, installing dependencies, changing product configuration or writing implementation code. Reuse explicit approval of the same revision and scope; reconfirm material changes.',
    'configure-project': 'Confirm supported AI clients, project lifecycle and test format, then preview base configuration; do not select these for the owner.',
    'apply-existing-config': `Reuse confirmed choices in ${configPath}, preview the exact application plan, apply only within existing authorization, then repeat this task and scope.`,
    'inspect-and-answer': 'Inspect minimum read-only project evidence and answer; no BA, design, plan or test execution is required for this task.',
    'complete-selected-content': 'Read the selected authoritative artifacts and complete only this module’s specific gaps; preview missing drafts and never overwrite owner content.',
    'review-scope-and-proceed': 'Reuse confirmed scope and existing artifacts; clarify only unresolved material business decisions, proceed within existing authorization and retain verification evidence.',
  };
  const result = { schemaVersion: 1, kind: 'task-handoff', status: !configured ? 'needs-setup' : guidanceBlocked ? 'needs-development-guidance' : assessment.readiness === 'needs-content' ? 'needs-content' : awaitingConfirmation ? 'awaiting-customer-confirmation' : 'prepared-for-agent',
    frameworkStatus: 'bootstrap-only', phase, configPath, clients: config?.clients ?? [], task: { text, scope, paths },
    route: task?.route ?? null, delivery: task?.delivery ?? null, process: task?.process ?? null,
    preparation, assessment, developmentGuidance: guidance, nextAction: { id, instruction: instructions[id] },
    readOnly: true, execution: 'not-run', verification: 'unverified', approval: assessment?.approval ?? 'not-assessed', environment: 'unverified' };
  const lines = [zh ? `下一步：${instructions[id]}` : `Next action: ${instructions[id]}`,
    `${zh ? '路由' : 'Route'}: ${level ?? (zh ? '待配置' : 'pending setup')} | ${result.status}`];
  for (const skill of guidance?.skills ?? []) lines.push(`${zh ? '必读开发 Skill' : 'Required development Skill'}: ${skill.path} (${skill.status})`);
  if (guidance?.skills?.length) lines.push(zh
    ? '实现前读取上述规范并搜索已有能力；在已有计划或评审中说明新增抽象的消费者、模块依赖和组件状态归属。评审实际代码并运行行为与边界检查，不能用声明已读代替应用证据。'
    : 'Read these Skills and search existing capabilities before implementation. In the existing plan or review, explain consumers of new abstractions, module dependencies and component state ownership. Review the actual code and run behavior and boundary checks; a read declaration is not application evidence.');
  for (const artifact of preparation?.references ?? []) lines.push(`${zh ? '引用' : 'Reference'}: ${artifact.path} (${artifact.id})`);
  for (const file of preparation?.files ?? []) lines.push(`${file.action === 'keep' ? (zh ? '保留并检查' : 'Keep and inspect') : (zh ? '缺失' : 'Missing')}: ${file.path} (${file.id})`);
  for (const finding of assessment?.findings ?? []) lines.push(`- ${finding.path}: ${finding.code} — ${finding.message}`);
  if (configured && level !== 'L0') lines.push(zh
    ? '沿用模块 Case ID，使用 imports 引用公共角色、环境和数据；只更新本次受影响的用例与共享上下文摘要。不要重复建立整套文档。'
    : 'Reuse module Case IDs and imports for shared actors, environments and data; update only affected cases and shared-context digests, not duplicate document sets.');
  lines.push(zh
    ? '边界：未写入文件、未执行项目命令或测试，环境与代码行为未验证；文档结构检查不代表需求正确、负责人批准或交付验收。不要强加 worktree、多 Agent 或固定 TDD 流程。需要环境排查时使用 aicg doctor .。'
    : 'Boundary: no files written, project commands or tests executed; environment and code behavior remain unverified. Structural content checks do not prove correct requirements, owner approval or delivery acceptance. No mandatory worktree, multi-Agent or fixed TDD workflow. Use aicg doctor . when environment diagnosis is needed.');
  result.prompt = lines.join('\n');
  return result;
}

import path from 'node:path';

export const ARCHITECTURE_DOCUMENT = 'docs/development/architecture.md';

/** Prefer an existing authored overview; a dependency policy is not a system overview. */
export function architectureDocumentSource(scan = {}) {
  const paths = new Set((scan.files ?? []).filter((file) => typeof file === 'string' || file.type === 'file')
    .map((file) => typeof file === 'string' ? file : file.relative));
  return ['docs/architecture.md', 'docs/architecture/README.md', ARCHITECTURE_DOCUMENT].find((relative) => paths.has(relative)) ?? null;
}

function label(value) {
  return String(value).replace(/[\r\n`]/g, ' ').replaceAll('&', '&amp;').replaceAll('"', '&quot;')
    .replaceAll('<', '&lt;').replaceAll('>', '&gt;').slice(0, 180);
}

/** A reviewable baseline, completed semantically by the calling Agent, never by filenames. */
export function architectureDocument({ lifecycle = 'existing', text = '', language = 'en', units = [], relative = ARCHITECTURE_DOCUMENT } = {}) {
  const zh = language === 'zh-CN';
  const t = (en, cn) => zh ? cn : en;
  const proposed = lifecycle === 'greenfield';
  const heading = t('Project architecture and business flow', '项目架构与业务流程');
  const view = (title, diagram, guidance) => `## ${title}\n\n\`\`\`mermaid\n${diagram}\n\`\`\`\n\n${guidance}\n`;
  const system = `flowchart LR\n  project["${t(proposed ? 'Proposed system boundary' : 'Observed repository boundary', proposed ? '拟建系统边界' : '已扫描仓库边界')}"]`;
  const modules = units.length ? `flowchart TB\n  project["${t(proposed ? 'Proposed project' : 'Repository', proposed ? '拟建项目' : '仓库')}"]\n${units.slice(0, 24).map((unit, index) => `  unit${index}["${label(unit.path)}"]\n  project -->|${t(proposed ? 'proposed unit' : 'contains unit', proposed ? '拟建单元' : '包含单元')}| unit${index}`).join('\n')}`
    : `flowchart TB\n  modules["${t('Module responsibilities require design', '模块职责需要设计')}"]`;
  const flow = `flowchart TD\n  trigger["${t('Business trigger to confirm', '待确认的业务触发条件')}"]\n  decision{"${t('Business condition to confirm', '待确认的业务条件')}"}\n  success["${t('Expected outcome to confirm', '待确认的预期结果')}"]\n  failure["${t('Failure or permission outcome to confirm', '待确认的失败或权限结果')}"]\n  trigger --> decision\n  decision -->|${t('success', '成功')}| success\n  decision -->|${t('failure', '失败')}| failure`;
  const references = [...new Set(units.flatMap((unit) => [...(unit.manifests ?? []), ...(unit.sourceFiles ?? [])]))].slice(0, 40);

  return `# ${heading}

> ${t('Status: draft / needs-evidence. Diagram skeletons are not a completed architecture or customer confirmation.', '状态：草稿 / 待补证据。图示骨架不代表架构已梳理完成，也不代表客户确认。')}

- ${t('Lifecycle', '项目阶段')}: ${proposed ? 'greenfield / proposed' : 'existing / observed baseline'}
- ${t('Request', '需求')}: ${label(text) || t('Record the selected request and scope.', '记录本次需求与范围。')}
- ${t('Boundary', '边界')}: ${t('Current facts, intended behavior, proposed improvements, adopted policy, and executed verification are separate.', '区分当前事实、预期业务、改进建议、已采用规范及已执行验证。')}

${view(t('System overview', '系统总览'), system, t('TODO: identify actors and evidenced external systems. Do not invent a database, deployment, or integration.', 'TODO：识别参与者及有依据的外部系统，不得编造数据库、部署或集成。'))}
${view(t('Module architecture', '模块架构'), modules, t('TODO: explain responsibilities, interfaces and collaboration. Containment is not a runtime dependency. Split dense views.', 'TODO：补全职责、接口与协作关系；目录包含关系不代表运行时依赖。复杂图应拆分。'))}
${view(t('Core business flow', '核心业务流程'), flow, t('TODO: replace the skeleton with one real or proposed business flow, decisions, data effects, and a failure or permission branch. Add a plain-language explanation.', 'TODO：替换为一条真实或拟定业务流程，写清决策、数据影响、失败或权限分支，并补充通俗说明。'))}
## ${t('Evidence and requirement references', '证据与需求引用')}

${references.length ? references.map((ref) => `- \`${label(ref)}\``).join('\n') : t('TODO: link to requirement definitions and recorded customer decisions; new projects have no implementation evidence yet.', 'TODO：引用需求定义及客户决策；新项目尚无实现证据。')}

${t('TODO: map each material node and relationship to a source, contract, test, configuration or requirement reference. Mark unsupported claims unverified. A test file is not a test result.', 'TODO：将重要节点和关系对应到源码、契约、测试、配置或需求；无法证明的标记未验证。测试文件不等于测试结果。')}

## ${t('Development conventions and implementation plan', '开发规范与实施计划')}

${t('TODO: reference existing standards; distinguish observed patterns from approved rules. Record module ownership, contracts, technology tradeoffs, versions, costs, verification and rollout steps.', 'TODO：引用已有规范，区分观察到的模式与已批准规则；记录模块职责、契约、技术取舍、版本、成本、验证及实施步骤。')}

## ${t('Customer review and unresolved decisions', '客户审阅与待确认事项')}

${t('TODO: record scope, non-goals, assumptions, risks and acceptance scenarios. Present this concrete document together with requirements and the implementation plan for customer confirmation.', 'TODO：记录范围、非目标、假设、风险与验收场景；将这份具体文档与需求、实施计划一起交由客户确认。')}

${t('Before customer confirmation, prepare analysis and planning documents only. Do not create application scaffolds, install dependencies, change product/build/deployment configuration, or write implementation code. Reuse prior explicit approval of the same revision and scope; material changes require confirmation of the affected scope.', '客户确认前只做分析与方案文档，不创建应用骨架、不安装依赖、不改产品或构建部署配置、不写实现代码。同版本同范围的明确确认直接复用；重大变更重新确认受影响范围。')}

${t('Preserve manual diagrams. Keep one authoritative authored source and review it when referenced behavior changes. Rendering, customer review and runtime acceptance remain separate.', '保留人工图示，每张图维护唯一可编辑来源；引用行为变化时复核。图示渲染、客户审阅与运行验收分别记录。')}
`;
}

export function architectureHandoffGuidance(config, zh = false) {
  const greenfield = (config.initialization?.lifecycle ?? config.projectMode) === 'greenfield';
  if (zh) return greenfield
    ? '新项目：先按用户需求补全系统总览图、模块架构图、核心业务流程图、开发规范和实施计划；重要关系引用需求及决策。使用 Markdown/Mermaid，现有权威设计直接引用。将具体方案交由客户确认；客户确认前不创建应用骨架、不安装依赖、不修改产品配置或实现代码。同版本同范围的已有确认直接复用，重大变更重新确认。模板、结构检查和沉默均不等于客户确认。'
    : `已有项目${config.features?.architectureDocumentation ? `（已选择 ${ARCHITECTURE_DOCUMENT}）` : ''}：需要架构梳理时读取现有权威文档和源码，形成系统总览图、模块架构图、核心业务流程图并关联开发规范；每条重要关系附源码、契约或配置证据，待确认业务保持未验证，不把既有缺陷固化为规则。`;
  return greenfield
    ? 'New project: complete a system overview, module architecture, core business flow, development conventions and implementation plan from user requirements, with requirement/decision references. Use Markdown/Mermaid and reference existing authoritative designs. Present the concrete package for customer confirmation before creating application scaffolds, installing dependencies, changing product configuration or writing implementation code. Reuse existing explicit approval of the same revision and scope; reconfirm material changes. Templates, structural checks and silence are not customer confirmation.'
    : `Existing project${config.features?.architectureDocumentation ? ` (selected ${ARCHITECTURE_DOCUMENT})` : ''}: when architecture documentation is requested, inspect authoritative documents and source, produce a system overview, module architecture and core business flow linked to development guidance. Cite source, contracts or configuration for material relationships; keep unresolved meaning unverified and do not adopt existing defects as rules.`;
}

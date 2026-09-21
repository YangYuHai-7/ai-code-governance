import { selectedSkillDirectories } from '../../catalogs/index.mjs';
import { skillAdapterContent, stableJson } from '../../shared/index.mjs';

const STACK_SHAPES = {
  'frontend-react': { area: 'apps', runtime: 'React', source: 'src', entry: 'app', modules: 'feature', contracts: 'API client and view model', coverage: 'active-template' },
  'frontend-vue': { area: 'apps', runtime: 'Vue', source: 'src', entry: 'app', modules: 'feature', contracts: 'API client and view model', coverage: 'active-template' },
  'frontend-angular': { area: 'apps', runtime: 'Angular', source: 'src', entry: 'app', modules: 'feature', contracts: 'API client and view model', coverage: 'active-template' },
  'backend-node': { area: 'services', runtime: 'Node.js', source: 'src', entry: 'app', modules: 'domain', contracts: 'HTTP or message contract', coverage: 'active-template' },
  'backend-java': { area: 'services', runtime: 'Java', source: 'src/main/java', entry: 'application', modules: 'domain', contracts: 'HTTP or message contract', coverage: 'active-template' },
  'frontend-svelte': { area: 'apps', runtime: 'Svelte', source: 'src', entry: 'app', modules: 'feature', contracts: 'API client and view model', coverage: 'planned-template' },
  'backend-python': { area: 'services', runtime: 'Python', source: 'src', entry: 'app', modules: 'domain', contracts: 'HTTP or message contract', coverage: 'planned-template' },
  'backend-go': { area: 'services', runtime: 'Go', source: 'internal', entry: 'app', modules: 'domain', contracts: 'HTTP or message contract', coverage: 'planned-template' },
  'backend-php': { area: 'services', runtime: 'PHP', source: 'src', entry: 'app', modules: 'domain', contracts: 'HTTP or message contract', coverage: 'planned-template' },
  'platform-dotnet': { area: 'services', runtime: '.NET', source: 'src', entry: 'app', modules: 'domain', contracts: 'HTTP or message contract', coverage: 'roadmap-template' },
  'platform-android': { area: 'apps', runtime: 'Android', source: 'app/src/main', entry: 'app', modules: 'feature', contracts: 'navigation and platform contract', coverage: 'roadmap-template' },
  'platform-ios': { area: 'apps', runtime: 'iOS', source: 'Sources', entry: 'app', modules: 'feature', contracts: 'navigation and platform contract', coverage: 'roadmap-template' },
  'platform-hybrid-mobile': { area: 'apps', runtime: 'Hybrid mobile', source: 'src', entry: 'app', modules: 'feature', contracts: 'native bridge and view model', coverage: 'roadmap-template' },
  'platform-desktop': { area: 'apps', runtime: 'Desktop', source: 'src', entry: 'app', modules: 'feature', contracts: 'desktop shell and view model', coverage: 'roadmap-template' },
  'platform-c-cpp': { area: 'services', runtime: 'C/C++', source: 'src', entry: 'app', modules: 'domain', contracts: 'header and ABI contract', coverage: 'roadmap-template' },
};

function architectureDoc(stack, shape, root, multi, language) {
  const zh = language === 'zh-CN';
  const title = zh ? `${shape.runtime} 子工程开发与架构设计` : `${shape.runtime} development and architecture design`;
  const boundary = multi ? `${root}/` : '';
  return `# ${title}

> ${zh ? '状态：待实现的生产级目录设计；生成目录不证明实现质量。' : 'Status: production-oriented directory design awaiting implementation; generated paths do not prove implementation quality.'}

## ${zh ? '工程边界' : 'Project boundary'}

- ${zh ? '技术栈' : 'Stack'}: \`${stack}\`
- ${zh ? '模板覆盖状态' : 'Template coverage'}: \`${shape.coverage}\`${shape.coverage === 'active-template' ? '' : zh ? '；需专业人员确认框架约定与目录可用性。' : '; framework conventions and production suitability require specialist review.'}
- ${zh ? '工程根目录' : 'Project root'}: \`${root}\`
- ${zh ? '依赖方向' : 'Dependency direction'}: \`entry → modules → shared\`; ${zh ? '插件通过显式接口接入，业务模块不得反向依赖入口层。' : 'plugins enter through explicit interfaces; domain modules do not depend on the entry layer.'}

## ${zh ? '目录设计' : 'Directory design'}

\`\`\`text
${boundary}${shape.source}/
  ${shape.entry}/       # composition root, routes, bootstrap
  modules/       # one bounded ${shape.modules} per directory
    <module>/
      domain/    # business rules, independent of transport and framework
      application/ # use cases and ports
      infrastructure/ # adapters implementing ports
      interface/ # ${shape.contracts}
      tests/     # unit and contract tests near their owner
  plugins/       # extension contracts, registry, isolated implementations
  shared/        # cross-module primitives without business ownership
${boundary}docs/ai/
  development.md
  rules/architecture.md
  skills/${stack}-architecture/SKILL.md
\`\`\`

## ${zh ? '架构约束' : 'Architecture constraints'}

1. ${zh ? '一个模块拥有自己的业务状态、接口与测试；跨模块通过公开端口或事件协作。' : 'A module owns its state, public interface, and tests; cross-module work uses public ports or events.'}
2. ${zh ? '插件必须声明扩展点、版本兼容规则、初始化与卸载方式；插件不可直接访问别的模块内部文件。' : 'A plugin declares an extension point, compatibility version, lifecycle, and isolated dependency boundary; it never imports another module’s internals.'}
3. ${zh ? '应用层编排用例，领域层表达规则，基础设施层负责外部依赖；一个文件只有一个主要职责。' : 'Application code orchestrates use cases, domain code owns rules, infrastructure code owns external effects; each file has one primary responsibility.'}
4. ${zh ? '公共契约先定义输入、输出、错误和兼容策略；变更后执行本模块及调用方验证。' : 'Public contracts define input, output, errors, and compatibility before implementation; verify the owner and consumers after changes.'}
${multi ? `5. ${zh ? '跨工程契约遵守根目录 `docs/ai/development/cross-project-contracts.md`，由服务或共享协议包唯一维护。' : 'Cross-project contracts follow root `docs/ai/development/cross-project-contracts.md` and have one owning service or shared protocol package.'}` : ''}

## ${zh ? '交付与验证' : 'Delivery and verification'}

- ${zh ? '根据所选框架与包管理器建立真实构建清单；此设计不臆造尚未选定的运行命令。' : 'Create the real build manifest for the chosen framework and package manager; this design does not invent unselected commands.'}
- ${zh ? '新增模块时补充契约测试、模块边界检查、运行命令和 README 入口。' : 'For a new module, add contract tests, boundary checks, executable commands, and a README entrypoint.'}
- ${zh ? '新增插件时验证注册、失败隔离、卸载和版本不兼容情形。' : 'For a new plugin, verify registration, failure isolation, unloading, and incompatible versions.'}
- ${zh ? '实现后的依赖图、职责划分和性能需由独立评审复核。' : 'An independent review must check the implemented dependency graph, responsibilities, and performance.'}
- ${zh ? '此目录设计是待采纳方案；必须在实际框架版本、构建清单和代码边界确定后，由负责人批准并记录架构决策。' : 'This layout is a proposal awaiting adoption. Record owner approval after actual framework versions, build manifests, and code boundaries are known.'}
`;
}

function stackSkill(stack, shape, doc, language) {
  const zh = language === 'zh-CN';
  return `---
name: ${stack}-development
description: ${zh ? `在 ${shape.runtime} 子工程新增模块、插件或修改公共契约时使用。` : `Use when adding modules or plugins, or changing public contracts in the ${shape.runtime} project.`}
---

# ${shape.runtime} development

## When to use

- Work inside this ${shape.runtime} project on a module, plugin, or public contract.

## When not to use

- Do not apply these rules to another stack or infer business behavior from this template.

## Source of truth

- Read \`${doc}\` and the local architecture rule before implementation.
- Confirm actual framework versions and build commands from manifests once they exist.

## Required invariants

- One business module owns one bounded responsibility and exposes a public contract.
- Domain rules do not import framework bootstrap, adapters, or another module's internal files.
- Plugins implement a versioned extension interface and can fail without corrupting the host module.

## Decision flow

1. Identify the owning module and its public port. Add a new module only for a distinct business responsibility.
2. Define the contract and verification cases before changing implementation.
3. Keep domain rules independent from ${shape.runtime} framework code and external adapters.
4. Register plugins through the declared extension interface and test failure isolation.
5. Run the project’s actual tests, record results, and obtain user confirmation before applying business-code changes.

## Exceptions and escalation

- If framework version, build manifest, or executable verification command is absent, keep the design provisional and request owner selection before code generation.
- A cross-project contract, migration, external action, or security-sensitive change follows the stronger L2/L3 route and its exact approval requirements.

## Verification matrix

| Scenario | Expected result | Command or evidence status |
| --- | --- | --- |
| New module | Its public port is defined and domain code has no reverse framework import | Boundary check: unverified until implemented |
| New plugin | Registration, failure isolation, unload, and incompatible version cases pass | Project test command: unverified until manifest exists |
| Public contract change | Producer and every consumer use the same versioned schema | Contract test: unverified until schema exists |

## Project evidence boundary

- This Skill describes a selected-stack layout proposal, not an adopted or verified architecture. Project-specific examples and commands require implementation evidence, owner approval, and independent review.

## Sources

- Selected stack \`${stack}\` and \`${doc}\` are the design inputs.
- Current framework version, executable commands, and code behavior must be cited from the future project manifests, source, and tests.
`;
}

export function buildGreenfieldLayoutArtifacts(config) {
  if (config.initialization?.lifecycle !== 'greenfield' || config.governanceDepth === 'minimal') return { units: [], artifacts: [] };
  const stacks = [...new Set(config.stacks)].filter((stack) => STACK_SHAPES[stack]);
  const unresolvedStacks = [...new Set(config.stacks)].filter((stack) => !STACK_SHAPES[stack]);
  if (stacks.length === 0) return { units: [], artifacts: [] };
  const multi = stacks.length > 1;
  const adapterDirs = selectedSkillDirectories(config.clients ?? []);
  const units = stacks.map((stack) => {
    const shape = STACK_SHAPES[stack];
    const root = multi ? `${shape.area}/${stack}` : '.';
    return { stack, root, shape };
  });
  const artifacts = [{
    path: 'docs/ai/development/index.json',
    content: stableJson({ schemaVersion: 1, status: 'design-awaiting-implementation', unresolvedStacks, crossProjectContractPolicy: multi ? 'docs/ai/development/cross-project-contracts.md' : null, units: units.map(({ stack, root, shape }) => ({ stack, path: root, coverage: shape.coverage, documentation: root === '.' ? 'docs/ai/development.md' : `${root}/docs/ai/development.md` })) }),
    ownership: 'full', kind: 'greenfield-development-index', source: 'selected-stacks',
  }];
  if (multi) artifacts.push({
    path: 'docs/ai/development/cross-project-contracts.md',
    content: `# Cross-project contract policy\n\nStatus: design proposal awaiting owner adoption and implementation evidence.\n\n- One owning service or shared protocol package owns each public schema. Consumers do not fork DTO definitions silently.\n- Record contract ID, owning project, version, compatibility decision, producer, consumers, and error semantics before implementation.\n- Keep schemas in a versioned contract directory selected by the owner; generated clients remain derived artifacts.\n- For every contract change, test producer conformance and each consumer against the same schema and include backward-compatibility cases.\n- A cross-project feature is one work unit with coordinated page, API, service, data, migration, and test evidence.\n- Changing the protocol requires a user-approved plan, relevant stack specialists, and an independent reviewer; record test results and unresolved gaps.\n`,
    ownership: 'seed', kind: 'greenfield-cross-project-contract-policy', source: 'selected-stacks',
  });
  for (const { stack, root, shape } of units) {
    const prefix = root === '.' ? '' : `${root}/`;
    const doc = `${prefix}docs/ai/development.md`;
    const architecture = `${prefix}docs/ai/rules/architecture.md`;
    artifacts.push({ path: doc, content: architectureDoc(stack, shape, root, multi, config.artifactLanguage), ownership: 'seed', kind: 'greenfield-development-document', source: 'selected-stacks' });
    artifacts.push({ path: architecture, content: `# ${shape.runtime} architecture rule\n\nRead [the development design](../development.md). Keep domain modules independent, keep composition in \`${shape.source}/${shape.entry}/\`, and use versioned plugin interfaces in \`${shape.source}/plugins/\`. Verify module and plugin boundaries before merging.\n`, ownership: 'seed', kind: 'greenfield-architecture-rule', source: 'selected-stacks' });
    const skillPath = `${prefix}docs/ai/skills/${stack}-architecture/SKILL.md`;
    const skill = stackSkill(stack, shape, doc, config.artifactLanguage);
    artifacts.push({ path: skillPath, content: skill, ownership: 'seed', kind: 'greenfield-stack-skill', source: 'selected-stacks' });
    for (const directory of adapterDirs) artifacts.push({ path: `${prefix}${directory}/${stack}-architecture/SKILL.md`, content: skillAdapterContent(skillPath, skill), ownership: 'seed', kind: 'greenfield-stack-adapter-skill', source: skillPath });
    if (multi) artifacts.push({ path: `${prefix}AGENTS.md`, content: `# ${shape.runtime} project\n\nRead \`${doc}\`, \`${architecture}\`, and \`${prefix}docs/ai/skills/${stack}-architecture/SKILL.md\` before changing this project. Treat the layout as a proposal until owner adoption and implementation evidence are recorded. Follow the root governance policy.\n`, ownership: 'seed', kind: 'greenfield-unit-entrypoint', source: 'selected-stacks' });
    for (const section of [shape.entry, 'modules', 'plugins', 'shared']) artifacts.push({ path: `${prefix}${shape.source}/${section}/README.md`, content: `# ${section}\n\n${section === 'plugins' ? 'Declare versioned extension interfaces and isolated implementations here.' : section === 'modules' ? 'Create one bounded business module per directory; keep domain, application, infrastructure, interface, and tests separate.' : section === 'shared' ? 'Keep only stable cross-module primitives here; business rules belong to modules.' : 'Compose modules, adapters, routes, and plugin registrations here.'}\n`, ownership: 'seed', kind: 'greenfield-directory-design', source: 'selected-stacks' });
  }
  return { units, artifacts };
}

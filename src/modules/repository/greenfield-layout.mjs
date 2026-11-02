import path from 'node:path';
import { readText } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
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

const SHARED_ARCHITECTURE = 'docs/development/shared-architecture.md';

function architectureDoc(stack, shape, root, multi, language) {
  const zh = language === 'zh-CN';
  const doc = root === '.' ? 'docs/development/README.md' : `docs/development/units/${stack}.md`;
  const common = path.posix.relative(path.posix.dirname(doc), SHARED_ARCHITECTURE);
  const java = stack === 'backend-java';
  return `# ${shape.runtime} ${zh ? '开发设计' : 'development design'}

> ${zh ? '待采纳的目录方案；生成目录不证明生产质量。' : 'Layout proposal awaiting adoption; generated paths do not prove production quality.'}

- ${zh ? '技术栈' : 'Stack'}: \`${stack}\`
- ${zh ? '工程根目录' : 'Project root'}: \`${root}\`
- ${zh ? '模板覆盖状态' : 'Template coverage'}: \`${shape.coverage}\`${shape.coverage === 'active-template' ? '' : zh ? '；需要专业人员确认' : '; specialist confirmation required'}
- ${zh ? '实现前阅读' : 'Before implementation, read'} [${zh ? '共享架构指南' : 'shared architecture guidance'}](${common}).

\`\`\`text
${shape.source}/${java ? '<base-package>/' : ''}
  ${shape.entry}/  # ${zh ? '组合入口、路由与启动' : 'composition, routes, bootstrap'}
  modules/        # ${zh ? '每个目录拥有明确的业务职责' : `one bounded ${shape.modules} per directory`}
  shared/         # ${zh ? '稳定的跨模块基础类型' : 'stable cross-module primitives'}
\`\`\`

${zh ? '模块内按实际职责组织文件；有明确需求时再拆分层级或新增插件。不要创建空层。' : 'Organize files by actual responsibilities within each module. Add layers or plugins only when a concrete use case needs them; do not create empty layers.'}

${java ? (zh ? '基础包由项目根据命名空间约定选择；将包名转换成目录层级，不要创建字面 `<base-package>` 目录。' : 'The project selects its base package. Translate the package name into directory segments; do not create a literal `<base-package>` directory.') : ''}

${multi ? `${zh ? '跨工程契约遵循' : 'Cross-project schemas follow'} [${zh ? '契约策略' : 'the contract policy'}](${path.posix.relative(path.posix.dirname(doc), 'docs/development/cross-project-contracts.md')}).` : ''}

${zh ? '从实际构建清单确认框架版本和可执行命令。记录负责人采纳决定和当前验证结果，之后才能认定方案已实现。' : 'Confirm framework versions and executable commands from real manifests. Record owner adoption and current verification before treating the proposal as implemented.'}
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

- Read \`${doc}\` and follow its shared architecture guidance before implementation.
- Confirm actual framework versions and build commands from manifests once they exist.

## Required invariants

- One business module owns one bounded responsibility and exposes a public contract.
- Business modules do not import the composition root or another module's internal files.
- Add plugin interfaces only for an implemented extension use case.

## Decision flow

1. Identify the owning module and its public port. Add a new module only for a distinct business responsibility.
2. Define the contract and verification cases before changing implementation.
3. Keep business rules separate from transport and external effects when those responsibilities exist; do not require empty layer directories.
4. If implementing a plugin, declare its interface and test failure isolation.
5. Run the project’s actual tests and record results. Follow the root approval policy and existing user authorization.

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

function layoutKind(stack) {
  if (stack.startsWith('frontend-')) return 'web';
  if (stack.startsWith('backend-') || stack === 'platform-dotnet') return 'server';
  return null;
}

function safeRoot(root) {
  return typeof root === 'string' && path.posix.normalize(root) === root && (root === '.' || root.split('/').every((part) => /^[a-zA-Z0-9_.-]+$/.test(part) && part !== '.' && part !== '..'));
}

/** Pure layout calculation. Explicit roots preserve an adopted project boundary. */
export function greenfieldDevelopmentUnits(config) {
  const stacks = [...new Set(config.stacks ?? [])].filter((stack) => STACK_SHAPES[stack]);
  const recorded = config.developmentUnits ?? [];
  if (!Array.isArray(recorded)) throw usageError('Recorded layout units must be an array.');
  const roots = new Map();
  for (const unit of recorded) {
    if (!unit || !stacks.includes(unit.stack)) continue;
    const root = unit.root ?? unit.path;
    if (!safeRoot(root) || roots.has(unit.stack)) throw usageError('Recorded layout has an unsafe path or duplicate stack root.');
    roots.set(unit.stack, root);
  }
  const units = stacks.map((stack) => {
    const shape = STACK_SHAPES[stack];
    const kind = layoutKind(stack);
    const sameKind = stacks.filter((candidate) => layoutKind(candidate) === kind).length;
    const proposed = stacks.length === 1 ? '.' : kind
      ? `apps/${kind}${sameKind > 1 ? `-${stack.replace(/^[^-]+-/, '')}` : ''}`
      : `${shape.area}/${stack}`;
    return {stack, root: roots.get(stack) ?? proposed, shape};
  });
  for (let i = 0; i < units.length; i++) {
    for (let j = i + 1; j < units.length; j++) {
      const a = units[i].root; const b = units[j].root;
      if (a === '.' || b === '.' || a === b || a.startsWith(`${b}/`) || b.startsWith(`${a}/`)) {
        throw usageError('Layout roots overlap. Record an explicit project boundary decision before changing the layout.');
      }
    }
  }
  return units;
}

/** Reuse recorded roots on sync; malformed records must not trigger an implicit relocation. */
export function resolveGreenfieldDevelopmentUnits(config, scan) {
  const indexPath = 'docs/ai/development/index.json';
  if ((scan?.files ?? []).some((file) => file.type === 'link' && (file.relative === indexPath || indexPath.startsWith(`${file.relative}/`)))) {
    throw usageError('Recorded layout index must not traverse a symbolic link.');
  }
  const index = scan?.files?.find((file) => file.relative === indexPath);
  if (!index) {
    const proposed = greenfieldDevelopmentUnits(config);
    const retained = proposed.map((unit) => {
      const legacy = `${unit.shape.area}/${unit.stack}`;
      const found = (scan?.files ?? []).some((file) => file.type === 'file' && file.relative.startsWith(`${legacy}/`));
      if (!found || (config.developmentUnits ?? []).some((saved) => saved.stack === unit.stack)) return unit;
      const newRootExists = unit.root !== legacy && unit.root !== '.'
        && (scan?.files ?? []).some((file) => file.type === 'file' && file.relative.startsWith(`${unit.root}/`));
      if (newRootExists) throw usageError('Multiple layout roots found for one stack. Record the intended boundary before regeneration.');
      return {...unit, root: legacy};
    });
    return greenfieldDevelopmentUnits({...config, developmentUnits: retained});
  }
  if (index.type !== 'file' || index.contentScannable === false || !index.absolute) throw usageError('Recorded layout index must be a regular file.');
  let document;
  try { document = JSON.parse(readText(index.absolute)); }
  catch { throw usageError('Recorded layout index cannot be read. Repair it before regenerating the layout.'); }
  if (!Array.isArray(document.units)) throw usageError('Recorded layout index must contain units.');
  return greenfieldDevelopmentUnits({...config, developmentUnits: document.units});
}

export function buildGreenfieldLayoutArtifacts(config, scan) {
  if (config.initialization?.lifecycle !== 'greenfield') return { units: [], artifacts: [] };
  const units = resolveGreenfieldDevelopmentUnits(config, scan);
  const unresolvedStacks = [...new Set(config.stacks)].filter((stack) => !STACK_SHAPES[stack]);
  if (units.length === 0) return { units: [], artifacts: [] };
  const multi = units.length > 1;
  const adapterDirs = selectedSkillDirectories(config.clients ?? []);
  const artifacts = [{
    path: 'docs/ai/development/index.json',
    content: stableJson({ schemaVersion: 1, status: 'design-awaiting-implementation', unresolvedStacks, crossProjectContractPolicy: multi ? 'docs/development/cross-project-contracts.md' : null, units: units.map(({ stack, root, shape }) => ({ stack, path: root, coverage: shape.coverage, documentation: root === '.' ? 'docs/development/README.md' : `docs/development/units/${stack}.md` })) }),
    ownership: 'full', kind: 'greenfield-development-index', source: 'selected-stacks',
  }];
  artifacts.push({
    path: SHARED_ARCHITECTURE,
    content: config.artifactLanguage === 'zh-CN' ? '# 共享架构指南\n\n状态：待采纳的方案，尚需实现证据。\n\n- 业务模块拥有自己的状态、公共接口和测试；通过公共契约协作，模块不反向依赖组合入口。\n- 根据实际职责分离业务规则、用例编排、传输和外部副作用。小模块可以只有少量文件；不要生成空的 domain/application/infrastructure 目录。\n- 仅为实际扩展需求添加插件代码。定义兼容性和生命周期契约，验证注册、失败隔离、卸载及不兼容版本。\n- 实现前明确公共输入、输出、错误和兼容策略。验证生产者与消费者，包括非法输入和异步结果的身份一致性。\n- 从实际构建清单确认框架版本及构建、测试命令。记录负责人采纳决定、测试和独立评审，不把目录存在当作生产质量证据。\n' : '# Shared architecture guidance\n\nStatus: proposal awaiting adoption and implementation evidence.\n\n- A business module owns its state, public interface, and tests. Collaborate through public contracts; modules do not import the composition root.\n- Separate business rules, orchestration, transport, and external effects where those responsibilities exist. Small modules may use a few files; do not generate empty domain/application/infrastructure folders.\n- Add plugin code only for an implemented extension use case. Define compatibility and lifecycle contracts and test registration, failure isolation, unloading, and incompatible versions.\n- Define public inputs, outputs, errors, and compatibility before implementation. Verify both producer and consumer, including rejected inputs and asynchronous result identity.\n- Confirm real framework versions and build/test commands from manifests. Record owner adoption, tests, and independent review without treating directory presence as production evidence.\n',
    ownership: 'seed', kind: 'greenfield-shared-architecture', source: 'selected-stacks',
  });
  if (multi) artifacts.push({
    path: 'docs/development/cross-project-contracts.md',
    content: `# Cross-project contract policy\n\nStatus: design proposal awaiting owner adoption and implementation evidence.\n\n- One owning service or shared protocol package owns each public schema. Consumers do not fork DTO definitions silently.\n- Record contract ID, owning project, version, compatibility decision, producer, consumers, and error semantics before implementation.\n- Keep schemas in a versioned contract directory selected by the owner; generated clients remain derived artifacts.\n- For every contract change, test producer conformance and each consumer against the same schema and include backward-compatibility cases.\n- A cross-project feature is one work unit with coordinated page, API, service, data, migration, and test evidence.\n- Changing the protocol requires a user-approved plan, relevant stack specialists, and an independent reviewer; record test results and unresolved gaps.\n`,
    ownership: 'seed', kind: 'greenfield-cross-project-contract-policy', source: 'selected-stacks',
  });
  for (const { stack, root, shape } of units) {
    const prefix = root === '.' ? '' : `${root}/`;
    const doc = root === '.' ? 'docs/development/README.md' : `docs/development/units/${stack}.md`;
    const architecture = `${prefix}docs/ai/rules/architecture.md`;
    artifacts.push({ path: doc, content: architectureDoc(stack, shape, root, multi, config.artifactLanguage), ownership: 'seed', kind: 'greenfield-development-document', source: 'selected-stacks' });
    const compositionRoot = `${shape.source}/${stack === 'backend-java' ? '<base-package>/' : ''}${shape.entry}/`;
    artifacts.push({ path: architecture, content: config.artifactLanguage === 'zh-CN'
      ? `# ${shape.runtime} 架构规则\n\n按任务加载开发 Skills；人读设计集中在 docs/development。组合入口放在 \`${compositionRoot}\`；仅为实际职责添加层级或插件。\n`
      : `# ${shape.runtime} architecture rule\n\nFollow task-selected implementation Skills. The human design is in the central docs/development guide. Keep composition in \`${compositionRoot}\`; add optional layers and plugins only for implemented responsibilities.\n`, ownership: 'seed', kind: 'greenfield-architecture-rule', source: 'selected-stacks' });
    const skillPath = `${prefix}docs/ai/skills/${stack}-architecture/SKILL.md`;
    const skill = stackSkill(stack, shape, doc, config.artifactLanguage);
    artifacts.push({ path: skillPath, content: skill, ownership: 'seed', kind: 'greenfield-stack-skill', source: 'selected-stacks' });
    for (const directory of adapterDirs) artifacts.push({ path: `${prefix}${directory}/${stack}-architecture/SKILL.md`, content: skillAdapterContent(skillPath, skill), ownership: 'seed', kind: 'greenfield-stack-adapter-skill', source: skillPath });
    if (multi) artifacts.push({ path: `${prefix}AGENTS.md`, content: `# ${shape.runtime} project\n\nRead \`${doc}\`, \`${architecture}\`, and \`${prefix}docs/ai/skills/${stack}-architecture/SKILL.md\` before changing this project. Treat the layout as a proposal until owner adoption and implementation evidence are recorded. Follow the root governance policy.\n`, ownership: 'seed', kind: 'greenfield-unit-entrypoint', source: 'selected-stacks' });
    if (stack === 'backend-java') artifacts.push({
      path: `${prefix}${shape.source}/README.md`,
      content: config.artifactLanguage === 'zh-CN'
        ? '# Java 源码\n\n由项目选择基础包并按包名建立目录层级。将 application、modules、shared 放在基础包下面，按实际职责添加内容；不要创建字面 `<base-package>` 目录或顶层包占位。\n'
        : '# Java source\n\nChoose the project base package and map its name to directory segments. Place application, modules, and shared under that package as responsibilities are implemented. Do not create a literal `<base-package>` directory or top-level package placeholders.\n',
      ownership: 'seed', kind: 'greenfield-directory-design', source: 'selected-stacks',
    });
    for (const section of stack === 'backend-java' ? [] : [shape.entry, 'modules', 'shared']) artifacts.push({ path: `${prefix}${shape.source}/${section}/README.md`, content: `# ${section}\n\n${section === 'modules' ? 'Create one bounded business module per directory. Add layers only when actual responsibilities need them; keep tests with their owner.' : section === 'shared' ? 'Keep only stable cross-module primitives here; business rules belong to modules.' : 'Compose implemented modules, adapters, and routes here.'}\n`, ownership: 'seed', kind: 'greenfield-directory-design', source: 'selected-stacks' });
  }
  return { units, artifacts };
}

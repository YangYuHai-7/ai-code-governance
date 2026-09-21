import path from 'node:path';
import { GENERATED_MARKER } from '../../constants.mjs';
import { usageError } from '../../kernel/index.mjs';
import { selectedSkillDirectories } from '../../catalogs/index.mjs';
import { normalizeRelative, sha256, skillAdapterContent, stableJson } from '../../shared/index.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';

const MANIFEST_NAMES = new Set([
  'package.json', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle',
  'settings.gradle.kts', 'pyproject.toml', 'go.mod', 'go.work', 'composer.json',
  'Cargo.toml',
]);
const CODE_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cs', '.cjs', '.cts', '.dart', '.go', '.h', '.hpp', '.java',
  '.js', '.jsx', '.kt', '.kts', '.mjs', '.mts', '.php', '.py', '.rb', '.rs', '.svelte',
  '.swift', '.ts', '.tsx', '.vue',
]);
const TEST_PATH = /(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/i;
const ENTRY_PATH = /(^|\/)(?:main|index|app|server|application|bootstrap)\.[^/]+$/i;

function isManifest(relative) {
  const basename = path.posix.basename(relative);
  return MANIFEST_NAMES.has(basename) || /\.csproj$/i.test(basename);
}

function within(relative, unitPath) {
  return unitPath === '.' || relative === unitPath || relative.startsWith(`${unitPath}/`);
}

function unitId(unitPath) {
  return unitPath === '.' ? 'root' : `${unitPath.replaceAll('/', '-').replace(/[^a-zA-Z0-9_-]/g, '-').toLowerCase()}-${sha256(unitPath).slice(0, 8)}`;
}

function docPath(unitPath, id) {
  return unitPath === '.' ? 'docs/ai/development/root.md' : `docs/ai/development/units/${id}.md`;
}

function readmePath(unitPath) {
  return unitPath === '.' ? 'README.md' : `${unitPath}/README.md`;
}

function deepestOwner(relative, roots) {
  return roots.filter((root) => within(relative, root)).sort((left, right) => right.length - left.length)[0] ?? '.';
}

/**
 * A repository with neither code nor a build manifest has no development unit worth
 * documenting. Repository-family orchestrator parents and documentation-only
 * repositories fall here: generating development documents for them produces
 * placeholder pages that describe the absence of the code they are meant to explain.
 */
export function hasDocumentableDevelopmentUnit(scan) {
  return scan.files.some((file) => file.type === 'file' && file.contentScannable !== false
    && (CODE_EXTENSIONS.has(path.posix.extname(file.relative).toLowerCase()) || isManifest(file.relative)));
}

const MAVEN_AGGREGATOR = /<packaging>\s*pom\s*<\/packaging>/i;
const MAVEN_MODULES = /<modules>([\s\S]*?)<\/modules>/i;
const MAVEN_MODULE = /<module>\s*([^<]+?)\s*<\/module>/gi;

/**
 * A Maven aggregator declares its own modules in one pom. Those modules are build units
 * of a single project, not independent governance units: giving each one its own entry
 * file, development rule, and development Skill emits several files that all say the same
 * thing. The aggregator becomes one unit and its declared modules become the child
 * inventory inside that unit's document, so the file list shrinks without losing which
 * module holds which source files.
 */
function mavenAggregatorChildren(file) {
  if (!file.absolute || path.posix.basename(file.relative) !== 'pom.xml') return null;
  let content;
  try { content = readText(file.absolute); }
  catch { return null; }
  if (!MAVEN_AGGREGATOR.test(content)) return null;
  const block = content.match(MAVEN_MODULES);
  if (!block) return null;
  const declared = [...block[1].matchAll(MAVEN_MODULE)].map((match) => match[1].trim()).filter(Boolean);
  if (declared.length === 0) return null;
  const base = normalizeRelative(path.posix.dirname(file.relative) || '.');
  return declared.map((entry) => normalizeRelative(path.posix.join(base === '.' ? '' : base, entry)));
}

export function discoverDevelopmentUnits(scan) {
  const manifestFiles = scan.files.filter((file) => file.type === 'file' && isManifest(file.relative));
  const manifests = manifestFiles.map((file) => normalizeRelative(file.relative));
  const codeFiles = scan.files.filter((file) => file.type === 'file' && file.contentScannable !== false && CODE_EXTENSIONS.has(path.posix.extname(file.relative).toLowerCase())).map((file) => normalizeRelative(file.relative));
  const roots = new Set(manifests.map((relative) => path.posix.dirname(relative) || '.'));
  if (codeFiles.length && (!roots.size || codeFiles.some((relative) => deepestOwner(relative, [...roots]) === '.'))) roots.add('.');
  if (!roots.size) roots.add('.');
  if (roots.size > 128) throw usageError('More than 128 development units were detected. Define narrower repository boundaries before generating development documentation.');

  const childrenByContainer = new Map();
  const absorbed = new Set();
  for (const file of manifestFiles) {
    const declared = mavenAggregatorChildren(file);
    if (!declared) continue;
    const container = normalizeRelative(path.posix.dirname(file.relative) || '.');
    const children = declared.filter((child) => roots.has(child) && child !== container);
    if (children.length === 0) continue;
    childrenByContainer.set(container, [...new Set([...(childrenByContainer.get(container) ?? []), ...children])].sort((left, right) => left.localeCompare(right)));
    for (const child of children) absorbed.add(child);
  }

  const orderedRoots = [...roots].filter((root) => !absorbed.has(root)).sort((left, right) => left.localeCompare(right));
  return orderedRoots.map((root) => {
    const ownedCode = codeFiles.filter((relative) => deepestOwner(relative, orderedRoots) === root);
    const ownedManifests = manifests.filter((relative) => path.posix.dirname(relative) === root);
    const stackIds = scan.stacks.filter((stack) => (stack.paths ?? []).some((relative) => within(relative, root))).map((stack) => stack.id);
    const commands = scan.commands.filter((command) => (command.verification?.cwd ?? command.cwd ?? '.') === root).map((command) => ({
      id: command.verification?.id ?? command.id ?? command.name,
      command: command.command ?? command.verification?.argv?.join(' ') ?? null,
      trust: command.verification?.trust?.level ?? 'declared',
    }));
    const productionCode = ownedCode.filter((relative) => !TEST_PATH.test(relative));
    return {
      id: unitId(root),
      path: root,
      documentation: docPath(root, unitId(root)),
      readme: readmePath(root),
      manifests: ownedManifests,
      stacks: stackIds.length ? stackIds : scan.stacks.map((stack) => stack.id),
      sourceFileCount: ownedCode.length,
      // Test files are listed once, under test evidence. Repeating them in source evidence
      // made every unit document look twice as large as the code it describes.
      sourceFiles: productionCode.slice(0, 80),
      sourceInventoryTruncated: productionCode.length > 80,
      entrypointCandidates: productionCode.filter((relative) => ENTRY_PATH.test(relative)).slice(0, 24),
      testFiles: ownedCode.filter((relative) => TEST_PATH.test(relative)).slice(0, 40),
      commands,
      children: (childrenByContainer.get(root) ?? []).map((childPath) => {
        const childCode = codeFiles.filter((relative) => within(relative, childPath));
        const childProduction = childCode.filter((relative) => !TEST_PATH.test(relative));
        return {
          path: childPath,
          manifests: manifests.filter((relative) => path.posix.dirname(relative) === childPath),
          sourceFileCount: childCode.length,
          sourceFiles: childProduction.slice(0, 40),
          entrypointCandidates: childProduction.filter((relative) => ENTRY_PATH.test(relative)).slice(0, 12),
          testFiles: childCode.filter((relative) => TEST_PATH.test(relative)).slice(0, 20),
        };
      }),
    };
  });
}

function bullets(values, empty) {
  return values.length ? values.map((value) => `- \`${value}\``).join('\n') : `- ${empty}`;
}

function commandBullets(commands, empty) {
  return commands.length ? commands.map((command) => `- \`${command.command ?? command.id}\` — trust: \`${command.trust}\``).join('\n') : `- ${empty}`;
}

/**
 * Aggregator modules are inventoried inside the owning unit document instead of each
 * receiving a full generated set. The information an agent needs to locate a module's
 * source survives; the duplicate entrypoints do not.
 */
function childInventory(unit, zh) {
  if (!unit.children?.length) return '';
  const separator = zh ? '、' : ', ';
  const header = zh ? '## 子模块清单' : '## Module inventory';
  const note = zh
    ? '下列模块属于同一个聚合构建，因此共享本单元的开发文档、规则和入口，不再各自生成重复文件。改动某个模块前，先在这里定位它的源码。'
    : "These modules belong to one aggregator build, so they share this unit's document, rule, and entrypoint instead of each emitting a duplicate set. Locate a module's source here before changing it.";
  const labels = zh
    ? { manifests: '构建清单', sources: '源文件数量', entries: '入口点候选', tests: '测试文件' }
    : { manifests: 'Build manifests', sources: 'Source files', entries: 'Entrypoint candidates', tests: 'Test files' };
  const list = (values, empty) => (values.length ? values.map((value) => `\`${value}\``).join(separator) : empty);
  const blocks = unit.children.map((child) => `### \`${child.path}\`

- ${labels.manifests}: ${list(child.manifests, zh ? '未检测到' : 'not detected')}
- ${labels.sources}: ${child.sourceFileCount}
- ${labels.entries}: ${list(child.entrypointCandidates, zh ? '未通过文件名确认' : 'not confirmed by filename')}
- ${labels.tests}: ${list(child.testFiles, zh ? '未通过路径识别' : 'not recognized by path')}`).join('\n\n');
  return `\n${header}\n\n${note}\n\n${blocks}\n`;
}

function developmentDocument(unit, config) {
  const zh = config.artifactLanguage === 'zh-CN';
  const title = unit.path === '.' ? config.projectName : unit.path;
  if (zh) return `# ${title} 开发文档

<!-- ${GENERATED_MARKER} -->

> 状态：代码扫描生成的理解基线。路径和清单是观察事实；职责、契约与业务语义必须由 AI 阅读代码和测试后补全，并保留证据引用。

## 子工程边界

- ID：\`${unit.id}\`
- 路径：\`${unit.path}\`
- 技术栈候选：${unit.stacks.map((item) => `\`${item}\``).join('、') || '未识别'}
- 源文件数量：${unit.sourceFileCount}${unit.sourceInventoryTruncated ? '（下列清单已截断）' : ''}

## 构建清单

${bullets(unit.manifests, '未检测到构建清单。')}
${childInventory(unit, true)}
## 入口点候选

${bullets(unit.entrypointCandidates, '未通过文件名确认入口点；需要阅读框架配置和调用链。')}

## 源码证据

${bullets(unit.sourceFiles, '未检测到可扫描源码。')}

## 测试证据

${bullets(unit.testFiles, '未通过路径识别测试文件；不代表项目没有测试。')}

## 已发现验证命令

${commandBullets(unit.commands, '当前扫描未发现属于本子工程的可信命令；执行前必须从项目配置确认。')}

## 待 AI 依据代码补全

1. 职责、边界和主要调用链，并为每项结论引用源码或测试路径。
2. 对外契约、数据模型、状态变化、副作用、权限与错误语义。
3. 本地运行、构建、调试和验证步骤；禁止把未经执行的命令写成已验证事实。
4. 已存在的编码约定，以及可复用为 Skill 的稳定决策面。
5. 正确与错误实现形状；只有代码证据支持时才提供项目专属示例。

## 未验证与缺口

- 本文不会从文件名推断业务规则。
- 未阅读或未执行的行为必须标记为未验证。
- 代码、测试与负责人决策冲突时，记录证据并请求决定。
`;
  return `# ${title} development documentation

<!-- ${GENERATED_MARKER} -->

> Status: code-scan understanding baseline. Paths and manifests are observed facts. An AI must read code and tests before completing responsibilities, contracts, and business semantics, with evidence references retained.

## Development-unit boundary

- ID: \`${unit.id}\`
- Path: \`${unit.path}\`
- Candidate stacks: ${unit.stacks.map((item) => `\`${item}\``).join(', ') || 'unidentified'}
- Source files: ${unit.sourceFileCount}${unit.sourceInventoryTruncated ? ' (inventory below is truncated)' : ''}

## Build manifests

${bullets(unit.manifests, 'No build manifest was detected.')}
${childInventory(unit, false)}
## Entrypoint candidates

${bullets(unit.entrypointCandidates, 'No entrypoint was confirmed by filename; inspect framework configuration and call paths.')}

## Source evidence

${bullets(unit.sourceFiles, 'No scannable source file was detected.')}

## Test evidence

${bullets(unit.testFiles, 'No test file was recognized by path; this does not prove that tests are absent.')}

## Discovered verification commands

${commandBullets(unit.commands, 'No trusted command was attributed to this unit; confirm project configuration before execution.')}

## AI completion required from code evidence

1. Responsibilities, boundaries, and primary call paths, citing source or test paths for every conclusion.
2. Public contracts, data models, state changes, side effects, authorization, and error semantics.
3. Local run, build, debug, and verification steps; never present an unexecuted command as verified.
4. Existing coding conventions and stable decision surfaces suitable for reusable Skills.
5. Correct and incorrect implementation shapes only when project code supports the examples.

## Unverified areas and gaps

- This document never infers business rules from filenames.
- Unread or unexecuted behavior must remain explicitly unverified.
- When code, tests, and owner decisions conflict, record the evidence and request a decision.
`;
}

function readmeBlock(unit, config) {
  const relativeDoc = unit.path === '.' ? unit.documentation : path.posix.relative(unit.path, unit.documentation);
  if (config.artifactLanguage === 'zh-CN') return `## AI 开发入口

- 本子工程开发文档：[\`${relativeDoc}\`](${relativeDoc})
- 修改前先核对开发文档中的证据、未验证项和验证命令。
- 稳定的实现决策应进入项目 Skill；一次性事实留在开发文档中。
`;
  return `## AI development entrypoint

- Development documentation for this unit: [\`${relativeDoc}\`](${relativeDoc})
- Before changing code, reconcile the evidence, unverified areas, and verification commands in that document.
- Put stable implementation decisions in project Skills; keep one-off facts in the development document.
`;
}

function unitRule(unit) {
  return `# ${unit.path} development rule

Read \`${unit.documentation}\` before changing this unit. Treat scanner facts as leads until the cited source and tests have been reviewed. Keep changes inside the unit's public boundary, document contract and business behavior in the owning Memory page, run a relevant trusted verification command, and record the actual result. Do not promote inferred conventions or unverified behavior into a project Skill.
`;
}

function unitSkill(unit) {
  return `---
name: development-${unit.id}
description: Use when changing the ${unit.path} development unit or its public contract.
---

# ${unit.path} development

## When to use

- A task changes source, tests, contracts, or build behavior owned by this unit.

## When not to use

- Do not apply this unit's conventions to another unit or treat a scanner baseline as verified business knowledge.

## Evidence and prerequisites

- Read \`${unit.documentation}\`, its cited source and tests, and the owning records in \`docs/memory/INDEX.json\`.
- Candidate stacks: ${unit.stacks.map((stack) => `\`${stack}\``).join(', ') || 'unidentified'}; confirm actual versions from the build manifests.

## Required invariants

- Attribute every project-specific conclusion to a concrete source, test, contract, or owner decision.
- Keep one owning development unit and Memory page for each verified business behavior.
- New stable Skill content remains a candidate until the user approves it.

## Decision flow

1. Confirm the unit boundary and entrypoints from code evidence.
2. State the affected contract, behavior, and acceptance cases before implementation.
3. Ask for user confirmation before applying business-code changes.
4. Keep the implementation within one owner where possible; update the development document and Memory for verified behavior changes.
5. Run a trusted unit command or record why execution is blocked, then write a test result report.
6. Propose any new stable Skill content as a candidate; add it only after the user approves it.

## Exceptions and escalation

- If scanner coverage is incomplete or sources disagree, record a gap and ask for a decision before adding behavior claims.
- Public contracts, migrations, security, external actions, and cross-unit changes follow the stronger L2/L3 plan and review route.

## Verification matrix

| Scenario | Expected result | Command or evidence status |
| --- | --- | --- |
| Unit understanding | Every claim cites inspected source or test paths | Manual evidence review; unverified until completed |
| Behavior change | Development document and owning Memory remain aligned with current code | \`aicg check .\` plus project tests when discovered |
| New reusable Skill | One stable decision surface, explicit trigger, counterexample, and owner approval | Skill quality audit; candidate until approved |

## Project evidence boundary

- Current project-specific behavior remains unverified until the development document cites reviewed code or tests. A process exit alone does not prove the business meaning.

## Sources

- \`${unit.documentation}\`, its indexed build manifests, source inventory, tests, and owner-confirmed decisions.
- \`docs/memory/INDEX.json\` and each owning module page for verified business behavior.
`;
}

function understandingSkill(config) {
  const zh = config.artifactLanguage === 'zh-CN';
  const content = `---
name: brownfield-understanding
description: ${zh ? '理解已有项目、补全各子工程开发文档、同步 README，并从代码证据提取稳定项目 Skill 时使用。' : 'Use when understanding an existing project, completing per-unit development docs, synchronizing READMEs, and extracting stable project Skills from code evidence.'}
---

# ${zh ? '旧项目理解与知识提取' : 'Brownfield understanding and knowledge extraction'}

<!-- ${GENERATED_MARKER} -->

## When to use

- ${zh ? '首次理解已有代码库或新的子工程。' : 'First-time understanding of an existing codebase or a newly discovered development unit.'}
- ${zh ? '代码变更使开发文档、README 或项目 Skill 可能过期。' : 'Code changes may make development documentation, README guidance, or project Skills stale.'}

## When not to use

- ${zh ? '不要用扫描结果代替业务负责人确认。' : 'Do not use scanner output as a substitute for owner-confirmed business meaning.'}
- ${zh ? '不要把一次性实现细节或未验证推断提升为 Skill。' : 'Do not promote one-off implementation detail or unverified inference into a Skill.'}

## Evidence and prerequisites

- ${zh ? '先读取 `docs/ai/development/index.json`，然后一次只处理一个子工程文档和它引用的最小代码集合。' : 'Read `docs/ai/development/index.json`, then process one unit document and its minimal referenced code set at a time.'}
- ${zh ? '代码、测试、构建清单、契约和负责人决策是证据；目录名与框架惯例只是线索。' : 'Code, tests, manifests, contracts, and owner decisions are evidence; directory names and framework conventions are only leads.'}

## Required invariants

- ${zh ? '每个已发现子工程保持独立开发文档，结论引用具体代码或测试路径。' : 'Keep one development document per discovered unit and cite concrete code or test paths for conclusions.'}
- ${zh ? 'README 只保留短入口和高价值摘要，不复制整份开发文档。' : 'Keep README content to a short entrypoint and high-value summary; do not duplicate the whole development document.'}
- ${zh ? '项目 Skill 只表达稳定、可复用且有证据的决策面，并明确触发与非触发条件。' : 'A project Skill covers only a stable, reusable, evidence-backed decision surface with explicit triggers and non-triggers.'}
- ${zh ? '实现型 Skill 必须包含正确、错误和例外代码形状；工作流 Skill 必须包含可执行流程。' : 'Implementation Skills require correct, incorrect, and exception code shapes; workflow Skills require an executable flow.'}
- ${zh ? '未知内容保持 `unverified` 或 gap，不得补写成事实。' : 'Unknown content remains `unverified` or a gap and is never completed as fact.'}

## Decision flow

1. ${zh ? '从索引选择一个子工程，读取清单、入口候选、源码和测试证据。' : 'Select one unit from the index and inspect its manifests, entrypoint candidates, source, and test evidence.'}
2. ${zh ? '用代码路径补全职责、调用链、契约、数据、状态、副作用与验证方式，区分观察事实和推断。' : 'Complete responsibilities, call paths, contracts, data, state, side effects, and verification with code citations, separating facts from inference.'}
3. ${zh ? '更新该子工程 README 的短摘要；保留受管区块外的人工内容。' : 'Update the unit README summary while preserving human content outside the managed block.'}
4. ${zh ? '把重复出现且稳定的决策聚类为单一决策面的 Skill；代码示例必须来自去业务化的已验证形状。' : 'Cluster repeated stable decisions into one-decision-surface Skills; code examples must use neutralized, verified shapes.'}
5. ${zh ? '运行文档列出的可信命令和 `aicg check .`，记录失败、未执行项和剩余缺口。' : 'Run trusted commands named by the document plus `aicg check .`, recording failures, unexecuted checks, and residual gaps.'}

## Executable worked flow

1. ${zh ? '打开索引并选择一个 `id`。' : 'Open the index and select one `id`.'}
2. ${zh ? '加载该记录的 `documentation`，再按文档引用只读取必要的源码、测试与构建清单。' : 'Load that record\'s `documentation`, then read only the source, tests, and manifests referenced by the document.'}
3. ${zh ? '逐项补全开发文档，以“已核对的业务行为”和“本地开发流程”为标题，每个结论附路径；不确定项写入缺口。' : 'Complete each document with Evidence-reviewed behavior and Local development workflow sections, citing paths for every conclusion and putting uncertainty in gaps.'}
4. ${zh ? '把现有业务行为及代码证据写入 docs/memory/INDEX.json 和所属模块页；同步 README。如发现稳定规则，通过项目 Skill 发现和批准流程登记。' : 'Record existing business behavior and source evidence in docs/memory/INDEX.json and owning module pages; synchronize README. Register stable rules through project Skill discovery and approval.'}
5. ${zh ? '运行验证，记录证据，再处理下一个子工程。' : 'Run verification, record evidence, then continue with the next unit.'}

## Exceptions and escalation

- ${zh ? '扫描不完整、清单无效或代码边界重叠时，停止自动归纳并报告精确缺口。' : 'When scanning is incomplete, manifests are invalid, or code boundaries overlap, stop automatic synthesis and report the exact gap.'}
- ${zh ? '涉及迁移、删除、生产访问或业务规则改变时，需要单独授权。' : 'Migration, deletion, production access, and business-rule changes require separate authorization.'}

## Verification matrix

| Scenario | Expected result | Command or evidence status |
| --- | --- | --- |
| Unit inventory | Every indexed unit has one development document and README entrypoint | \`aicg check .\` plus index/path reconciliation |
| Evidence quality | Every behavioral statement cites code, test, contract, or owner evidence | Manual evidence review; otherwise mark unverified |
| Skill extraction | Each promoted Skill has one decision surface and required examples or executable flow | Run the repository Skill quality audit |

## Project evidence boundary

- ${zh ? '生成的基线证明文件被扫描，不证明行为已理解或运行。' : 'A generated baseline proves files were scanned, not that behavior was understood or executed.'}
- ${zh ? 'README 与 Skill 必须随已验证代码变化更新；历史描述不能覆盖当前代码证据。' : 'README and Skills follow verified code changes; historical prose never overrides current code evidence.'}

## Sources

- ${zh ? '当前仓库的代码扫描清单、构建清单、源码、测试和已确认负责人决策。' : 'The current repository scan inventory, build manifests, source, tests, and confirmed owner decisions.'}
- ${zh ? '每项项目专属结论必须在对应开发文档中引用具体路径。' : 'Every project-specific conclusion must cite concrete paths in the corresponding development document.'}
`;
  return content;
}

export function buildDevelopmentDocumentationArtifacts(config, scan) {
  const units = discoverDevelopmentUnits(scan);
  const adapterDirs = selectedSkillDirectories(config.clients ?? []);
  const index = {
    schemaVersion: 1,
    status: scan.scanBudget?.complete ? 'scanned-baseline' : 'incomplete-scan',
    boundary: 'Scanner evidence is a baseline. Behavioral meaning requires code review and verification.',
    units: units.map(({ id, path: unitPath, documentation, readme, manifests, stacks, children }) => ({
      id, path: unitPath, documentation, readme, manifests, stacks,
      modules: (children ?? []).map((child) => child.path),
    })),
  };
  const artifacts = [{
    path: 'docs/ai/development/index.json', content: stableJson(index), ownership: 'full',
    kind: 'development-documentation-index', source: 'repository-code-scan',
  }];
  for (const unit of units) {
    artifacts.push({ path: unit.documentation, content: developmentDocument(unit, config), ownership: 'seed', kind: 'development-documentation', source: 'repository-code-scan' });
    artifacts.push({ path: unit.readme, content: readmeBlock(unit, config), ownership: 'managed-block', kind: 'development-readme', source: 'repository-code-scan' });
    const localRoot = unit.path === '.' ? 'docs/ai' : `${unit.path}/docs/ai`;
    artifacts.push({ path: `${localRoot}/rules/development.md`, content: unitRule(unit), ownership: 'seed', kind: 'development-unit-rule', source: unit.documentation });
    const skillPath = `${localRoot}/skills/development-${unit.id}/SKILL.md`;
    const skill = unitSkill(unit);
    artifacts.push({ path: skillPath, content: skill, ownership: 'seed', kind: 'development-unit-skill', source: unit.documentation });
    const prefix = unit.path === '.' ? '' : `${unit.path}/`;
    // `source` names the artifact this one is derived from, so adapters mirror the unit's
    // documentation page exactly like the rule, canonical Skill and entrypoint do. Recording
    // the mirrored Skill path here instead made the manifest unresolvable for the adapter
    // case in the trust table, which silently disabled `aicg sync --prune`.
    for (const directory of adapterDirs) artifacts.push({ path: `${prefix}${directory}/development-${unit.id}/SKILL.md`, content: skillAdapterContent(skillPath, skill), ownership: 'full', kind: 'development-unit-adapter-skill', source: unit.documentation });
    if (unit.path !== '.') artifacts.push({ path: `${unit.path}/AGENTS.md`, content: `# ${unit.path} development\n\nRead \`${unit.documentation}\`, \`${localRoot}/rules/development.md\`, and \`${localRoot}/skills/development-${unit.id}/SKILL.md\` before changes. Follow root governance and record verified business behavior in Memory.\n`, ownership: 'managed-block', kind: 'development-unit-entrypoint', source: unit.documentation });
  }
  const skill = understandingSkill(config);
  const canonical = 'docs/ai/skills/brownfield-understanding/SKILL.md';
  artifacts.push({ path: canonical, content: skill, ownership: 'full', kind: 'brownfield-understanding-skill', source: 'repository-code-scan' });
  const adapter = skillAdapterContent(canonical, skill);
  for (const directory of adapterDirs) artifacts.push({ path: `${directory}/brownfield-understanding/SKILL.md`, content: adapter, ownership: 'full', kind: 'brownfield-understanding-adapter-skill', source: canonical });
  return { units, index, artifacts };
}

import path from 'node:path';
import { GENERATED_MARKER, PACKAGE_ROOT } from '../../constants.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { selectedSkillDirectories } from '../../catalogs/index.mjs';
import { skillAdapterContent, stableJson, unique } from '../../shared/index.mjs';
import { assertSkillQuality } from './skill-quality.mjs';
import { canonicalPath } from '../governance/index.mjs';

const REGISTRY_PATH = 'assets/registries/technical-standard-registry.json';
const STANDARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const ECOSYSTEM = /^[a-z0-9][a-z0-9._-]*$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asSortedStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.length > 0))].sort((left, right) => left.localeCompare(right));
}

function sourceSnapshot(source) {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
    retrievedAt: source.retrievedAt,
  };
}

const IMPLEMENTATION_EXAMPLES = {
  'spring-http-contracts': {
    language: 'java',
    correct: `public record CreateItemRequest(@NotBlank String name) {}

@PostMapping("/items")
ItemResponse create(@Valid @RequestBody CreateItemRequest input) {
  return itemService.create(input);
}`,
    incorrect: `@PostMapping("/items")
Object create(@RequestBody Map<String, Object> input) {
  // Transport parsing, authorization, and persistence are mixed here.
  return mapper.insert(input);
}`,
  },
  'spring-service-transactions': {
    language: 'java',
    correct: `@Transactional
public Item changeState(ChangeItem command) {
  Item current = repository.require(command.id());
  policy.check(command.actor(), current);
  return repository.save(current.changeTo(command.targetState()));
}`,
    incorrect: `public Item changeState(ChangeItem command) {
  repository.updateState(command.id(), command.targetState());
  remoteAuditClient.send(command); // partial success can escape
  return repository.find(command.id());
}`,
  },
  'mybatis-persistence-boundaries': {
    language: 'java',
    correct: `public interface ItemMapper {
  Optional<ItemRow> findById(@Param("id") long id);
  int updateState(@Param("id") long id,
                  @Param("expected") String expected,
                  @Param("next") String next);
}`,
    incorrect: `public interface ItemMapper {
  // Raw maps hide required fields and optimistic-concurrency semantics.
  Map<String, Object> find(Map<String, Object> everything);
  void update(Map<String, Object> everything);
}`,
  },
  'vue-component-composition': {
    language: 'vue',
    correct: `<script setup lang="ts">
const props = defineProps<{ itemId: string }>()
const emit = defineEmits<{ saved: [id: string] }>()
const { state, save } = useItemEditor(() => props.itemId)
</script>`,
    incorrect: `<script setup>
// Global state, request ownership, and presentation are coupled.
window.currentItem = props.item
fetch('/items').then(r => r.json()).then(v => window.currentItem = v)
</script>`,
  },
  'vue-api-client-contracts': {
    language: 'typescript',
    correct: `export interface CreateItemInput { name: string }
export interface ItemDto { id: string; name: string }

export const createItem = (input: CreateItemInput, signal?: AbortSignal) =>
  http.post<ItemDto>('/items', input, { signal })`,
    incorrect: `export const createItem = (data: any) =>
  fetch('/items', { method: 'POST', body: JSON.stringify(data) })
    .then(response => response.json())`,
  },
  'pinia-state-routing': {
    language: 'typescript',
    correct: `export const useItemStore = defineStore('items', () => {
  const byId = ref<Record<string, ItemDto>>({})
  async function load(id: string) { byId.value[id] = await getItem(id) }
  return { byId, load }
})`,
    incorrect: `export const useItemStore = defineStore('items', {
  state: () => ({ route: router.currentRoute, dom: document.body }),
  actions: { go(id: string) { location.href = '/items/' + id } }
})`,
  },
  'taro-react-native-target-boundaries': {
    language: 'typescript',
    correct: `export interface DevicePort { readToken(): Promise<string | null> }

export function createDevicePort(platform: Platform): DevicePort {
  return platform === 'rn' ? new ReactNativeDevicePort() : new TaroDevicePort()
}`,
    incorrect: `export async function readToken() {
  // One implementation assumes every target exposes the same native global.
  return NativeModules.Device.token || Taro.getStorageSync('token')
}`,
  },
};

const GENERIC_IMPLEMENTATION_EXAMPLE = {
  language: 'text',
  correct: `function handle(request) {
  input = validate(request)        // transport -> validated contract
  return useCase(input)            // one use case owns the decision
}`,
  incorrect: `function handle(request) {
  row = persist(request)           // policy, persistence, and effects mixed
  return row                       // internal record exposed directly
}`,
};

export function validateTechnicalStandardRegistry(registry) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.standards)) {
    throw usageError('Technical standard registry must contain schemaVersion 1 and a standards array.');
  }
  const snapshot = registry.snapshot;
  if (!snapshot || snapshot.status !== 'reviewed-offline-snapshot' || !ISO_DATE.test(snapshot.reviewedAt ?? '') || !Number.isInteger(snapshot.refreshAfterDays) || snapshot.refreshAfterDays < 1 || typeof snapshot.boundary !== 'string' || !snapshot.boundary) {
    throw usageError('Technical standard registry must declare a reviewed offline snapshot and refresh boundary.');
  }
  const ids = new Set();
  const sourceIds = new Set();
  for (const standard of registry.standards) {
    if (!standard || !STANDARD_ID.test(standard.id ?? '')) throw usageError('Each technical standard needs a safe kebab-case id.');
    if (ids.has(standard.id)) throw usageError(`Technical standard registry contains duplicate id: ${standard.id}`);
    ids.add(standard.id);
    if (typeof standard.title !== 'string' || !standard.title) throw usageError(`Technical standard ${standard.id} needs a title.`);
    const applies = standard.appliesTo;
    if (applies?.packsAny !== undefined) throw usageError(`Technical standard ${standard.id} must use exact package selectors, not broad stack selectors.`);
    const packagesAny = asSortedStrings(applies?.packagesAny);
    const dependenciesAny = applies?.dependenciesAny ?? [];
    if (!applies || (applies.always !== true && packagesAny.length === 0 && dependenciesAny.length === 0)) {
      throw usageError(`Technical standard ${standard.id} needs an explicit applicability condition.`);
    }
    if (packagesAny.some((name) => !PACKAGE_NAME.test(name))) throw usageError(`Technical standard ${standard.id} has an invalid package selector.`);
    if (!Array.isArray(dependenciesAny) || dependenciesAny.some((entry) => !entry || !ECOSYSTEM.test(entry.ecosystem ?? '') || typeof entry.name !== 'string' || !entry.name || entry.name.length > 512)) {
      throw usageError(`Technical standard ${standard.id} has an invalid dependency selector.`);
    }
    if (dependenciesAny.some((entry, index) => dependenciesAny.findIndex((candidate) => candidate.ecosystem === entry.ecosystem && candidate.name === entry.name) !== index)) {
      throw usageError(`Technical standard ${standard.id} has duplicate dependency selectors.`);
    }
    if (!Array.isArray(standard.sources) || standard.sources.length === 0) throw usageError(`Technical standard ${standard.id} needs at least one source.`);
    for (const source of standard.sources) {
      if (!source || !STANDARD_ID.test(source.id ?? '') || typeof source.kind !== 'string' || !source.kind || typeof source.title !== 'string' || !source.title || !ISO_DATE.test(source.retrievedAt ?? '')) {
        throw usageError(`Technical standard ${standard.id} has an invalid source.`);
      }
      if (source.kind !== 'governance-principle' && !/^https:\/\//.test(source.url ?? '')) {
        throw usageError(`Technical standard ${standard.id} source ${source.id} must use an HTTPS URL.`);
      }
      if (sourceIds.has(source.id)) throw usageError(`Technical standard registry contains duplicate source id: ${source.id}`);
      sourceIds.add(source.id);
    }
    for (const field of ['practices', 'verification', 'boundaries']) {
      if (!Array.isArray(standard[field]) || standard[field].length === 0 || standard[field].some((item) => typeof item !== 'string' || !item)) {
        throw usageError(`Technical standard ${standard.id} needs non-empty ${field}.`);
      }
    }
  }
  return registry;
}

export function loadTechnicalStandardRegistry(registryPath = path.join(PACKAGE_ROOT, REGISTRY_PATH)) {
  return validateTechnicalStandardRegistry(readJson(registryPath));
}

function declaredPackages(config) {
  return asSortedStrings(config?.technologyPackages);
}

function detectedPackageNames(scan) {
  return asSortedStrings(Object.keys(scan.packageDependencies ?? {}));
}

function detectedDependencies(scan) {
  return (scan.dependencyFacts ?? []).map((fact) => ({
    ecosystem: fact.ecosystem,
    name: fact.name,
    sourcePath: fact.sourcePath,
    declaredVersion: fact.declaredVersion,
    resolvedVersion: fact.resolvedVersion,
  }));
}

function selectionReason(standard, installed, declared, dependencies) {
  if (standard.appliesTo.always) return { kind: 'always', evidence: ['governance-baseline'] };
  const installedMatches = asSortedStrings(standard.appliesTo.packagesAny).filter((name) => installed.includes(name));
  if (installedMatches.length > 0) return { kind: 'installed-package', evidence: installedMatches };
  const declaredMatches = asSortedStrings(standard.appliesTo.packagesAny).filter((name) => declared.includes(name));
  if (declaredMatches.length > 0) return { kind: 'declared-technology', evidence: declaredMatches };
  const dependencyMatches = (standard.appliesTo.dependenciesAny ?? []).flatMap((selector) => dependencies
    .filter((fact) => fact.ecosystem === selector.ecosystem && fact.name === selector.name)
    .map((fact) => `${fact.ecosystem}:${fact.name}@${fact.sourcePath}`));
  if (dependencyMatches.length > 0) return { kind: 'installed-dependency', evidence: asSortedStrings(dependencyMatches) };
  return null;
}

export function selectTechnicalStandards(scan, config, registry = loadTechnicalStandardRegistry()) {
  const installedPackages = detectedPackageNames(scan);
  const configuredPackages = declaredPackages(config);
  const dependencies = detectedDependencies(scan);
  const stackIds = asSortedStrings(config?.stacks ?? scan.stacks?.map((stack) => stack.id));
  const selected = registry.standards
    .map((standard) => ({ standard, selection: selectionReason(standard, installedPackages, configuredPackages, dependencies) }))
    .filter((entry) => entry.selection)
    .sort((left, right) => left.standard.id.localeCompare(right.standard.id));
  return {
    snapshot: registry.snapshot,
    installedPackages,
    configuredPackages,
    dependencies,
    stackIds,
    selected,
  };
}

function markdownList(values) {
  return values.map((value) => `- ${value}`).join('\n');
}

function sourcesMarkdown(sources) {
  return sources.map((source) => {
    const link = source.url ? `[${source.title}](${source.url})` : source.title;
    return `- ${link} — ${source.kind}; retrieved ${source.retrievedAt}.`;
  }).join('\n');
}

function orderedList(values) {
  return values.map((value, index) => `${index + 1}. ${value}`).join('\n');
}

function verificationRows(standard, commands, zh) {
  const trusted = commands.filter((command) => command.verification?.trust?.level === 'structurally-trusted');
  return standard.verification.map((scenario, index) => {
    const command = trusted[index % Math.max(trusted.length, 1)];
    const evidence = command ? `\`${command.command}\` in \`${command.verification.cwd}\`` : (zh ? '尚未验证；从栈路由的验证矩阵选择可信仓库命令' : 'not yet verified; select a trusted repository command from the stack router verification matrix');
    return `| ${scenario.replaceAll('|', '\\|')} | ${zh ? '行为与契约断言通过，失败路径可观察' : 'Behavior and contract assertions pass; failure paths remain observable'} | ${evidence} |`;
  }).join('\n');
}

function skillProfile(standard) {
  return standard.profile ?? (standard.id === 'software-design-and-verification' || standard.id === 'professional-testing' ? 'workflow' : 'implementation');
}

function technicalSkill(standard, selection, snapshot, config, commands = []) {
  const zh = config.artifactLanguage === 'zh-CN';
  const profile = skillProfile(standard);
  const examples = IMPLEMENTATION_EXAMPLES[standard.id] ?? GENERIC_IMPLEMENTATION_EXAMPLE;
  const flow = standard.decisionFlow ?? (zh ? [
    '确认任务命中本 Skill 的技术证据和代码表面；不匹配则停止使用。',
    '读取相邻实现、测试和项目约定，区分已确认不变量与未验证假设。',
    '选择满足契约的最小实现形状，并在变更前明确异常、兼容性和副作用边界。',
    '运行验证矩阵中的仓库命令；无可信命令时明确记录为尚未验证。',
  ] : [
    'Confirm that the task matches both the declared technology evidence and the changed code surface; otherwise stop using this Skill.',
    'Read neighboring implementation, tests, and project conventions; separate confirmed invariants from unverified assumptions.',
    'Choose the smallest implementation shape that satisfies the contract, and state exception, compatibility, and side-effect boundaries before editing.',
    'Run the repository command named in the verification matrix; if none is trusted, record the result as not yet verified.',
  ]);
  const when = standard.triggers ?? (zh
    ? [`任务修改 ${standard.title} 所覆盖的生产代码、契约或验证。`, `扫描证据为 ${selection.kind}：${selection.evidence.join(', ')}。`]
    : [`The task changes production code, contracts, or verification covered by ${standard.title}.`, `Scanner evidence is ${selection.kind}: ${selection.evidence.join(', ')}.`]);
  const whenNot = standard.nonTriggers ?? (zh
    ? ['不要把本 Skill 用作业务需求、跨仓库授权或既有代码迁移许可。', '如果技术版本或代码表面不匹配，改用对应项目 Skill。']
    : ['Do not use this Skill as a business requirement, cross-repository authorization, or permission to migrate existing code.', 'Use a matching project Skill when the technology version or changed code surface does not match.']);
  const exceptionRows = standard.exceptions ?? standard.boundaries;
  const commandRows = verificationRows(standard, commands, zh);
  const shapeSections = profile === 'implementation' ? `
## ${zh ? 'Correct implementation shape' : 'Correct implementation shape'}

\`\`\`${examples.language}
${examples.correct}
\`\`\`

## ${zh ? 'Incorrect implementation shape' : 'Incorrect implementation shape'}

\`\`\`${examples.language}
${examples.incorrect}
\`\`\`
` : '';
  const testCaseInitCommand = `aicg test-case init . --scope <SCOPE> --format ${config.testing?.caseFormat ?? 'aicg-json-v2'} --output ${config.testing?.caseRoot ?? 'docs/ai/testing'} --yes`;
  const testingWorkflow = standard.id === 'professional-testing' ? `
## ${zh ? 'Formal testing workflow' : 'Formal testing workflow'}

- ${zh ? '配置格式' : 'Configured format'}: \`${config.testing?.caseFormat ?? 'aicg-json-v2'}\`
- ${zh ? '用例目录' : 'Case directory'}: \`${config.testing?.caseRoot ?? 'docs/ai/testing'}\`
- ${zh ? '报告目录' : 'Report directory'}: \`${config.testing?.reportRoot ?? 'reports/testing'}\`
- ${zh ? '报告语言' : 'Report language'}: \`${config.testing?.reportLanguage ?? 'en'}\`

1. ${zh ? '开发者交接已确认需求、开发文档、代码版本和变更风险；测试负责人建立或更新稳定 Case ID 的清单。' : 'Development hands off confirmed requirements, development docs, code version, and change risks; test ownership creates or updates stable Case IDs.'}
2. ${zh ? `首次执行运行 \`${testCaseInitCommand}\`。` : `For first execution run \`${testCaseInitCommand}\`.`}
3. ${zh ? '补全 schema v2 共享角色、环境、数据、覆盖决策与用例；使用 validate 校验后才能执行。' : 'Complete schema-v2 shared actors, environments, data, coverage decisions, and cases; validate before execution.'}
4. ${zh ? '使用 select 按 Case、优先级、标签或驱动生成最小执行包，一次只给 AI 当前用例和引用上下文。' : 'Use select by Case, priority, tag, or driver to produce a minimal packet; give the AI only the current cases and referenced context.'}
5. ${zh ? '执行结果必须回传范围、基线、清单摘要和执行包摘要；PASS/FAIL 关联仓库内真实证据文件。' : 'Results return scope, baseline, manifest digest, and packet digest; PASS/FAIL reference real repository evidence files.'}
6. ${zh ? '使用 record 原子写入结果账本、补齐 NOT_RUN 并生成报告；同一会话重复提交保持幂等。' : 'Use record to atomically update the ledger, fill NOT_RUN, and generate the report; replaying an identical session remains idempotent.'}
7. ${zh ? '报告必须把 AI 模拟真人、自动化与真实用户结果分开；真实用户执行需要明确授权。' : 'Reports keep AI-simulated-human, automated, and real-user results separate; real-user execution requires explicit authorization.'}
` : '';
  const content = `---
name: ${standard.id}
description: ${zh ? `当技术证据与变更表面匹配时，使用可执行的${standard.title}决策与验证流程。` : `Use the executable ${standard.title} decisions when technology evidence and the changed surface match.`}
---

# ${standard.title}

<!-- ${GENERATED_MARKER} -->

## When to use

${markdownList(when)}

## When not to use

${markdownList(whenNot)}

## Evidence and prerequisites

- ${zh ? '选择依据' : 'Selection'}: \`${selection.kind}\` (${selection.evidence.join(', ')})
- ${zh ? '来源状态' : 'Source status'}: \`${snapshot.status}\`; ${zh ? '审阅日期' : 'reviewed'} ${snapshot.reviewedAt}; ${zh ? `${snapshot.refreshAfterDays} 天后刷新` : `refresh after ${snapshot.refreshAfterDays} days`}.
- ${zh ? '开始前读取相邻实现、测试和仓库专属 Skill；它们可以收紧本通用标准。' : 'Read neighboring implementation, tests, and repository-specific Skills first; they may narrow this general standard.'}

## Required invariants

${markdownList(standard.practices)}

## Decision flow

${orderedList(flow)}
${shapeSections}
## Exceptions and escalation

${markdownList(exceptionRows)}
- ${zh ? '如果项目代码与本标准冲突，记录证据并请求负责人决定；不得静默改写整个项目。' : 'If project evidence conflicts with this standard, record it and request an owner decision; never rewrite the repository silently.'}

## Verification matrix

| ${zh ? '场景' : 'Scenario'} | ${zh ? '期望结果' : 'Expected result'} | ${zh ? '命令或证据状态' : 'Command or evidence status'} |
| --- | --- | --- |
${commandRows}
${testingWorkflow}

## Project evidence boundary

${markdownList(standard.boundaries)}

- ${zh ? '本 Skill 不证明项目已经实施该模式，也不证明完成真实用户验证。' : 'This Skill does not prove that the project implements the pattern or that real-user validation has occurred.'}

## Sources

${zh ? standard.sources.map((source) => `- ${source.url ? `[${source.title}](${source.url})` : source.title} — ${source.kind}；获取日期：${source.retrievedAt}。`).join('\n') : sourcesMarkdown(standard.sources)}
`;
  return { content, profile, quality: assertSkillQuality(content, { profile, id: standard.id }) };
}

function technicalStandardsManifest(selection, config = {}) {
  return {
    schemaVersion: 1,
    status: selection.snapshot.status,
    reviewedAt: selection.snapshot.reviewedAt,
    refreshAfterDays: selection.snapshot.refreshAfterDays,
    boundary: config.artifactLanguage === 'zh-CN' ? '本注册表是所选主要来源的可复现离线快照，不声称已安装框架为最新版本或项目已强制执行所有规则。' : selection.snapshot.boundary,
    technologyEvidence: {
      installedPackages: selection.installedPackages,
      configuredPackages: selection.configuredPackages,
      dependencies: selection.dependencies,
      selectedStacks: selection.stackIds,
    },
    skills: selection.selected.map(({ standard, selection: reason }) => ({
      id: standard.id,
      title: standard.title,
      path: canonicalPath(`docs/ai/skills/standards/${standard.id}/SKILL.md`, config.governanceFootprint ?? 'compact'),
      applicability: reason,
      sources: standard.sources.map(sourceSnapshot),
      verification: standard.verification,
      boundaries: standard.boundaries,
      claimState: 'stated',
      quality: standard.quality,
    })),
    generationVerification: {
      requiredCommand: 'aicg check .',
      boundary: config.artifactLanguage === 'zh-CN' ? '生成器验证受管产物完整性。框架与业务验证依赖具体项目，必须单独运行。' : 'The generator verifies managed artifact integrity. Framework and business verification remain project-specific and must be run separately.',
    },
  };
}

export function buildTechnicalStandardArtifacts(config, scan, registry = loadTechnicalStandardRegistry()) {
  const selection = selectTechnicalStandards(scan, config, registry);
  selection.selected = selection.selected.map((entry) => ({
    ...entry,
    standard: { ...entry.standard, ...(entry.standard.translations?.[config.artifactLanguage] ?? {}) },
  }));
  const rendered = new Map(selection.selected.map(({ standard, selection: reason }) => {
    // Reusable technical standards must not drift whenever a project script is
    // added or renamed. Exact repository commands live in the generated stack
    // router, while this full-owned standard keeps a stable verification handoff.
    const skill = technicalSkill(standard, reason, selection.snapshot, config);
    standard.quality = skill.quality;
    return [standard.id, skill];
  }));
  const manifest = technicalStandardsManifest(selection, config);
  const artifacts = [{
    path: canonicalPath('docs/ai/technical-standards.json', config.governanceFootprint ?? 'compact'),
    content: stableJson(manifest),
    ownership: 'full',
    kind: 'technical-standard-manifest',
    source: 'technical-standard-registry',
  }];
  for (const { standard, selection: reason } of selection.selected) {
    const canonicalPath = `docs/ai/skills/standards/${standard.id}/SKILL.md`;
    const content = rendered.get(standard.id).content;
    artifacts.push({
      path: canonicalPath,
      content,
      ownership: 'full',
      kind: 'technical-standard-skill',
      source: 'technical-standard-registry',
    });
    const adapters = selectedSkillDirectories(config?.clients ?? []).map((directory) => `${directory}/standards/${standard.id}/SKILL.md`);
    for (const adapterPath of unique(adapters)) {
      artifacts.push({
        path: adapterPath,
        content: skillAdapterContent(canonicalPath, content),
        ownership: 'full',
        kind: 'technical-standard-adapter-skill',
        source: canonicalPath,
      });
    }
  }
  return { selection, manifest, artifacts };
}

export function technicalStandardsSummary(scan, config, registry = loadTechnicalStandardRegistry()) {
  const selection = selectTechnicalStandards(scan, config, registry);
  selection.selected = selection.selected.map((entry) => {
    const standard = { ...entry.standard, ...(entry.standard.translations?.[config.artifactLanguage] ?? {}) };
    const rendered = technicalSkill(standard, entry.selection, selection.snapshot, config);
    return { ...entry, standard: { ...standard, quality: rendered.quality } };
  });
  const manifest = technicalStandardsManifest(selection, config);
  return {
    schemaVersion: 1,
    mode: 'read-only-preview',
    target: scan.root,
    status: manifest.status,
    reviewedAt: manifest.reviewedAt,
    refreshAfterDays: manifest.refreshAfterDays,
    technologyEvidence: manifest.technologyEvidence,
    skills: manifest.skills.map(({ path: skillPath, ...skill }) => ({ ...skill, generatedPath: skillPath })),
    verification: manifest.generationVerification,
    boundary: manifest.boundary,
  };
}

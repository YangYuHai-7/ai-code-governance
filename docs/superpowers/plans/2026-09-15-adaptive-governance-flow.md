# 自适应 AI 编码治理流程实施计划

> **供执行 Agent 使用：**必须按任务使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`，逐项执行本计划。所有步骤使用复选框跟踪。

**目标：**把 AICG 改造成安装时收集关键决策、运行时按任务影响动态升级、默认保持最小上下文并能安全迁移的治理框架。

**架构：**保留现有 config、manifest、compiler、checker 和 completion 内核，新增小型能力/产物选择器与纯函数任务路由器。先封住 stale artifact 的删除权限，再缩短常驻路由、调整安装语言，最后启用惰性产物、diff 级别校验、安全 prune 和有条件 harvest。

**技术栈：**Node.js 22+、ES modules、`node:test`、现有 AICG CLI、JSON/YAML 治理产物、Git fixture。

**规格：**`docs/superpowers/specs/2026-09-15-adaptive-governance-flow-design.md`

## 全局约束

- 新治理产物默认使用英语，首批正式支持英语和简体中文；旧 `bilingual` 配置继续可读。
- JSON/YAML 字段名、ID、枚举、命令和文件名始终使用英语。
- Codex-only Minimal 硬上限为 10 个受管文件，目标为 8 个。
- 普通任务初始治理上下文不超过 900 tokens；行为变更不超过 1,800 tokens。
- 普通模板升级自动删除文件数必须为零。
- seed、未知、漂移或不可信内容不得自动删除。
- release、surface、lifecycle、reviews/reports 不进入 Minimal 的默认产物或普通启动链。
- L0 不运行治理子进程；L1 最多一次；L2/L3 必须遵守需求与计划批准；发布保持两阶段精确批准。
- 不增加运行时依赖；token 预算首版使用 `Math.ceil(Buffer.byteLength(content, 'utf8') / 4)` 的确定性估算。
- 所有实现先写失败测试，再写最小代码；每个任务独立提交。
- 不推送、发布、部署或安装 hook。

---

### 任务 1：可信 Manifest 与默认零删除 Sync

**文件：**

- 新建：`src/modules/governance/manifest-trust.mjs`
- 修改：`src/modules/governance/artifact-plan.mjs`
- 修改：`src/modules/governance/index.mjs`
- 修改：`src/cli/commands/governance.mjs`
- 修改：`src/cli/command-specs.mjs`
- 测试：`test/sync-prune.test.mjs`

**接口：**

- 产生：`validateManifestRemovalAuthority(root, manifest) -> { trusted, errors }`
- 产生：`planArtifacts(root, artifacts, { allowStaleRemoval, ... })`
- 保证：未传 `allowStaleRemoval` 时，stale 条目进入 `retained`，不会进入删除 operation。

- [ ] **步骤 1：写 Manifest 信任和零删除失败测试**

```js
test('ordinary sync retains stale artifacts and foreign manifests have no removal authority', () => {
  const ordinary = planArtifacts(root, currentArtifacts);
  assert.equal(ordinary.operations.some((item) => item.remove), false);
  assert.deepEqual(ordinary.retained.map((item) => item.path), ['docs/ai/legacy-generated.md']);

  const forged = validateManifestRemovalAuthority(root, foreignManifest);
  assert.equal(forged.trusted, false);
  assert.match(forged.errors.join('\n'), /generatedBy|source|ownership/);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/sync-prune.test.mjs`

预期：因模块不存在或 `ordinary.operations` 仍包含 remove 而失败。

- [ ] **步骤 3：实现 Manifest 删除权限校验**

```js
export function validateManifestRemovalAuthority(root, manifest) {
  const errors = [];
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push('schemaVersion');
  if (manifest?.generatedBy !== TOOL_NAME) errors.push('generatedBy');
  if (!Number.isInteger(manifest?.templateVersion) || manifest.templateVersion < 1 || manifest.templateVersion > TEMPLATE_VERSION) errors.push('templateVersion');
  if (!Array.isArray(manifest?.files)) errors.push('files');
  for (const entry of manifest?.files ?? []) {
    if (!isSafeRelative(entry?.path ?? '')) errors.push(`unsafe path: ${entry?.path}`);
    if (!['full', 'managed-block', 'gitignore-block'].includes(entry?.ownership)) errors.push(`ownership: ${entry?.path}`);
    if (typeof entry?.kind !== 'string' || typeof entry?.source !== 'string') errors.push(`source: ${entry?.path}`);
    if (!/^[a-f0-9]{64}$/.test(entry?.sha256 ?? '')) errors.push(`sha256: ${entry?.path}`);
  }
  return { trusted: errors.length === 0, errors };
}
```

实现时复用 `constants.mjs` 和 `shared/index.mjs`，不复制常量。

- [ ] **步骤 4：让 planner 默认保留 stale artifact**

在 stale-entry 循环前计算信任结果；`options.allowStaleRemoval !== true` 时，把标准化条目放入 `retained` 并 `continue`。显式允许删除但 manifest 不可信时，把错误写入 `conflicts`，不得产生 remove operation。返回值增加 `retained`。

- [ ] **步骤 5：让普通 `sync` 显式使用零删除模式**

```js
const plan = planArtifacts(scan.root, artifacts, {
  force: options.force,
  migrateLinks: options['migrate-links'],
  allowStaleRemoval: false,
});
```

JSON 输出增加 `retained` 路径列表，保持 `changed` 字段兼容。

- [ ] **步骤 6：运行定向回归**

运行：`node --test test/sync-prune.test.mjs test/generation.test.mjs test/execution-plan.test.mjs`

预期：全部通过；普通 sync 不删除 stale artifact。

- [ ] **步骤 7：提交**

```bash
git add src/modules/governance/manifest-trust.mjs src/modules/governance/artifact-plan.mjs src/modules/governance/index.mjs src/cli/commands/governance.mjs src/cli/command-specs.mjs test/sync-prune.test.mjs
git commit -m "fix: make ordinary governance sync non-destructive"
```

### 任务 2：零删除缩短常驻上下文

**文件：**

- 修改：`src/modules/governance/compiler.mjs`
- 测试：`test/context-budget.test.mjs`
- 测试：`test/generation.test.mjs`
- 测试：`test/technical-standards.test.mjs`

**接口：**

- 产生：`contextClosure(artifacts, profile) -> string[]`，测试辅助函数放在测试文件中。
- 保证：本任务不删 `buildArtifacts()` 中的任何产物，只修改入口和路由文本。

- [ ] **步骤 1：写普通启动链负向测试**

```js
test('ordinary context excludes release harvest hooks and full standards', () => {
  const artifacts = buildArtifacts({ ...defaultConfig(scan), governanceDepth: 'standard' }, scan);
  const agents = content(artifacts, 'AGENTS.md');
  const always = content(artifacts, 'docs/ai/rules/00_always.mdc');
  const context = content(artifacts, 'docs/ai/context-map.yaml');
  for (const value of [agents, always, ordinaryProfile(context)]) {
    assert.doesNotMatch(value, /release-check|harvest|promote|reviews\/|reports\/|capability-evolution|technical-standards/);
  }
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/context-budget.test.mjs`

预期：当前 `rootInstructions()`、`alwaysRule()` 和 `default_start` 包含被禁止内容，因此失败。

- [ ] **步骤 3：收缩根入口和 always rule**

`rootInstructions()` 只输出正典路径、最小 profile、范围保护、adapter 所有权和唯一完成入口。`alwaysRule()` 只保留范围保护、代码/测试优先、证据诚实、真实命令和交付前一次门禁。

- [ ] **步骤 4：把 context map 改成增量 profile**

生成 `ordinary`、`behavior_change`、`release` 三个 profile；技术和业务 Skill 只在 `behavior_change.conditional` 中按命中加载，release policy 只在 `release.required` 中出现。

- [ ] **步骤 5：运行定向测试**

运行：`node --test test/context-budget.test.mjs test/generation.test.mjs test/technical-standards.test.mjs`

预期：全部通过，现有产物仍保留但普通 profile 不再引用它们。

- [ ] **步骤 6：提交**

```bash
git add src/modules/governance/compiler.mjs test/context-budget.test.mjs test/generation.test.mjs test/technical-standards.test.mjs
git commit -m "perf: reduce default governance context"
```

### 任务 3：安装顺序、语言分离与既有栈确认

**文件：**

- 修改：`src/kernel/config/constants.mjs`
- 修改：`src/modules/governance/compiler.mjs`
- 修改：`src/cli/prompts.mjs`
- 修改：`src/cli/help.mjs`
- 修改：`src/cli/commands/init.mjs`
- 测试：`test/onboarding-product-flow.test.mjs`
- 测试：`test/generation.test.mjs`

**接口：**

- 产生：`codeDocumentationPolicy: inherit-existing | en | zh-CN`
- 保证：新配置默认 `artifactLanguage: 'en'`；旧配置缺少新字段时按项目阶段补默认值。

- [ ] **步骤 1：写引导顺序和语言默认失败测试**

```js
test('guided onboarding asks clients first and artifact language second', async () => {
  const rl = scriptedReadline(['1', '', '2', '1', '1']);
  const config = await promptGuidedConfig(scan, defaultConfig(scan), { readline: rl });
  assert.deepEqual(rl.labels.slice(0, 2), [
    'Which AI coding tools should this project support? / 要支持哪些 AI 编码工具？',
    'Governance artifact language / 治理产物语言',
  ]);
  assert.equal(config.artifactLanguage, 'en');
  assert.equal(config.interactionLanguage, 'en');
});
```

再断言既有项目显示检测到的 stack，并要求 confirm/correct；新项目配置包含 `architecture: { status: 'not-established' }` 或等价的已有架构 decision gap。

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/onboarding-product-flow.test.mjs`

预期：当前先询问语言，且 guided 会把 `artifactLanguage` 直接设为交互语言。

- [ ] **步骤 3：更新配置默认值和校验**

```js
artifactLanguage: 'en',
codeDocumentationPolicy: assessment.codebase.lifecycle.value === 'existing' ? 'inherit-existing' : 'en',
```

增加 `SUPPORTED_CODE_DOCUMENTATION_POLICIES` 并在 `validateConfig()` 校验；不提升 manifest schema。旧 `bilingual` 继续通过校验，但从推荐引导选项移除。

- [ ] **步骤 4：重排 guided 和 full prompt**

客户端问题在语言未知时使用中英双语；显式 `--locale` 存在时使用对应语言。第二问独立选择 `artifactLanguage`，默认索引必须指向英语。既有项目展示扫描 stack 后询问“确认/修正”；新项目允许选择目标 stack。

- [ ] **步骤 5：更新帮助和非交互 config 契约**

帮助文本明确 `--locale` 只控制交互语言；`artifactLanguage` 默认英语且需要通过 config 或引导单独选择。`requireConfiguredChoices()` 继续要求非交互、未批准流程明确提供 stack/depth/language。

- [ ] **步骤 6：运行定向测试**

运行：`node --test test/onboarding-product-flow.test.mjs test/generation.test.mjs test/args.test.mjs`

预期：全部通过，中英文 human output 和旧 bilingual config 均保持兼容。

- [ ] **步骤 7：提交**

```bash
git add src/kernel/config/constants.mjs src/modules/governance/compiler.mjs src/cli/prompts.mjs src/cli/help.mjs src/cli/commands/init.mjs test/onboarding-product-flow.test.mjs test/generation.test.mjs
git commit -m "feat: separate onboarding and artifact languages"
```

### 任务 4：能力与产物选择器

**文件：**

- 新建：`src/modules/governance/artifact-selection.mjs`
- 修改：`src/modules/governance/compiler.mjs`
- 修改：`src/modules/governance/checker.mjs`
- 修改：`src/modules/governance/index.mjs`
- 测试：`test/artifact-selection.test.mjs`
- 修改：`test/generation.test.mjs`
- 修改：`test/architecture-policy.test.mjs`

**接口：**

- 产生：`resolveGovernanceCapabilities(config, scan) -> Set<string>`
- 产生：`selectArtifactDefinitions(config, scan, definitions) -> ArtifactDefinition[]`
- `ArtifactDefinition` 字段固定为 `id/path/capability/activation/requires/ownership/routeProfiles/gateAssertions/build`。

- [ ] **步骤 1：写 exact allowlist 和预算失败测试**

```js
test('Codex-only minimal emits only the trusted kernel', () => {
  const config = { ...defaultConfig(scan), clients: ['codex'], governanceDepth: 'minimal' };
  const paths = buildArtifacts(config, scan).map((item) => item.path).sort();
  assert.deepEqual(paths, MINIMAL_CODEX_ALLOWLIST);
  assert.ok(paths.length <= 10);
  assert.equal(paths.some((value) => /release|surface|acceptance|reviews|reports|lifecycle/.test(value)), false);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/artifact-selection.test.mjs`

预期：当前 Minimal 仍生成超预算产物。

- [ ] **步骤 3：实现能力解析纯函数**

```js
export function resolveGovernanceCapabilities(config) {
  const active = new Set(['core']);
  if (config.governanceDepth !== 'minimal') active.add('routing');
  if (config.governanceDepth !== 'minimal' && (config.architecture?.status === 'approved' || config.domainConstraints.length > 0 || config.stacks.length > 0)) active.add('policy');
  if ((config.clients?.length ?? 0) > 0 || config.features.hooks || config.features.externalWorkflows || config.features.ciIntegration) active.add('integration');
  if (config.features.knowledge || config.features.taskRuntime) active.add('lifecycle');
  return active;
}
```

不要因为 `complete` 自动启用所有 feature。

- [ ] **步骤 4：把 compiler artifact builder 拆成定义表和选择器**

核心定义使用 `eager-core`；客户端 adapter 使用 `selected`；release/surface/acceptance 使用 `first-use`；结果和 receipt 使用 `evidence-produced`。`buildArtifacts()` 只 build 被选中的定义。

- [ ] **步骤 5：让 checker 使用相同选择结果**

移除 architecture、release 或其他可选产物的无条件 reachability 断言。只有选择结果包含对应 `gateAssertions` 时才验证。

- [ ] **步骤 6：运行产物和 checker 回归**

运行：`node --test test/artifact-selection.test.mjs test/generation.test.mjs test/architecture-policy.test.mjs test/technical-standards.test.mjs`

预期：全部通过；新 Minimal 不超过 10 个文件，Standard/Complete 只产生选中能力。

- [ ] **步骤 7：提交**

```bash
git add src/modules/governance/artifact-selection.mjs src/modules/governance/compiler.mjs src/modules/governance/checker.mjs src/modules/governance/index.mjs test/artifact-selection.test.mjs test/generation.test.mjs test/architecture-policy.test.mjs
git commit -m "feat: select governance artifacts by capability"
```

### 任务 5：纯函数任务路由与机器可读策略

**文件：**

- 新建：`src/modules/governance/task-routing.mjs`
- 修改：`src/modules/governance/compiler.mjs`
- 修改：`src/modules/governance/index.mjs`
- 测试：`test/task-routing.test.mjs`

**接口：**

- 产生：`classifyTaskRoute(input) -> TaskRoute`
- 产生：`minimumTaskLevelFromPaths(paths, config) -> 'L0' | 'L1' | 'L2' | 'L3'`
- 产生标准档产物：`docs/ai/task-routing-policy.json`

- [ ] **步骤 1：写路由表失败测试**

```js
for (const sample of [
  [{ mutation: 'none', scope: 'single-file', risk: 'low', clarity: 'clear' }, 'L0'],
  [{ mutation: 'non-production', scope: 'single-file', risk: 'low', clarity: 'clear' }, 'L1'],
  [{ mutation: 'product-behavior', scope: 'single-module', risk: 'business', clarity: 'clear' }, 'L2'],
  [{ mutation: 'product-behavior', scope: 'multi-surface', risk: 'business', clarity: 'clear' }, 'L3'],
  [{ mutation: 'external-action', scope: 'single-module', risk: 'high-consequence', clarity: 'clear' }, 'L3'],
]) {
  assert.equal(classifyTaskRoute(sample[0]).level, sample[1]);
}
```

另外验证 `clarity: exploratory` 只增加 discovery gate，不直接把低风险请求升级到 L3。

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/task-routing.test.mjs`

预期：模块尚不存在。

- [ ] **步骤 3：实现确定性等级合并**

```js
const ORDER = ['L0', 'L1', 'L2', 'L3'];
const maxLevel = (...levels) => ORDER[Math.max(...levels.map((value) => ORDER.indexOf(value)))];

export function classifyTaskRoute(input) {
  const mutationLevel = { none: 'L0', 'governance-only': 'L1', 'non-production': 'L1', 'product-behavior': 'L2', 'external-action': 'L3' }[input.mutation];
  const scopeLevel = { 'single-file': 'L0', 'single-module': 'L1', 'multi-module': 'L2', 'multi-surface': 'L3' }[input.scope];
  const riskLevel = { low: 'L0', business: 'L2', 'high-consequence': 'L3' }[input.risk];
  const level = maxLevel(mutationLevel, scopeLevel, riskLevel);
  return { level, profile: level === 'L0' ? 'ordinary' : level === 'L1' ? 'ordinary' : 'behavior_change', requiredApprovals: approvals(level, input.clarity), reasonCodes: reasonCodes(input) };
}
```

输入枚举非法时使用 `usageError` fail closed。

- [ ] **步骤 4：生成路由策略产物和入口摘要**

Standard/Complete 生成稳定英文字段的 `task-routing-policy.json`；自然语言说明由 `artifactLanguage` 本地化。Minimal 在 `AGENTS.md` 中内嵌 L0/L1/升级边界，不新增该文件。

- [ ] **步骤 5：运行路由和生成测试**

运行：`node --test test/task-routing.test.mjs test/generation.test.mjs test/context-budget.test.mjs`

预期：全部通过，普通启动预算不因策略全文超限。

- [ ] **步骤 6：提交**

```bash
git add src/modules/governance/task-routing.mjs src/modules/governance/compiler.mjs src/modules/governance/index.mjs test/task-routing.test.mjs test/generation.test.mjs test/context-budget.test.mjs
git commit -m "feat: add adaptive task routing policy"
```

### 任务 6：Completion 的 Diff 等级校验

**文件：**

- 修改：`src/cli/command-specs.mjs`
- 修改：`src/cli/commands/completion.mjs`
- 修改：`src/modules/completion/service.mjs`
- 修改：`src/modules/governance/task-routing.mjs`
- 测试：`test/commit-completion.test.mjs`
- 测试：`test/task-routing.test.mjs`

**接口：**

- CLI：`aicg complete . --task-level L1 --verify "npm run test"`
- `runCompletion(target, { taskLevel, ... })`
- 结果增加：`taskRoute: { declaredLevel, minimumLevel, status, reasons }`

- [ ] **步骤 1：写较弱等级被阻断的失败测试**

```js
test('completion rejects L1 after a production or high-risk diff', () => {
  write(root, 'src/payment.mjs', 'export const settle = () => true;\n');
  const result = run(['complete', root, '--task-level', 'L1', '--json']);
  assert.equal(result.status, 1);
  assert.equal(JSON.parse(result.stdout).taskRoute.status, 'upgrade-required');
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/commit-completion.test.mjs`

预期：`--task-level` 尚未识别或输出缺少 `taskRoute`。

- [ ] **步骤 3：收集工作树和 staged changed paths**

手动 completion 使用 `git diff --name-only -z HEAD` 加未跟踪文件；hook 模式继续使用 index snapshot 和 `stagedPaths()`。路径读取失败必须非零，不能默认为 L1。

- [ ] **步骤 4：计算最低等级并阻断降级**

生产目录、依赖/lockfile、schema/migration、公共契约和 owner-confirmed high-risk signal 至少为 L2；多端、架构配置、migration 或外部动作声明为 L3。若 `declared < minimum`，仍可运行只读治理检查，但 `result.ok` 必须为 false，且不得运行 harvest mutation。

- [ ] **步骤 5：运行 completion 回归**

运行：`node --test test/commit-completion.test.mjs test/task-routing.test.mjs test/risk-evidence.test.mjs`

预期：全部通过；没有 `--task-level` 的旧调用保持兼容并报告 `unverified-declaration`，不伪装已验证等级。

- [ ] **步骤 6：提交**

```bash
git add src/cli/command-specs.mjs src/cli/commands/completion.mjs src/modules/completion/service.mjs src/modules/governance/task-routing.mjs test/commit-completion.test.mjs test/task-routing.test.mjs test/risk-evidence.test.mjs
git commit -m "feat: enforce minimum task level at completion"
```

### 任务 7：本地调用模式与快速测试分层

**文件：**

- 修改：`src/modules/governance/compiler.mjs`
- 修改：`src/cli/prompts.mjs`
- 修改：`package.json`
- 修改：`.github/workflows/ci.yml`
- 新建：`scripts/perf-baseline.mjs`
- 测试：`test/onboarding-product-flow.test.mjs`
- 测试：`test/performance-budget.test.mjs`

**接口：**

- 新安装仅在本地 AICG 可执行时推荐 `project-local`；否则明确选择 pinned bootstrap 或 global。
- package scripts：`test:fast`、`test:full`、`test:perf`。

- [ ] **步骤 1：写 offline-local 和脚本预算失败测试**

```js
test('project-local generated commands do not contain remote package resolution', () => {
  const config = { ...defaultConfig(scan), invocationMode: 'project-local' };
  const agents = artifact(config, scan, 'AGENTS.md').content;
  assert.doesNotMatch(agents, /npm exec --yes --package/);
  assert.match(governanceCommand(config, 'check .'), /^npm exec -- aicg check \.$/);
});
```

- [ ] **步骤 2：运行测试并确认当前预算或脚本缺失**

运行：`node --test test/onboarding-product-flow.test.mjs test/performance-budget.test.mjs`

- [ ] **步骤 3：统一调用说明**

远程 pinned 命令只出现在 bootstrap 帮助，不进入日常 `AGENTS.md`。既有项目保留配置；新项目根据本地安装探针给推荐值，不能生成不可执行的 project-local 命令。

- [ ] **步骤 4：增加测试脚本**

```json
{
  "test:fast": "node --test test/args.test.mjs test/onboarding-product-flow.test.mjs test/sync-prune.test.mjs test/context-budget.test.mjs test/artifact-selection.test.mjs test/task-routing.test.mjs test/execution-plan.test.mjs test/generation.test.mjs test/technical-standards.test.mjs",
  "test:full": "node --test",
  "test:perf": "node --test test/performance-budget.test.mjs"
}
```

`test` 在至少一个版本内继续指向完整 `node --test`。

- [ ] **步骤 5：增加重复采样性能 runner**

runner 对每个 fixture 预热 3 次、采样 20 次，输出 JSON 的 median/p95、文件数、字节和上下文估算。CI 的硬失败先覆盖小型和 10k fixture；50k 只记录，不声称跨系统达标。

- [ ] **步骤 6：调整 CI**

PR 矩阵运行 `test:fast`；Linux/Node 22 额外运行 `test:full`。main、nightly 或 release 保留完整跨平台/package smoke。工作流修改不触发发布。

- [ ] **步骤 7：运行测试**

运行：`npm run test:fast && npm run test:perf`

预期：fast 本机 p95 不超过 5 秒；小型 check p95 不超过 250 ms；10k check p95 不超过 1 秒。

- [ ] **步骤 8：提交**

```bash
git add src/modules/governance/compiler.mjs src/cli/prompts.mjs package.json .github/workflows/ci.yml scripts/perf-baseline.mjs test/onboarding-product-flow.test.mjs test/performance-budget.test.mjs
git commit -m "perf: add local governance fast path"
```

### 任务 8：安全 Legacy Prune

**文件：**

- 修改：`src/cli/command-specs.mjs`
- 修改：`src/cli/commands/governance.mjs`
- 修改：`src/modules/governance/artifact-plan.mjs`
- 修改：`src/modules/governance/manifest.mjs`
- 修改：`src/modules/governance/execution-plan.mjs`
- 修改：`src/kernel/config/constants.mjs`
- 测试：`test/sync-prune.test.mjs`
- 测试：`test/execution-plan.test.mjs`

**接口：**

- CLI：`aicg sync . --prune --dry-run`
- CLI：`aicg sync . --prune --approve <planHash>`
- template：`TEMPLATE_VERSION = 3`

- [ ] **步骤 1：写 prune 审批和回滚失败测试**

```js
test('prune requires the exact fresh plan hash', () => {
  const preview = run(['sync', root, '--prune', '--dry-run']);
  const planHash = JSON.parse(preview.stdout).planHash;
  assert.equal(run(['sync', root, '--prune']).status, 2);
  assert.equal(run(['sync', root, '--prune', '--approve', 'wrong']).status, 2);
  assert.equal(run(['sync', root, '--prune', '--approve', planHash]).status, 0);
});
```

再覆盖 seed、managed drift、foreign manifest、输入变化和 checker 故障回滚。

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/sync-prune.test.mjs test/execution-plan.test.mjs`

- [ ] **步骤 3：为 prune 构建 execution plan**

`--prune --dry-run` 使用 `allowStaleRemoval: true`，构建包含 preimage 的现有 execution plan 并返回 `planHash`、逐文件 action 和 `manualCleanupCandidates`。没有 `--prune` 时忽略 `--approve` 并报 usage error。

- [ ] **步骤 4：执行精确批准**

非 dry-run prune 必须传 `--approve`，重新扫描和重建计划，再调用 `assertArtifactPlanMatches()` 与 `assertPlanFresh()`。`--force` 仅允许处理受管区块 drift，不能跳过 planHash。

- [ ] **步骤 5：升级 template v3 并保留旧 manifest schema**

把 `TEMPLATE_VERSION` 改为 3；普通 v1/v2 sync 输出 `retained` warning。seed 不进入自动删除候选；可信旧 full/managed-block artifact 才能 prune。

- [ ] **步骤 6：运行迁移矩阵**

运行：`node --test test/sync-prune.test.mjs test/execution-plan.test.mjs test/generation.test.mjs test/real-scenarios/packaged-projects.test.mjs`

预期：全部通过，错误批准保持文件树和 manifest 字节不变。

- [ ] **步骤 7：提交**

```bash
git add src/cli/command-specs.mjs src/cli/commands/governance.mjs src/modules/governance/artifact-plan.mjs src/modules/governance/manifest.mjs src/modules/governance/execution-plan.mjs src/kernel/config/constants.mjs test/sync-prune.test.mjs test/execution-plan.test.mjs
git commit -m "feat: add approved legacy governance pruning"
```

### 任务 9：按任务资格执行 Skill 收割

**文件：**

- 修改：`src/modules/capabilities/harvest.mjs`
- 修改：`src/cli/commands/capabilities.mjs`
- 修改：`src/modules/completion/service.mjs`
- 测试：`test/capability-harvest.test.mjs`
- 测试：`test/commit-completion.test.mjs`

**接口：**

- 产生：`assessHarvestEligibility({ taskRoute, changedPaths, verification }) -> { eligible, reason }`
- completion 只返回 dry-run 候选摘要，不写 Skill。

- [ ] **步骤 1：写资格和去重失败测试**

```js
test('harvest skips read-only and low-risk non-capability changes', () => {
  assert.deepEqual(assessHarvestEligibility({ taskRoute: { level: 'L0' }, changedPaths: [], verification: { status: 'not-requested' } }), {
    eligible: false,
    reason: 'no-verified-product-behavior-change',
  });
});
```

再验证同一 capability ID 先产生 `update-existing`，不存在时才 `create-new`。

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/capability-harvest.test.mjs test/commit-completion.test.mjs`

- [ ] **步骤 3：实现资格判断**

只允许 L2/L3、存在 production changed path、项目验证 passed 的任务进入 dry-run。文档、格式、fixture、临时脚本和无公共能力变化的 L1 返回稳定 reason。

- [ ] **步骤 4：完善候选去重顺序**

按 capability ID、public entrypoint 和 implementation path 与 `projectCapabilities` 比较，依次返回 `update-existing`、`extend-existing`、`create-new` 或 `no-skill-with-reason`。不得自动调用 promotion。

- [ ] **步骤 5：在 completion 中返回只读候选摘要**

完成门禁不写文件。符合资格时在同一进程计算摘要；真正写入仍使用单独批准的 `aicg harvest`。不符合资格时返回 `skipped` 和精确 reason。

- [ ] **步骤 6：运行回归**

运行：`node --test test/capability-harvest.test.mjs test/commit-completion.test.mjs test/risk-evidence.test.mjs`

预期：全部通过，候选不冒充 adopted/enforced。

- [ ] **步骤 7：提交**

```bash
git add src/modules/capabilities/harvest.mjs src/cli/commands/capabilities.mjs src/modules/completion/service.mjs test/capability-harvest.test.mjs test/commit-completion.test.mjs
git commit -m "feat: gate skill harvesting by verified task impact"
```

### 任务 10：预算门禁、文档同步与候选版本验证

**文件：**

- 修改：`README.md`
- 修改：`SKILL.md`
- 修改：`references/initializer.md`
- 修改：`references/continuous-skill-evolution.md`
- 修改：`package.json`
- 测试：`test/context-budget.test.mjs`
- 测试：`test/artifact-selection.test.mjs`
- 测试：`test/performance-budget.test.mjs`

**接口：**

- 文档中的短语触发、默认档位、语言、动态等级、prune 和 harvest 必须与 CLI 一致。

- [ ] **步骤 1：写文档契约测试**

```js
test('skill contract describes adaptive routing and English artifact default', () => {
  const skill = fs.readFileSync('SKILL.md', 'utf8');
  assert.match(skill, /artifactLanguage.*en|治理产物.*英语/);
  assert.match(skill, /L0.*L1.*L2.*L3/s);
  assert.doesNotMatch(skill, /默认进入\*\*自动完整模式/);
});
```

- [ ] **步骤 2：运行测试并确认失败**

运行：`node --test test/context-budget.test.mjs test/artifact-selection.test.mjs test/performance-budget.test.mjs`

- [ ] **步骤 3：同步 README、SKILL 和 references**

把“模糊请求默认 Complete”改为扫描推荐 Minimal/Standard；记录 Agent-first、artifact-language-second 安装流程；说明 L0–L3 升级规则、普通 sync 零删除、prune planHash 和 harvest 资格。删除与新流程冲突的旧常驻 release/harvest 描述。

- [ ] **步骤 4：运行完整本地验证**

依次运行：

```bash
npm run test:fast
npm run test:full
npm run validate
npm run smoke
npm run smoke:package
node scripts/prepublish-check.mjs
npm pack --dry-run
```

预期：所有命令退出 0。只记录当前 macOS 的真实结果；Windows/Linux 保持 `not yet verified`，除非对应 CI 真实完成。

- [ ] **步骤 5：复核预算与声明边界**

检查新 Minimal/Standard/Complete fixture 的文件数、字节数、默认 profile closure、进程数和 p95。报告分别列出 `stated`、`reachable`、`enforced` 与真实客户端/平台证据，不把结构通过写成生产就绪。

- [ ] **步骤 6：提交**

```bash
git add README.md SKILL.md references/initializer.md references/continuous-skill-evolution.md package.json test/context-budget.test.mjs test/artifact-selection.test.mjs test/performance-budget.test.mjs
git commit -m "docs: align governance contract with adaptive execution"
```

## 最终交付检查

- [ ] 子仓库工作树仅包含本计划的提交，完整测试通过。
- [ ] 检查父仓库和子仓库未提交改动，保留所有无关用户修改。
- [ ] 子仓库先提交；父仓库只提交 `skills/ai-code-governance` gitlink 更新。
- [ ] 不推送任何仓库。
- [ ] 交付摘要列出各任务提交、测试命令、真实耗时、未验证平台和剩余边界。

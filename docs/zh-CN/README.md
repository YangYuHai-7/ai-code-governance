<div align="center">

# AI Code Governance

**面向 AI 编码 Agent 的自适应治理——小改动快速完成，关键业务变更审慎执行。**

<p>
  <a href="../../README.md">English</a> · <strong>简体中文</strong>
</p>

[![Node.js 22+](https://img.shields.io/badge/Node.js-22%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache--2.0-blue.svg)](../../LICENSE)
[![CI: Manual](https://img.shields.io/badge/CI-manual-6f42c1?logo=githubactions&logoColor=white)](../../.github/workflows/ci.yml)
![Agents](https://img.shields.io/badge/Agents-Codex%20%7C%20Claude%20Code%20%7C%20Cursor-111827)

单一规范源 · 默认最小上下文 · 先有证据再下结论 · 不自动过度治理

</div>

> [!IMPORTANT]
> 当前检出内容是 `0.4.0` 源码候选版。源码版本、npm 发布状态、平台认证和真实客户端执行属于不同的证据状态。

<!-- sync:quick-start -->
## 快速开始

使用 Node.js 22 或更高版本，全局安装一次，然后在需要治理的项目目录中执行一个命令：

```bash
npm install --global ai-code-governance
aicg
```

只想临时使用时不必全局安装，直接执行 `npx ai-code-governance`。`aicg` 不带参数时会自动识别终端语言，扫描当前目录并进入引导流程，只询问需要支持的 Agent、治理文件语言、项目阶段和确实需要由你决定的选项，写入前先展示预览。治理文件仍默认使用英文，只有负责人明确选择简体中文后才生成中文治理内容。

更喜欢聊天时，直接告诉 Codex、Claude Code、Cursor 或其他可以操作终端的编码 Agent：“请使用已安装的 `aicg` 为当前项目初始化 AI 代码治理。先扫描项目，只询问必须由我决定的事项，写入前展示变更预览。”Agent 负责操作 CLI，用户不需要记忆高级参数。

<!-- sync:why-aicg -->
## 为什么选择 AICG

| | 能力 | 带来的改变 |
| --- | --- | --- |
| ⚡ | **自适应流程** | L0/L1 保持轻量；只有影响程度需要时，L2/L3 才增加审批和证据要求。 |
| 🧭 | **小上下文路由** | Agent 只加载规范入口和当前任务所需的上下文切片，不读取整套治理资料。 |
| 🧩 | **理解项目现状** | 已有项目继承真实技术栈和规范；新项目诚实记录尚未建立的架构。 |
| 👥 | **动态专业团队** | 根据项目证据推荐技术和行业角色，再由负责人明确添加、暂缓或拒绝。 |
| 🔒 | **清晰授权边界** | 推荐不会自动安装 Skill、激活角色、执行命令、推送、发布或部署。 |
| ✅ | **可验证结果** | 机器门禁明确区分规范已声明、可访问、已强制和真正验证。 |

AICG 是仓库治理 CLI 和 Agent Skill，服务于新建与遗留项目，覆盖 React、Vue、Angular、Node.js、Java 等技术栈；macOS、Windows 和 Linux 的证据分别管理，不把能力声明当作验证结论。

<!-- sync:how-it-works -->
## 工作方式

```text
扫描仓库 → 确认负责人选择 → 生成最小治理集合 → 按影响程度路由每个任务
```

1. **发现**——检查生命周期、子工程、清单、准确技术栈、脚本、既有 Agent 适配器、规范和工作流证据，不执行项目代码。
2. **决策**——选择支持的 Agent、治理文件语言、测试用例格式与位置、生命周期和迁移策略。
3. **生成**——在 `docs/ai` 维护单一规范源，为旧项目生成各子工程开发基线和 README 入口，并生成普通适配文件、所有权清单和用户实际选择的能力。
4. **路由**——简单问题直接回答，小改动本地验证，只有高影响任务才要求正式审批和更完整证据。

治理文件默认使用英文。明确选择 `zh-CN` 后生成中文治理说明，但 ID、路径、命令和 schema 字段继续保持英文。对话语言和治理文件语言相互独立。

<!-- sync:task-routing -->
## 自适应任务路由

| 等级 | 适用情况 | 必要流程 |
| --- | --- | --- |
| **L0** | 解释、发现、评审或状态查询 | 读取最少证据后直接回答；不运行治理子流程，不制订计划，不测试，不提取能力。 |
| **L1** | 文档、测试、治理文件、格式调整或低风险非生产代码修改 | 定位范围，澄清实质性歧义，修改，执行针对性验证，最后做一次完成检查。 |
| **L2** | 产品行为、业务规则、公共契约或跨模块交付 | 确认需求并批准一个实施计划，然后完成实现和行为验证。 |
| **L3** | 架构、迁移、多端、外部影响或高后果风险 | 批准需求、设计和计划，然后进行集成实施和验证。 |

任务等级综合考虑变更性质、范围、风险和清晰度，不根据句子长短决定流程深度。一个功能始终作为横跨 UI、API、服务、数据和测试的单一纵向工作单元；不会把接口或单个测试用例拆成多个治理任务。

<!-- sync:onboarding -->
## 项目接入

安装顺序坚持 **Agent-first**、**artifact-language-second**。配置字段 `artifactLanguage` 默认值为 `en`；选择 `zh-CN` 只改变治理说明语言，不改变机器标识。最先向用户确认的决策包括：

1. **Agent 支持范围**——选择项目真正需要支持的客户端。已有文件只是证据，不代表用户已经授权。
2. **治理文件语言**——默认 `en`，显式支持 `zh-CN`；旧版 `bilingual` 配置继续可读。
3. **测试用例输出**——选择紧凑的 `aicg-json-v2`（推荐）或 Markdown 可读基线加 schema-v2 JSON，并选择仓库内放置目录。
4. **项目生命周期**——已有项目确认检测到的技术栈；新项目选择目标技术栈，但不会假装架构已经建立。
5. **旧代码策略**——选择 `keep-existing`、`new-code-standard` 或 `staged-migration`；初始化不会擅自改造产品代码。
6. **治理预设**——根据证据从 Minimal 或 Standard 开始；Complete 必须主动选择，不会因一句模糊需求自动启用。
7. **可选能力**——记忆、Git hooks、CI、工作流、Skills 和专家角色分别决策。

需要重复配置时，可在任意目录打开本地可视化配置页，并在页面选择项目。页面提供最近项目、绝对路径输入和文件夹浏览；传入路径则直接打开该项目。页面与命令行共用同一份 `aicg.config.json`，提供带解释的选择项，并可上传或下载 JSON 以共享配置。交互式 npm 安装（项目内或全局）会尝试自动打开项目选择页；如果 npm 跳过安装脚本或浏览器不可用，可手动打开。服务仅监听 `127.0.0.1`。上传后先在页面校验和保存；应用治理前还需重新预览精确计划并明确确认。

```bash
aicg config open
aicg config open /absolute/path/to/project
```

如需直接拖拽项目文件夹，先运行一次 `aicg config launcher --yes` 创建桌面入口，然后把项目文件夹拖到 **AICG Configure** 图标上，即可打开该项目的可视化配置页。macOS 使用 `.app`，Windows 使用 `.cmd`，Linux 使用 `.desktop` 和 shell 脚本；双击入口则打开项目选择页。桌面目录不在默认位置时可指定 `--output /绝对路径/目录`。重复安装不会覆盖已有修改或其他同名文件。Linux 文件管理器可能要求将 `.desktop` 入口标记为可信。网页本身无法可靠取得拖入文件夹的磁盘绝对路径，因此网页内继续使用文件夹浏览器。

也可以先生成可编辑的配置文件。模板采用保守的扫描结果，初始只选择 Codex，并把需要负责人确认的决策集中保留在文件中。校验前必须检查内容；项目阶段存在歧义时，仍需明确填写生命周期决策。

```bash
aicg config init . --output aicg.config.json --yes
aicg config validate . --config aicg.config.json --json
aicg init . --config aicg.config.json --yes --dry-run
```

`config init` 只创建不存在的文件；相同内容重复执行会返回 unchanged，已有不同内容、符号链接、不安全路径和 `.git` 目录都会被拒绝。`config validate` 是只读操作，并与 `init` 使用同一份有效初始化计划。安装前设置 `AICG_NO_AUTO_OPEN=1` 可关闭自动打开浏览器的尝试。

仓库家族使用一个可精确审批的计划，同时保留每个成员仓的独立所有权：

```bash
aicg init . --family --yes --clients codex --no-assist --dry-run
aicg init . --family --yes --clients codex --no-assist --approve <planHash>
```

组合计划同时绑定编排仓和所有检测到的成员仓。成员仓先于编排仓执行；父清单永不拥有成员仓文件；任一仓写入或后置检查失败时，整个仓库家族都会回滚。

旧项目会获得 `docs/ai/development/index.json`、每个已识别子工程各自的证据基线，以及各 README 中的简短受管入口。使用 `aicg init ... --assist <已选 Agent>`，让已选 Agent 按 `brownfield-understanding` 流程逐个子工程阅读代码和测试、把现存业务写入 Memory、补全开发文档，并提交稳定项目 Skill 供批准。`aicg check --json` 的 `brownfield.gaps` 会列出未完成项；扫描基线本身不代表业务理解完成。实现型 Skill 必须提供正确、错误和例外代码形状；工作流 Skill 必须提供可执行流程。

所有 AICG 检查默认仅报告提醒，退出码为 0，并把 JSON 结果写入 `reports/aicg/`。显式传入 `--enforce` 才会在检查失败时返回非零退出码。已安装的提交前 hook 默认使用报告模式。

Standard 与 Complete 还会生成扩展后的 `professional-testing` Skill。它使用稳定 Case ID、共享上下文、最小 AI 执行包、证据绑定的 PASS/FAIL、幂等结果账本、自动补齐 `NOT_RUN` 和从账本生成的报告。自动化、AI 模拟真人与真实用户证据严格分开。

```bash
aicg test-case init . --scope ACCOUNT --format aicg-json-v2 --output docs/ai/testing --yes
aicg test-case validate . --manifest docs/ai/testing/ACCOUNT-test-cases.json
aicg test-case select . --manifest docs/ai/testing/ACCOUNT-test-cases.json --cases ACCOUNT-TC-001 --output reports/testing/ACCOUNT-packet.json
aicg test-case record . --manifest docs/ai/testing/ACCOUNT-test-cases.json --packet reports/testing/ACCOUNT-packet.json --results reports/testing/ACCOUNT-external-results.json
```

| 预设 | 新项目默认包含的能力 |
| --- | --- |
| **Minimal** | 配置、公共入口、规范总览、上下文映射、常驻规则、清单和选定的 Agent 适配器 |
| **Standard** | Minimal，加上路由、验证说明、决策账本、本地报告路径以及相关政策或技术规范 Skills |
| **Complete** | Standard，加上选定的技术栈 Skills；任务运行时、hooks、CI、工作流桥接和其他集成仍然可选 |

<!-- sync:skills-and-team -->
## Skill 发现与动态团队

离线发现最多预览五个范围受控的 Skill 候选，并根据项目生成专属角色清单。技术角色来自架构和交付需要，行业角色来自业务背景——例如合同类项目可能需要合格律师，餐饮软件可能需要餐饮运营专家。

```bash
aicg init . --yes --config decisions.json --dry-run
aicg init . --yes --config decisions.json --approve <planHash>
```

每条推荐都会展示来源状态、权限、成本以及明确的 `add`、`defer` 或 `reject` 决策。没有候选项会被预选。Agent 角色通过专业观点碰撞形成更好的结论，但角色 ID 不代表真实参与，AI 也不能替代具备资质的人类专业人员。

Minimal 不生成管理类文件。经批准的 Standard/Complete 方案受文件数、字节数和管理上下文预算约束。常规同步会保留历史或已编辑文件；删除内容必须经过独立、精确的计划审批。

<!-- sync:vertical-delivery -->
## 一个功能，一个交付边界

L2/L3 生产功能使用一个范围明确的文档覆盖完整交付。[工作单元 schema](../../assets/contracts/work-unit-schema.json)把范围、成功与失败用例、适用 QA 用例、公共 API/方法可测试性、引用、记忆影响和必要角色绑定到同一个审批哈希。

```bash
aicg work-unit plan . --work-unit docs/ai/feature.json --json
aicg complete . --task-level L2 --work-unit docs/ai/feature.json --approval-evidence docs/ai/approval.json --approve <planHash> --verify "npm run verify" --json
```

验证只在功能边界执行一次。必要用例输出结构化 `AICG_QA_RESULT` 标记；缺失、重复、未知、阻塞或失败的必要用例都会阻止完成。之后检查保存的证据时不会再次运行产品测试。需求、用例、命令、范围或输入发生变化后，原审批自动失效。

不受支持的语言或配置格式不能绕过门禁。无法静态推导覆盖率时，负责人需要提供与审批绑定的手工清单，或给出不存在公共表面的合理说明。

<!-- sync:safe-maintenance -->
## 安全维护与显式发布

常规同步坚持零删除：保留历史种子、未知文件、已编辑产物、休眠证据以及新预设不再包含的内容。物理清理是单独审核的事务：

```bash
aicg sync . --prune --dry-run
aicg sync . --prune --approve <planHash>
```

只有可信、未修改、完全受管理的关系才可清理。`--force` 不能绕过审批，输入变化会使计划哈希失效。应用或检查失败时会事务性恢复原始文件树。

只有明确提出发布任务时才加载发布检查：

```bash
aicg release-check . --type feature --evidence docs/ai/release-evidence/candidate.json --json
aicg release-check . --type feature --evidence docs/ai/release-evidence/candidate.json --replay --approve <planHash>
```

推送、发布、部署、安装 hook、发送外部消息和修改 CI 都需要独立授权。

<!-- sync:evidence -->
## 证据、成长与性能

| 状态 | 含义 |
| --- | --- |
| `stated` | 已有规范，但尚未证明其行为。 |
| `reachable` | 经过检查的入口或上下文能够解析到规范文件。 |
| `enforced` | 指定机器检查及其反向探针能够拒绝错误声明。 |
| `verified` | 指定命令、候选版本、范围、平台和结果具有当前执行证据。 |

经过验证、符合条件的 L2/L3 产品变更可以生成能力候选。纯文案、格式、fixture、只读工作和不可复用修改不会触发提取。提取、采用和晋升是三个独立的显式步骤。

确定性 fixture 会限制文件数量和字节预算。普通上下文固定为三个唯一文件，不超过 3,600 字节和 900 个估算 token。性能采样保留小型和一万文件项目的绝对上限，五万文件场景仅提供信息。这些合成结果不能证明真实 Agent 加载效果，也不能认证所有操作系统。

<!-- sync:validation -->
## 贡献者验证

本地使用能够证明本次修改的最小命令。GitHub Actions 仅手动触发：日常验证选择 `fast`，本地检查通过后再按需选择 `full` 跨平台矩阵。

```bash
npm run test:fast
npm run test:full
npm run validate
npm run smoke
npm run smoke:package
node scripts/prepublish-check.mjs
npm pack --dry-run
```

`test:full` 包含性能采样器。普通 npm 发布会运行完整本地测试，确认 Git 候选干净并检查实际打包产物；只有同时提供全部组织发布变量时，才进入独立评审证据门禁，部分证据输入会按失败处理。两条路径都不会把本地结果冒充为 Windows/Linux 或真实客户端认证。

<!-- sync:architecture -->
## 架构与文档管理

```text
bin → src/cli → src/modules → src/kernel + src/shared
```

项目文档统一放在 `docs/`：面向用户的文档按语言分目录，维护者内部资料放在 `docs/internal`；根目录只保留默认英文 README。适配器隔离外部影响，目录加载带版本的资产，根目录 `src/*.mjs` 文件作为兼容门面。中文入口只链接中文说明或语言无关的机器契约：

- [产品架构](../internal/reference/product-architecture.md)
- [团队编排](../internal/reference/team-orchestration.md)
- [工作流集成](../internal/reference/workflow-integrations.md)
- [发布验收](../internal/reference/release-acceptance.md)
- [能力与平台注册表](../../assets/registries/capability-pack-registry.json)

<!-- sync:license -->
## 许可证

[Apache-2.0](../../LICENSE)

# `aicg init` 初始化协议

本协议定义 CLI 如何把仓库事实与用户选择编译成项目治理。实现入口是 `aicg init [path]`；它不依赖
符号链接、junction、管理员权限或特定 shell。

## 产品边界

初始化分两段：

1. **确定式生成**必须在没有模型、网络和 Agent 登录的情况下完成。它负责侦察、决策记录、基础规则、
   技术栈路由、普通文件适配器、内容哈希和结构检查。
2. **AI 深度补全**是可选阶段，且只适用于当前扫描仍为高置信 `greenfield` 的仓库。它读取生成的 bootstrap prompt，研究当前标准并从真实仓库证据提取业务
   不变量。缺少 Agent 或调用失败只把该阶段标为 `unverified`，不撤销基础生成。

CLI 不发布 npm 包、不安装 Agent、不修改全局客户端配置，也不使用跳过审批或绕过沙箱的参数。

## 命令接口

| 命令 | 读写 | 契约 |
| --- | --- | --- |
| `aicg init [path]` | 写 | 扫描、访谈、预览、生成、检查，可选启动 Agent |
| `aicg check [path] [--json]` | 只读 | 校验配置、manifest、受管内容哈希、链接禁令和客户端可达性 |
| `aicg sync [path]` | 写 | 从正典重新生成 manifest 拥有的普通文件适配器 |
| `aicg doctor [path] [--json]` | 只读 | 检查 Node、Git、目录权限、Agent CLI 与遗留链接 |
| `aicg assess [path] [--json]` | 只读 | 报告生命周期/拓扑分类、扫描证据和决策账本草案 |
| `aicg architecture [path] [--json]` | 只读 | 报告目录/模块结构证据、蓝图和有边界的迁移选择 |
| `aicg request [path] --text <alias>` | 按 intent | 把已登记的中英文请求路由到与 CLI 相同的只读或写入内核 |

通用退出码：`0` 成功；`1` 检查或执行失败；`2` 用法错误、输入不完整、用户取消或安全冲突。

`init` 支持：

- `--config <json>`：读取机器可复现答案；直接 `init` 单独使用时必须包含 Agent、技术栈、深度和语言，和 `--yes`
  一起使用时才允许由侦察默认补齐缺项。聊天计划可省略这些可侦察项，但不能省略既有/证据不足项目的生命周期与既有代码策略。它提供决策输入，不代表批准写入。
- `--yes`：显式批准本次无冲突、确定式的治理写入，并在没有配置时接受侦察默认（默认选择三款核心 Agent、标准深度和所有 OS）。它**不能**替既有代码或证据不足项目选择生命周期与既有代码策略。
- `--dry-run`：输出扫描结果、计划文件和待迁移链接，不写任何内容。
- `--no-assist` / `--assist <agent>`：禁止或明确选择 AI 补全执行器。
- `--migrate-links`：显式授权迁移已知客户端路径上的旧链接。
- `--force`：只允许恢复 manifest 已拥有或带生成标记的内容，不覆盖未知用户文件。

无 TTY 且没有 `--yes` 或 `--config` 时必须以退出码 2 结束，不能靠猜测继续；无 TTY 的写入即使提供 `--config` 也必须有 `--yes`。

## 项目分类与决策账本

`assess` 将生命周期与拓扑分开：生命周期是 `greenfield`、`existing` 或 `ambiguous`，拓扑是 `single-repo` 或 `monorepo`。只有源码、测试或迁移等实质证据才建议 `existing`；仅 manifest 的脚手架必须标为 `ambiguous` 并等待用户确认。扫描排除 `.ai-governance`、已生成适配器和 `docs/ai`，因此初始化后的治理文件不会反向改变项目分类。

初始化将决策写入 `initialization`：`lifecycle` 是 `greenfield` 或 `existing`，`existingCodeStrategy` 是
`keep-existing`、`new-code-standard` 或 `staged-migration`，并由 CLI 记录确认来源。高置信度新项目可由 `--yes`
或已批准的聊天计划采用默认 `greenfield`。`existing` 与 `ambiguous` 绝不允许由 `--yes`、聊天默认值或缺失配置
静默继续：前者必须显式选择 `existing` 与三种策略之一，后者必须先确认它是新脚手架还是已有项目；确认成已有项目时同样必须选策略。任何策略都只控制后续治理指引，初始化不会改写、移动或格式化业务代码；在 `existing` 或 `ambiguous` 证据下，CLI 也会拒绝 AI Assist，避免将提示词误当作文件隔离。

初始化、聊天预览与决策拒绝路径只做文件系统侦察：不运行 Git、Agent CLI 或 PATH 中的可执行文件。未知的非治理产品文件（例如静态站点文件）不会被当作空仓库，而是标为 `ambiguous` 并等待确认。

例如，对已有项目的可复现输入是：

```json
{
  "initialization": {
    "lifecycle": "existing",
    "existingCodeStrategy": "new-code-standard"
  }
}
```

生成的 `docs/ai/decision-ledger.json` 记录扫描证据、已记录的 Agent/技术栈/深度决策和未决事项。对既有或证据不足的项目，默认边界是保护现有代码；任何现代化或迁移都需要单独的策略和新计划批准。

早期配置若没有初始分类，首次 `sync` 会用当时可见的仓库状态建立并持久化基线；它不能恢复未知的历史状态。之后的 `sync` 只使用这个已记录快照，新的源码增长只会成为 `assess` 的当前观察，不能静默切换治理路径。

## 目录与架构评估

`architecture` 只提出建议：新项目推荐先建立按领域拆分的模块边界；既有项目仅在存在可复核的扁平源目录、混合层职责或超大文件信号时报告发现。输出中的 `advice-only`、`new-code-standard`、`staged-migration` 与 `keep-current` 是用户策略选择，评估本身不移动文件；其中 `staged-migration` 必须创建新的现代化计划、兼容性验证与单独批准，不能由治理初始化隐式执行。

在生命周期与既有代码策略已确认后，`init` 还会生成唯一的受管 `docs/ai/architecture-profile.json` 和派生的 `docs/ai/rules/15_architecture.mdc`。profile 绑定初始化决策、技术栈候选、适用 scope、基线源码路径与验证边界：单仓 greenfield 的策略要求未来应用源进入 `src/` 的受允许模块或入口；`existing + new-code-standard` 将初始化时已有应用源记为基线，只检查随后新增的文件；`keep-existing` 与 `staged-migration` 只保留 advisory 边界；没有记录初始化决策的旧配置保持 `legacy-unconfigured`。旧版已确认 greenfield 若在 architecture profile 引入前已长出源码，也保持 `legacy-unconfigured`，不会被静默倒查或纳入空基线。工具绝不创建 `src`、空目录、示例业务代码，或移动/格式化业务树。`aicg check .` 仅检测当前树中的新增文件位置和受管 profile 一致性，不证明 import 依赖方向、高内聚、单一职责或完成了架构迁移。monorepo 在未确认 package scope 时保持 advisory，绝不把多个技术栈猜成同一个根目录模板。

## 自然语言请求边界

`request` 是 CLI 的自然语言入口，不是第二套实现。它先从 `assets/intent-registry.json` 精确匹配一个 intent，再构造含 `planHash` 的可序列化执行计划；模型、网页内容、仓库文本和 shell 片段都不能直接提升权限或形成命令。

- `environment.diagnose` 与 `governance.validate` 始终只读。
- `governance.initialize` 与 `governance.sync-managed` 在写入前必须计划、确认并在写后重新检查。
- 无匹配、多匹配或“修复/升级/优化”等尚未登记的歧义表达以退出码 2 停止，不能猜测为 `doctor` 或 `sync`。
- `--dry-run` 只输出计划，零写入；计划带目标根、配置和 manifest 快照、逐文件前置状态、所需权限和验证边界。
- `request` 的任何写入都须明确提供当前 `--dry-run` 输出的 `--approve <planHash>`；不存在交互确认旁路。配置文件仅提供决策输入，不等于批准更高风险操作。

## 固定决策顺序

### 自动侦察

先读取而不提问：目标目录、生命周期/拓扑、manifest 与 lockfile、技术栈和版本
证据、真实 package/build/test 命令、现有治理入口、外部工作流目录、当前 OS 和遗留链接。该阶段不运行 Git、Agent 可执行文件或项目命令；环境命令状态必须由只读 `doctor` 单独诚实报告。

### 必选项

1. 生命周期确认：新项目可接受高置信度扫描；manifest-only 项目必须确认 `greenfield` 或 `existing`，已有项目必须确认 `existing`。
2. 对 `existing`，既有代码策略：`keep-existing`、`new-code-standard` 或 `staged-migration`。后者只记录未来单独计划的边界，不授权本次迁移。
3. 至少一个 Agent：`codex`、`claude-code`、`cursor` 或 `generic`；`AGENTS.md` 始终是工具无关入口。
4. 至少一个技术栈包；没有可靠证据时用 `generic-unknown`。
5. 治理深度：`minimal`、`standard`、`complete`，交互默认 `standard`。
6. 治理产物语言：`zh-CN`、`en`、`bilingual`。
7. 生成计划确认：列出 write/keep/conflict 与待迁移对象，确认前不写文件。

### 可选项

- 目标 OS；默认 macOS、Windows、Linux，验证证据仍分别记录。
- 完整模式下的知识记忆与长任务运行时。
- hooks、CI 接线、外部工作流 provider；默认关闭，生成候选也不等于 `enforced`。
- 有证据的领域约束；空白时保留 gap，不生成通用 CRUD 冒充业务规则。
- AI 深度补全；只能选择本次配置已选择且本机可发现的 Agent，且当前扫描必须为高置信 `greenfield`。它不适用于既有或证据不足项目的初始化。

## 状态文件

`.ai-governance/config.json` 是确认决策；`.ai-governance/manifest.json` 是生成所有权与漂移证据。

配置至少包含：schema/tool version、project name/mode、canonical root、clients、stacks、depth、artifact
language、supported OS、features、domain constraints 和已确认的 `initialization` 决策。

manifest 只记录工具持续拥有的配置、入口区块与客户端副本；每项至少包含：仓库相对路径、`full` 或
`managed-block` 所有权、产物类型、正典来源和 SHA-256。`docs/ai` 人工正典由 CLI 首次播种，之后不因
`sync --force` 被模板回滚；缺失时检查失败，重新生成前必须明确迁移。时间戳不得破坏幂等性：输入与模板
不变时第二次初始化不能改文件。

## 无链接适配模型

- `AGENTS.md` 是共享入口；Codex 与 Cursor 使用其原生发现能力。
- Claude Code 的普通 `CLAUDE.md` 在受管区块里使用 `@AGENTS.md` 原生导入。
- Cursor rule 与各客户端 Skill 是普通生成文件；源文件与生成目标由 manifest 连接。
- 用户或 AI 只能编辑正典；适配器带 generated 标记。`check` 检测正典与副本漂移，`sync` 从正典恢复。
- 已有 `AGENTS.md` / `CLAUDE.md` 只替换稳定 begin/end 标记之间的内容，标记外内容原样保留。
- 新的未知文件、损坏标记、受管内容人工变化默认阻断。`--force` 也不能接管无标记、无 manifest 的文件。

迁移旧链接时，先定位第一个链接祖先并在计划中显示。只有显式授权后才 unlink 链接对象，再创建普通目录
或文件；不得递归删除链接目标。迁移后 `check` 必须证明全部受管路径都不是链接。

## Agent 辅助

注册表为每个 Agent 记录检测命令、原生入口、Skill/Rule 目录和交互命令。调用继承用户终端与目标工作
目录，不传 `--force`、危险 bypass 或自动审批参数。确定式阶段完成后才允许调用；返回后再次执行 `check`。

真实客户端加载仍要独立回放。可执行文件存在只证明 `installed`，不能证明生成入口已加载，更不能证明项目
行为正确。

## 验收

- 三款核心 Agent 单选、组合和 generic 都产生正确入口；未选 Agent 没有专属产物。
- React/Node/Java、多栈与 unknown 输出不同 stack profile，未认证包保持 `unverified`。
- dry-run 零写入；相同输入二次运行零变更。
- 受管漂移非零；`sync --force` 只恢复受管内容；未知文件始终保留。
- 空格、Unicode、Windows drive/UNC、LF/CRLF 可读；macOS/Windows/Linux CI 都运行打包后的 CLI。
- 遗留链接默认阻断；显式迁移只删除链接对象，目标内容仍存在；生成结果中不存在链接。
- Agent 缺失或失败不影响基础初始化成功，并留下 `unverified` 边界。

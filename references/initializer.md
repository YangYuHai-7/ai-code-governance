# `aicg init` 初始化协议

本协议定义 CLI 如何把仓库事实与用户选择编译成项目治理。实现入口是 `aicg init [path]`；它不依赖
符号链接、junction、管理员权限或特定 shell。

## 产品边界

初始化分两段：

1. **确定式生成**必须在没有模型、网络和 Agent 登录的情况下完成。它负责侦察、决策记录、基础规则、
   技术栈路由、普通文件适配器、内容哈希和结构检查。
2. **AI 深度补全**是可选阶段。它读取生成的 bootstrap prompt，研究当前标准并从真实仓库证据提取业务
   不变量。缺少 Agent 或调用失败只把该阶段标为 `unverified`，不撤销基础生成。

CLI 不发布 npm 包、不安装 Agent、不修改全局客户端配置，也不使用跳过审批或绕过沙箱的参数。

## 命令接口

| 命令 | 读写 | 契约 |
| --- | --- | --- |
| `aicg init [path]` | 写 | 扫描、访谈、预览、生成、检查，可选启动 Agent |
| `aicg check [path] [--json]` | 只读 | 校验配置、manifest、受管内容哈希、链接禁令和客户端可达性 |
| `aicg sync [path]` | 写 | 从正典重新生成 manifest 拥有的普通文件适配器 |
| `aicg doctor [path] [--json]` | 只读 | 检查 Node、Git、目录权限、Agent CLI 与遗留链接 |

通用退出码：`0` 成功；`1` 检查或执行失败；`2` 用法错误、输入不完整、用户取消或安全冲突。

`init` 支持：

- `--config <json>`：读取机器可复现答案；单独使用时必须包含 Agent、技术栈、深度和语言，和 `--yes`
  一起使用时才允许由侦察默认补齐缺项。
- `--yes`：接受侦察默认，不进入交互；默认选择三款核心 Agent、标准深度和所有 OS。
- `--dry-run`：输出扫描结果、计划文件和待迁移链接，不写任何内容。
- `--no-assist` / `--assist <agent>`：禁止或明确选择 AI 补全执行器。
- `--migrate-links`：显式授权迁移已知客户端路径上的旧链接。
- `--force`：只允许恢复 manifest 已拥有或带生成标记的内容，不覆盖未知用户文件。

无 TTY 且没有 `--yes` 或 `--config` 时必须以退出码 2 结束，不能靠猜测继续。

## 固定决策顺序

### 自动侦察

先读取而不提问：目标目录、Git 根、greenfield/brownfield/monorepo、manifest 与 lockfile、技术栈和版本
证据、真实 package/build/test 命令、现有治理入口、外部工作流目录、当前 OS、Agent 可执行文件和遗留链接。

### 必选项

1. 至少一个 Agent：`codex`、`claude-code`、`cursor` 或 `generic`；`AGENTS.md` 始终是工具无关入口。
2. 至少一个技术栈包；没有可靠证据时用 `generic-unknown`。
3. 治理深度：`minimal`、`standard`、`complete`，交互默认 `standard`。
4. 治理产物语言：`zh-CN`、`en`、`bilingual`。
5. 生成计划确认：列出 write/keep/conflict 与待迁移对象，确认前不写文件。

### 可选项

- 目标 OS；默认 macOS、Windows、Linux，验证证据仍分别记录。
- 完整模式下的知识记忆与长任务运行时。
- hooks、CI 接线、外部工作流 provider；默认关闭，生成候选也不等于 `enforced`。
- 有证据的领域约束；空白时保留 gap，不生成通用 CRUD 冒充业务规则。
- AI 深度补全；只能选择本次配置已选择且本机可发现的 Agent。

## 状态文件

`.ai-governance/config.json` 是确认决策；`.ai-governance/manifest.json` 是生成所有权与漂移证据。

配置至少包含：schema/tool version、project name/mode、canonical root、clients、stacks、depth、artifact
language、supported OS、features 和 domain constraints。

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

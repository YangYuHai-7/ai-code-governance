# 多轮访谈与决策账本

目标不是一次问完，而是在不重复、不猜测的前提下，逐步把项目事实和人的选择收敛成可执行治理方案。

## 基本原则

1. **先侦察后提问**：能从仓库确定的事实不问用户。
2. **一次处理一个高影响决策**：相关低风险问题可以成组，但每轮最多四问。
3. **使用用户当前语言**：首次回复先镜像用户语言，再确认治理产物语言。
4. **每个推荐都给理由**：写明它基于哪些仓库事实和约束。
5. **允许“不知道”**：转为开放问题或可见默认值，不强迫伪精确选择。
6. **选择可回退**：进入文件生成阶段前，用户可以修改任何未锁定决策。
7. **不以“完美”为完成标准**：以决策可追溯、规则有证据、验证边界诚实为标准。

## 访谈状态机

```text
discovered
  -> language_confirmed
  -> topology_confirmed
  -> platform_confirmed
  -> stack_confirmed
  -> governance_scope_confirmed
  -> domain_seeds_confirmed
  -> plan_approved
  -> building
  -> trial_validated
  -> delivered
```

任何阶段都可以回到前一阶段，但必须记录修改原因和受影响产物。`plan_approved` 之前不创建完整框架；只允许写用户同意的决策账本或设计稿。

## 决策账本

长任务经用户同意后，把账本放在目标项目既有计划目录；没有约定时使用：

```text
docs/plans/YYYY-MM-DD-ai-governance-profile.yaml
```

推荐结构：

```yaml
version: 1
status: stack_confirmed
interaction_language: zh-CN
artifact_language: bilingual
project_mode: brownfield
topology: repository-family

platform:
  current_os: macos
  supported_os: [macos, windows, linux]
  verified_os: [macos]
  adapter_mode: symlink

facts:
  - id: fact-001
    value: Node.js service
    evidence: package.json
    confidence: high

decisions:
  - id: decision-001
    topic: canonical_root
    value: docs/ai
    source: user
    status: confirmed

client_support:
  mode: all_built_in # all_built_in | selected
  selected_clients: [codex, claude-code, cursor]
  source: user
  status: confirmed

selected_packs:
  - id: backend-node
    version: v3.0
    evidence_level: supported

assumptions: []
open_questions: []
rejected_options: []
```

不要记录聊天逐字稿、密钥、客户数据或无助于恢复任务的内容。

## 访谈轮次

### Round 0：语言

确认三个独立选择：

| 选择 | 选项 |
| --- | --- |
| 交互语言 | 跟随用户 / 中文 / English |
| 治理产物语言 | 中文 / English / 双语 |
| 代码与标识符 | 沿用仓库（默认）/ 明确指定 |

双语模式只保留一个正典文件。规则和决策使用稳定 ID，把中文与英文放在同一个记录里；禁止建立 `docs/ai-zh/` 与 `docs/ai-en/` 两套正典。

### Round 1：项目模式与拓扑

让用户确认侦察结论：`greenfield`、`brownfield`、`monorepo`、`repository-family`。如果仓库为空，询问产品形态、部署边界和团队能力；如果已有代码，默认保留现有栈。

### Round 2：操作系统

区分当前系统、团队必须支持的系统和实际验证过的系统。询问 macOS、Windows、Linux 的目标范围，以及 Windows PowerShell 版本、容器/WSL 是否属于正式支持路径。不要把 WSL 通过当成原生 Windows 通过。

### Round 3：技术栈

**遗留项目**：展示检测到的语言、框架、版本来源和置信度，只问冲突与遗漏。不要给换栈提案，除非用户显式选择 `modernization-assessment`。

**新项目**：先问运行环境、团队经验、交付时间、长期维护、性能、合规和部署约束，再给 2–3 个栈组合。每个组合包含适配理由、代价、能力包证据等级和仍需验证的事项。

### Round 4：UI 选择

仅在项目有 UI 且尚未被现有设计系统决定时进入。采集产品类型、交互密度、品牌自由度、无障碍目标、SSR、主题需求、许可证政策和团队经验，然后按 [ui-selection.md](ui-selection.md) 给三个候选与“不采用 UI 框架”选项。

### Round 5：治理范围

沿用主 skill 的 A–C 组：深度、客户端、受众、正典位置、门禁、逃生舱、知识层。推荐项必须来自侦察，不是全局偏好。

客户端范围是本轮唯一不能被“自动完整模式”或客户端检测替代的选择。用户必须二选一：

- **全部内建客户端**：为 Codex、Claude Code、Cursor 与通用正典建立各自可达入口。
- **仅指定客户端**：让用户列出客户端，只为这些客户端生成适配器；其余明确记为 `not selected`。

检测到的配置、二进制或当前会话只用于说明“当前可验证什么”，不用于推断“团队未来要支持什么”。

### Round 6：领域种子

收集只有项目成员知道的内容：重复错误、任务档案、验证命令、硬边界、术语和完成定义。每条候选规则都要能追溯到一个回答或一个代码/事故证据。

### Round 7：回读与批准

按以下格式回读：

```text
已确认：...
基于证据的默认值：...
仍开放：...
明确不做：...
能力包等级：...
各操作系统验证状态：...
生成阶段与每阶段验收：...
```

只有用户批准后进入构建。

## 推荐表达

不要问“你想用什么框架？”这种把侦察工作推给用户的问题。遗留项目使用：

```text
仓库证据显示当前使用 <X>（证据：<path>），没有发现 <Y>。
推荐保留 <X>，因为 <项目约束>。
选择：保留（推荐）/ 补充信息 / 单独做现代化评估。
```

新项目提案使用：

```text
首选：<组合> — 匹配 <约束>；代价 <代价>；证据等级 <等级>。
备选：<组合> — 在 <条件> 下更合适。
轻量：<组合或无框架> — 减少 <成本>，但放弃 <能力>。
```

## 中断与恢复

恢复时先读决策账本，只回读从上次确认后新增或变化的部分。不要重问已确认问题。若代码在中断期间变化，更新相关 `facts`，标记受影响决策为 `needs-reconfirmation`，只重问这些决策。

# AI Code Governance

面向新建与遗留项目的跨技术栈、跨平台 AI 代码治理 Skill。

AI Code Governance inspects a real repository, interviews the user, and builds an evidence-based governance framework instead of copying generic rules into every project.

## 为什么需要它

AI 编码治理经常退化成一组很快过时的 Markdown：多个客户端各维护一份规则、文档与代码逐渐脱节、助手自己宣布“完成”，但没有任何检查可以证明结果。

本 Skill 把治理实现为三个相互约束的部分：

1. **唯一正典源**：规则只维护一次，Claude Code、Codex、Cursor 等客户端通过适配器读取。
2. **最小上下文路由**：根据任务类型加载必要规则，而不是把整个知识库塞进每次对话。
3. **机器门禁**：检查引用、适配器、知识漂移和完成证据；能机器判断的规则不只写成散文。

它来自真实多仓项目的治理实践，但不携带任何项目特有目录、API 或业务规则。目标项目的规则必须从其代码、测试、事故和用户决策中产生。

## 核心能力

| 能力 | 说明 |
| --- | --- |
| 仓库侦察 | 识别单仓、monorepo、仓库族、语言、框架、命令、文档、历史约束和现有 AI 配置 |
| 多轮访谈 | 区分仓库事实与用户决策，通过决策账本支持跨会话恢复 |
| 分层治理 | 提供 12 条核心原则和 L0–L11 十一层参考架构 |
| 技术栈能力包 | 识别前后端与平台组合，同时明确 `supported`、`unverified` 等证据等级 |
| UI 框架提案 | 基于产品、品牌、无障碍、SSR、许可证和团队约束提出三个候选及无框架方案 |
| 新旧项目适配 | 新项目提供约束驱动的方案；遗留项目默认保留原栈并增量治理 |
| 跨平台设计 | 覆盖 macOS、Windows、Linux 的路径、shell、适配器、hooks 和验证矩阵 |
| 强制与成长 | 提供门禁、负向探针、知识记忆、任务运行时和规则晋升/退休闭环 |

## 工作方式

```mermaid
flowchart LR
    A[仓库侦察] --> B[多轮访谈]
    B --> C[确认决策账本]
    C --> D[分阶段生成治理框架]
    D --> E[正向门禁与负向探针]
    E --> F[真实任务试运行]
    F --> G[反馈进入成长闭环]
```

### 1. 侦察

读取项目拓扑、技术栈、构建工具、真实命令、现有文档、AI 入口和历史反模式。能从仓库确定的事实不会反问用户。

### 2. 访谈

确认治理深度、AI 客户端、强制力、知识层、技术栈、UI、产物语言、目标 OS 和硬边界。复杂任务会把选择记录到可恢复的决策账本。

### 3. 计划

在写文件前列出产物、规则来源、上下文档案、门禁链、能力包等级、平台状态和明确不做的事项，并等待用户确认。

### 4. 分阶段构建

1. 入口、常驻规则和上下文路由。
2. 结构检查器、门禁与客户端适配器。
3. 项目规则、反模式、skills、commands、agents 和验证档案。
4. 知识记忆、任务运行时、hooks 和成长闭环。

### 5. 验证

不仅证明检查能通过，还通过内存或可逆方式故意注入错误，证明检查器能够失败。最终交付区分：

- `enforced`：存在会失败的机器检查；
- `stated`：只有文字约束；
- `unverified`：尚未证明客户端、平台或组合真实工作。

## 支持范围

### 技术栈

| 产品线 | 范围 | 生命周期 | 当前证据 |
| --- | --- | --- | --- |
| v3.0 | React、Vue、Angular、Node.js、Java | active | supported |
| v3.1 | Svelte、Python、Go、PHP | planned | unverified |
| v4 | .NET/C#、Android、iOS、混合 App、桌面、C/C++ 与嵌入式 | roadmap | unverified |
| 通用适配 | 注册表未覆盖的语言或框架 | active | unverified |

`supported` 不等于 `certified`。认证要求固定样例、负向探针、多个真实项目和声明平台的验证证据。机器可读状态以 [能力包注册表](assets/capability-pack-registry.json) 为准。

### 操作系统

| 系统 | 当前状态 |
| --- | --- |
| macOS | skill 结构验证已通过 |
| Windows | 设计已覆盖，尚未实机执行 |
| Linux | 设计已覆盖，尚未实机执行 |

WSL 验证不等于原生 Windows 验证。详细约束见 [跨平台协议](references/cross-platform.md)。

### 项目模式

- `greenfield`：先确认业务与团队约束，再提出技术栈与 UI 候选。
- `brownfield`：保留现有栈，先增量建立治理。
- `monorepo`：判断根治理与包级自治的边界。
- `repository-family`：根层只负责编排、契约和跨仓知识。
- `modernization-assessment`：技术迁移独立评估，不与治理安装捆绑。

## 安装

这个仓库本身是一个 Agent Skill。可以将整个目录放入支持 Skill 的客户端目录，或放入项目级 `.agents/skills/`。

| 客户端 | 常见目录 |
| --- | --- |
| Claude Code | `~/.claude/skills/ai-code-governance/` |
| Codex | `~/.codex/skills/ai-code-governance/` |
| Cursor | `.cursor/skills/ai-code-governance/` |
| GitHub Copilot / 通用 Agent | `.agents/skills/ai-code-governance/` 或 `.github/skills/ai-code-governance/` |

具体自动加载能力取决于客户端版本；无法通过探针确认时，应标记为 `unverified`。

### macOS / Linux

```bash
git clone https://github.com/YangYuHai-7/ai-code-governance.git ~/ai-code-governance
mkdir -p ~/.claude/skills
ln -s ~/ai-code-governance ~/.claude/skills/ai-code-governance
```

根据实际客户端替换目标技能目录。

### Windows PowerShell

```powershell
$Skill = "$HOME\ai-code-governance"
git clone https://github.com/YangYuHai-7/ai-code-governance.git $Skill
New-Item -ItemType Directory -Force "$HOME\.claude\skills"
New-Item -ItemType Junction -Path "$HOME\.claude\skills\ai-code-governance" -Target $Skill
```

如果组织策略不允许 junction，可以复制目录，但应明确唯一维护源并建立同步检查。

## 快速使用

安装后直接用自然语言触发：

```text
为这个遗留 Java + Angular 项目建立标准深度的 AI 治理框架，保留现有技术栈。
```

```text
为一个新的 React + Node.js 项目设计完整治理框架，UI 框架先给我三个提案。
```

```text
参考另一个仓库的 AI 框架，只迁移通用思想，不复制它的项目特有规则。
```

Skill 会先侦察仓库并回读发现，再逐轮确认关键决策；不会在第一次回复中直接生成整棵目录。

## 治理深度

| 深度 | 组成 | 适用场景 |
| --- | --- | --- |
| 最小 | L0 入口 + L1 常驻规则 + L8 检查器 | 单人项目、先验证价值 |
| 标准 | 最小 + 上下文路由 + 项目规则 + 反模式 + 验证档案 | 多人团队默认选择 |
| 完整 | 标准 + 能力层 + 知识记忆 + 任务运行时 + hooks + 成长闭环 | 跨会话、多客户端、高风险任务 |

## 目录结构

```text
ai-code-governance/
├── SKILL.md
├── README.md
├── assets/
│   └── capability-pack-registry.json
├── references/
│   ├── principles.md
│   ├── layers.md
│   ├── templates.md
│   ├── capability-packs.md
│   ├── interview-protocol.md
│   ├── ui-selection.md
│   ├── cross-platform.md
│   └── ...
└── scripts/
    └── validate-skill.mjs
```

## 自验证

使用 Skill 不需要 Node.js；只有维护和验证这个 Skill 包时需要 Node.js 18+。

```bash
node scripts/validate-skill.mjs
node scripts/validate-skill.mjs --negative-probe
```

第一条检查 front matter、本地链接、能力包注册表、版本状态和 OS 证据。第二条在内存中注入重复能力包与断链，证明检查器确实能够拦截错误。

当前基线：15 个 Markdown 文件、16 个能力包；macOS 结构检查与负向探针通过。

## 设计原则

- 代码和测试高于文档。
- 先侦察、再访谈、最后构建。
- 规则来自目标项目的真实代码与真实失败。
- 每条机器禁令都要解释为什么，并尽量由检查器执行。
- 客户端目录只是适配器，不能成为第二正典。
- 遗留项目默认不换栈，现代化评估单独立项。
- 没有实际验证的命令、平台和客户端必须保持可见。

完整论证见 [十二条核心原则](references/principles.md)。

## 路线图

- v3.0：完成 Web 主流栈的团队内部试运行与证据收集。
- v3.1：建立 Svelte、Python、Go、PHP 能力包及样例矩阵。
- v3.x：补齐 Windows/Linux 实机验证、安装与升级协议。
- v4：扩展 .NET、移动端、桌面端和系统/嵌入式平台家族。
- 产品 C：只有通过真实项目和声明平台认证的组合才对外标记 `certified`。

## 贡献约束

1. 不从“通用最佳实践”直接生成目标项目规则。
2. 新能力包先进入 `unverified`，取得可复现证据后再晋级。
3. 修改能力包状态时同步注册表与说明文档。
4. 新检查必须带负向探针，证明它真的会失败。
5. 不把客户代码、内部 API、密钥或原始业务数据提交到本仓库。

## License

本项目采用 [Apache License 2.0](LICENSE)。它允许商业使用、修改和再分发，并提供明确的专利授权条款。

详细资料从 [SKILL.md](SKILL.md) 的“深入阅读”索引进入。

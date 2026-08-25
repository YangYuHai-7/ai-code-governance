---
name: ai-code-governance
description: >-
  为新建或遗留项目生成、扩展或产品化 AI 代码治理框架：先侦察真实仓库并多轮访谈，再按项目拓扑、自然语言、操作系统、前后端技术栈和 UI 约束定制唯一正典源、上下文路由、skills/commands/subagents、知识记忆、机器检查器、完成门禁、运行时钩子与成长闭环。支持 macOS、Windows、Linux 和团队内部标准化，并演进为可分发治理产品；适用于 React、Vue、Angular、Svelte、Node.js、Java、Python、Go、PHP 及其他待认证栈，也为 C#/.NET、Android、iOS、混合 App、桌面端和 C/C++ 平台包预留扩展协议。当用户提到 AI governance framework、agent framework、AGENTS.md、CLAUDE.md、docs/ai、context engineering、cross-platform、stack selection、UI framework proposal、legacy modernization、hooks、completion gate、memory layer、port framework，或 AI 治理框架、代理框架、跨平台、上下文工程、技术栈选择、UI 框架选型、老旧项目治理、门禁、记忆库、移植治理框架时使用。
---

# AI 代码治理框架

给一个仓库建立（或扩展）一套让所有 AI 编码助手行为可预测、可审计的治理框架。

**产物不是一堆 Markdown。** 产物是三件事：一个**唯一正典规则源**、一层**让上下文保持最小的路由**、以及**一组在文档与代码脱节时会失败的机器检查**。少了第三件，前两件大约三周后开始腐烂——贡献者发现文档是虚构的，于是不再读它，于是框架变成考古现场。

本 skill 蒸馏自一套在生产仓库中长期运行的治理框架，只保留跨技术栈通用的**思想**与**结构**，不含任何具体栈的规则内容。具体规则必须从目标仓库的真实代码和真实事故里长出来。

## 产品定位与版本边界

本 skill 的交付路线是：先作为**团队内部标准化治理工具（B）**积累证据，再演进为**可分发到不同项目的治理产品（C）**。版本号表示能力包覆盖范围，不改变下文的十二条原则和十一层架构：

- **v3.0**：首批支持 React、Vue、Angular、Node.js、Java；支持中文、英文、双语访谈与治理产物，并把 macOS、Windows、Linux 纳入验证矩阵。
- **v3.1**：增加 Svelte、Python、Go、PHP 的认证能力包。
- **v4**：沿用同一治理内核，增加 `.NET/C#`、原生移动端、混合 App、桌面端、嵌入式与 `C/C++` 平台家族包。
- **其他技术栈**：允许通过通用适配流程治理，但必须标记为 `unverified`，不得暗示已经达到认证能力包的证据等级。

技术栈能力包提供侦察信号、候选约束和验证发现方法，**不提供可以直接抄入目标项目的通用规则**。遗留项目默认在原栈上增量治理；技术现代化是独立、显式选择的评估任务，不与治理落地捆绑。

跨系统实现与认证要求见 [references/cross-platform.md](references/cross-platform.md)。当前系统执行通过只能证明当前系统；其余系统必须分别标记为已验证、未验证或不支持。

B → C 的产品结构与能力证据等级见 [references/product-architecture.md](references/product-architecture.md)。技术栈状态以 [assets/capability-pack-registry.json](assets/capability-pack-registry.json) 为准，使用协议见 [references/capability-packs.md](references/capability-packs.md)。

## 不可协商的工作方式

每一条都对应一种已知失败：

1. **先侦察，再访谈，最后构建。** 绝不从假设生成目录树。规则由模型凭空发明 = 描述了一个不存在的仓库。
2. **问，不要猜。** Step 2 的访谈是本 skill 的核心。用户说「你定」时，套用文档化的默认值，并把这个假设**写进 `docs/ai/README.md`** 让它保持可见。
3. **分阶段交付。** 四个阶段，每段之间停下来确认。阶段 1 未确认不写阶段 3 的文件。
4. **正典源唯一；客户端目录只是适配器。** 优先使用相对符号链接；Windows 或客户端不支持时，可以使用工具生成且有哈希/漂移检查的镜像。适配器不可人工维护，绝不成为第二正典。
5. **规则来自本仓库的真实代码与真实事故**，不来自模板清单或另一个仓库的约定。读代码 → 提候选 → 用户确认 → 才写下。
6. **每条机器强制的禁令都要有写下来的理由**，放 `anti-patterns.md`。没有理由的禁令会被下一个撞上它的人删掉。
7. **绝不写你没跑过的命令。** 落进入口文件的每条命令都必须真实存在于 `package.json` / `Makefile`，并且本次会话执行成功过，否则标 `# not yet verified`。
8. **无法验证的适配器要说出来。** 如果没有任何东西能证明某客户端真的自动加载了某文件，就在 README 里写明，而不是让它长得像治理。
9. **不碰 CI/CD、部署、发布配置**，除非用户要求。
10. **已有框架就扩展，不重构。** 沿用它的命名、编号、语气。发现结构性问题就报告，不要单方面修掉。
11. **平台支持按证据报告。** macOS、Windows、Linux 分别记录 gate、hook 和适配器状态；未在对应系统运行过就标 `not yet verified`，不得用“看起来可移植”代替验证。
12. **能力等级必须诚实。** `certified`、`supported`、`unverified`、`unsupported` 有不同证据要求；不能把“识别到了技术栈”写成“已认证”。
13. **技术栈包只提供候选。** 包里的架构和验证知识必须由目标仓库证据或用户选择确认后，才能成为项目规则。
14. **遗留项目默认不换栈。** 先在原栈上建立治理；现代化评估必须单独立项和批准。
15. **多语言仍然只有一个正典。** 双语产物在同一个正典记录中用稳定 ID 对齐，不建中英文两套规则树。

## 十二条核心思想

完整论证（每条的主张 / 为什么 / 怎么落地 / 违背时的症状）见 [references/principles.md](references/principles.md)。

| # | 思想 | 一句话 |
| --- | --- | --- |
| P1 | 单一正典源 + 适配器 | N 个客户端 × M 份拷贝 = 必然分叉；工具目录只放符号链接 |
| P2 | 按档案路由上下文 | 不做全量加载；按任务档案（profile）加载最小可用上下文 |
| P3 | 代码是事实来源 | 文档是快照且必然跑慢一拍；分歧时改仓库，别发明第三条规则 |
| P4 | 完成由门禁判定 | 不是助手宣布"done"，是门禁通过或被显式标记为阻塞 |
| P5 | 只有被检查的规则活着 | 每条治理声明要么有检查，要么必须标注「仅陈述」/「未验证」 |
| P6 | 门禁与风险成比例 | 改动越核心，要求越多；且批量在任务末尾跑，绝不逐文件跑 |
| P7 | 禁令必须可追溯 | 每条 anti-pattern 追溯到一次真实 review 结论或事故 |
| P8 | 逃生舱要存在且被审计 | 门禁误报是常态；提供带理由、限时、单次的 ack，而不是静默绕过 |
| P9 | guardrail 失败要 fail open | 坏掉的守卫绝不能让仓库不可用；退化为警告并说出来 |
| P10 | 任务状态外化 | 上下文窗口会重置、工具会换人；状态写进文件才能存活 |
| P11 | 记忆写「现在是什么」 | 知识层不是变更日志；git log 已经记了历史 |
| P12 | 诚实的最轻仪式 | 小任务不做大仪式，但不得用「任务小」来跳过行为变更的验证 |

## 十一层参考架构

逐层规格（职责、文件形态、写什么不写什么、行业标准 vs 本地发明）见 [references/layers.md](references/layers.md)。

| 层 | 名称 | 最小产物 | 深度 |
| --- | --- | --- | --- |
| L0 | 入口与引导 | `AGENTS.md`（正典入口）+ `CLAUDE.md`（仅指针 + `@` 导入）+ 适配器符号链接 | 最小 |
| L1 | 常驻规则 | `docs/ai/rules/00_always.mdc`，一个文件，≤80 行 | 最小 |
| L2 | 上下文路由 | `docs/ai/context-map.yaml`：档案 = 触发词 + required/optional + verify | 标准 |
| L3 | 领域规则与策略 | `docs/ai/rules/NN_<关注点>.mdc`（按档案触发）+ `policies/` | 标准 |
| L4 | 反模式 | `docs/ai/anti-patterns.md`：Wrong / Right / Why wrong | 标准 |
| L5 | 能力层 | `skills/`（任务触发的怎么做）+ `commands/`（可重复流程）+ `agents/`（分阶段角色） | 完整 |
| L6 | 知识记忆层 | `docs/memory/<module>/`：当前状态 + 可机器校验断言 | 完整 |
| L7 | 验证档案 | `docs/ai/verification-profiles.yaml`：路径 → 命令 → 兜底 | 标准 |
| L8 | 检查器 | `docs/ai/tools/check-*.js`：唯一真正的强制力 | 最小 |
| L9 | 任务运行时 | `harness/`：task.yaml + 状态机 + 兜底策略 + 按类型门禁 | 完整 |
| L10 | 运行时钩子 | `tools/hooks/`：session-start / post-tool-use / pre-compact / stop | 完整 |
| L11 | 成长闭环 | `harness/lifecycle.md`：失败 → 提升 → 退休 | 完整 |

深度分级：

- **最小** = L0 + L1 + L8（一个检查器 + 一条门禁命令）。单人项目、或先证明价值再扩。
- **标准** = 最小 + L2 + L3 + L4 + L7。多人团队的默认档。
- **完整** = 标准 + L5 + L6 + L9 + L10 + L11。跨会话长任务、敏感数据、多客户端团队。

**不要跳级。** L8 的检查器在 L2/L3 存在之前就该建立——它是唯一防腐机制。反过来先堆 L5/L6 再补检查器，等到补的时候已经有一层需要考古的文档。

## Step 1 — 侦察（在问任何问题之前）

读仓库，让访谈是有信息量的、选项是具体的。不问就该测出来：

- **形态** — 单仓库 / monorepo workspaces / 一族兄弟 checkout。真实代码在哪。
- **技术栈与工具链** — 语言、框架、包管理器、测试运行器、linter、formatter、类型检查。
- **平台与 shell** — 当前 OS、团队支持的 OS、shell/PowerShell 版本、路径大小写、换行、symlink/junction 能力、已有 `core.hooksPath`。
- **真实命令** — `package.json` / `Makefile` / `justfile` 里的每个脚本。标出哪些**快到可以当门禁**（实测耗时）。
- **已有什么** — `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/`、`.github/copilot-instructions.md`、`docs/ai/`、`docs/memory/`、`.claude/settings.json`、`.git/hooks/` 与 `core.hooksPath`。
- **既有文档地貌** — 架构文档、ADR、README 深度；框架应该**链接**它们而不是重述。
- **真实反模式** — 遗留区、废弃 helper、双实现、"不要用这个目录"的注释、最近被 revert 的提交。这是 L3/L4 的原料，也是访谈 D1 的种子。
- **词汇** — 代码与文档里被不一致使用的领域名词。

然后给用户一份 ≈10 行的发现摘要：形态、栈、候选门禁命令（含耗时）、已有什么、3–8 条候选反模式。**不要从侦察静默滑进构建。**

同时把项目分类为 `greenfield`、`brownfield`、`monorepo` 或 `repository-family`，按 [references/capability-packs.md](references/capability-packs.md) 匹配能力包并记录证据路径。检测到未知栈时选 `generic-unknown` 并标记 `unverified`；缺少目标 checkout、构建描述或必需专家输入才是 `unsupported`。

## Step 2 — 访谈

按 [references/interview-protocol.md](references/interview-protocol.md) 进行可恢复的多轮访谈。**用用户的语言**，一次只处理一个高影响决策；紧密相关的低风险问题每轮最多 4 问。侦察得出的默认值标 `(推荐)`。A–C 组是选择题；D 组需要散文，用纯文本开放提问。

复杂或跨会话定制在用户同意后建立决策账本，记录事实来源、已确认选择、默认假设、开放问题、被否决方案、能力包等级和各 OS 验证状态。恢复任务时先读账本，不重复询问已经确认的内容。

### A. 范围

| # | 问题 | 选项 |
| --- | --- | --- |
| A1 | 框架深度？ | **标准** / 最小 / 完整（见上表） |
| A2 | 哪些客户端必须读到同一套规则？ | 仅 Claude Code / + Cursor / + Codex / 全部 + 通用 `docs/ai/` |
| A3 | 给谁用？ | 单人 / 团队 / 团队 + CI 强制 |
| A4 | 正典位置？ | `docs/ai/`（推荐）/ `.ai/` / 侦察发现的位置 |
| A5 | 哪些操作系统必须支持？ | 当前系统 / macOS + Windows + Linux（产品化推荐）/ 自定义矩阵 |

monorepo 或仓库族还要问：根一套框架，还是每包/每仓一套 + 根上一个薄路由？**各包约定确实不同 → 分治 + 根路由；共享一套约定 → 单一根框架。**

### B. 强制力

| # | 问题 | 选项 |
| --- | --- | --- |
| B1 | 完成门禁有多硬？ | 仅建议 / git `pre-commit` / pre-commit + Claude Code `Stop` 钩子（完整档推荐） |
| B2 | 门禁命令叫什么、串哪些检查？ | `npm run gate` / 侦察发现的现有脚本 / 自定义 |
| B3 | 门禁误判时的逃生舱？ | 带理由的 ack 命令（推荐）/ 环境变量 / 无 |
| B4 | 允许我在这个 clone 里装 git hook 吗？ | 是，用幂等安装脚本 / 否，只打印说明 |

明确讲清楚：`Stop` 钩子只绑 Claude Code，其他客户端靠 git hook。无论 B1 选什么，README 都必须记录**什么是被强制的 vs 什么只是被陈述的**（P5）。

### C. 知识层

| # | 问题 | 选项 |
| --- | --- | --- |
| C1 | 持久知识文档（`docs/memory/`）？ | 是，按模块（完整档推荐）/ 是，单一索引页 / 否，只要规则 |
| C2 | 漂移检查严格度？ | 文档引用的每个路径都必须存在（推荐）/ 只查索引 / 无 |
| C3 | 生成式 API 文档？ | 是，从代码注解生成、永不手改 / 否 |
| C4 | 既有文档：吸收还是链接？ | 从框架链接（推荐）/ 移入 `docs/ai/` / 完全不动 |

### D. 内容种子（开放问题——只有用户能回答的部分）

1. **最常犯的错**：AI 或新贡献者在这个仓库反复做错的 3–5 件事？（确认或修正侦察给出的候选）→ 变成 L3 编号规则。
2. **任务档案**：反复出现的 3–6 类工作？（加接口、加页面、改契约、修 bug、写迁移……）→ 变成 L2 的 profiles。
3. **每档案的验证命令**：每类工作靠什么真正证明它能用？要精确命令。
4. **硬边界**：遗留/冻结目录、绝不可编辑的文件、不允许互相 import 的层。
5. **词汇**：只有一种正确写法的术语；被错误混用的术语。
6. **完成定义**：说出"done"之前必须成立的是什么？

D2/D3 答不出来时：只建一个 `default` 档案的骨架，并说明档案会随模式浮现而增加——**凭空发明的档案清单比没有档案更糟**。

### E. 技术栈、UI 与产物语言

| # | 问题 | 处理方式 |
| --- | --- | --- |
| E1 | 新项目还是遗留项目？ | 侦察后让用户确认；遗留项目默认保留现有栈 |
| E2 | 前后端技术组合？ | 新项目基于约束给 2–3 个组合；遗留项目展示检测结果与证据 |
| E3 | 是否需要 UI 框架提案？ | 按 [references/ui-selection.md](references/ui-selection.md) 给首选、备选、轻量与无框架选项 |
| E4 | 交互与治理产物使用什么语言？ | 跟随用户 / 中文 / English；产物选中文 / English / 双语 |
| E5 | 是否要做技术现代化评估？ | 默认否；选择“是”时建立独立范围，不混入治理落地 |

## Step 3 — 计划

产出并取得批准：

- 文件清单（路径 → 一行用途），按阶段分组
- 编号规则清单（只要标题），每条追溯到 D1 的某个回答
- `context-map.yaml` 档案名，追溯到 D2
- 门禁链，含精确命令与**实测**耗时
- 什么会被强制 vs 什么只是被陈述
- 对任何被搁置的问题所套用的默认假设
- 选中的能力包、版本、证据等级与组合边界
- 交互语言、治理产物语言和双语对齐方式
- macOS、Windows、Linux 的目标支持与当前验证状态
- 遗留项目是否保持原栈；现代化评估必须列为独立范围

复杂项目按 [references/team-orchestration.md](references/team-orchestration.md) 分离侦察、访谈、架构、栈专家、实现和独立审计角色。一个人可以兼任，但探索、设计和批准不能在同一步骤自证。

## Step 4 — 分四阶段构建

各文件骨架见 [references/templates.md](references/templates.md)。检查器与钩子细节见 [references/gates-and-hooks.md](references/gates-and-hooks.md)。

**阶段 1 — 骨架。** L0 + L1 + L2：入口文件、`docs/ai/README.md`、`context-map.yaml`、`00_always.mdc`、按 A2 和目标 OS 选择 symlink、junction、原生导入或生成式适配器。
*验收*：A2 里选的每个客户端都能触达常驻规则，且这些文件里点到的每个路径都真实存在。每种目标 OS 分别记录已验证或未验证，不能从当前系统外推。

**阶段 2 — 门禁。** L8 + 按 B4 装 hook。
*验收*：**证明它会失败**——故意断掉一个符号链接、重命名一个被引用的文件，展示检查器在两处都失败，恢复，再展示通过。**从未失败过的检查器等于未知是否可用。**

**阶段 3 — 能力层**（完整档）。L3 + L4 + L5 + L7。
*验收*：每个 skill 的 `description` 都写清了触发条件（否则模型永远选不中它）；每条编号规则都映射到一个真实事故或代码路径。

**阶段 4 — 运行时**（完整档且 B1 = Stop 钩子）。L6 + L9 + L10 + L11。
*验收*：跑探针命令，确认钩子真的触发。确认不了就按第 8 条写进 README。

每阶段之后：总结 diff、跑该阶段验收、停下等确认。

## Step 5 — 验证与交付

- 批量跑一次完整门禁，**贴真实输出**。
- 按 macOS、Windows、Linux 分别报告 gate、hook probe 与适配器模式；未实际运行的系统明确写 `not yet verified`。
- 逐层给出台账：**已强制**（有检查会失败）/ **仅陈述**（只有散文）/ **未验证**（没人证明客户端真的读了它）。
- 在 `docs/ai/README.md` 记录：日期、深度档、被搁置问题所用的默认值，以及一段「如何扩展本框架」。
- 对照决策账本确认所有已批准选择都有产物或显式 gap，且没有重新打开被否决方案。
- 记录能力包版本与真实证据等级；未经认证的组合不得在交付摘要中写成“完全支持”。
- 如果目标仓库自身有记忆/文档义务，在同一次改动里满足它。
- **绝不以「文件已存在」为依据宣布框架落地。** 落地的证据是一次通过的门禁 + 一次真正用了它的会话。

## 元反模式（框架自身的坑）

| 反模式 | 为什么会失败 |
| --- | --- |
| 一次性生成 14 条规则 | 它们描述的是通用仓库；贡献者学会「文档是虚构的」就不再读了 |
| 有文档没检查器 | 静默漂移；半年后框架变成考古 |
| 真内容放在 `.claude/` / `.cursor/` 里 | 两个源分叉，且只有一个客户端看到修复 |
| 没人证明会被自动加载的适配器 | 长得像治理的装饰品——最糟的一种 AI 文档 |
| 写了自己没跑过的命令 | 第一个试它的人会对所有命令失去信任 |
| 慢到会被跳过的门禁 | 被跳过的门禁 = 没有门禁，还少了诚实 |
| 逐文件跑门禁 | 助手学会把它当噪音；正确姿势是批量在末尾跑一次 |
| 静默绕过（无审计的 kill switch） | 绕过成为默认路径，且没人知道 |
| 整份抄另一个仓库的规则 | 进口了那个仓库的历史，掩盖了本仓库的 |
| 在根上重述子模块文档 | 一个事实的第二份拷贝 = 第二个需要维持为真的东西 |
| 因为文件存在就宣布完成 | 落地由通过的门禁证明，不由 `ls` 证明 |

## 从一个样板仓库移植

用户点名一个参考仓库时（常见情形）：

1. **先读**它的入口文件、`docs/ai/README.md`、context map、常驻规则、检查器、适配器布局，**再动手**。用你自己的话把层次结构讲回去。
2. 把内容分三桶：**结构性**（照搬形状）、**可改编**（意图相同、细节不同）、**仓库特有**（留下——它的栈、模块名、遗留区）。
3. 桶 1 原样移植；桶 2 基于本仓库的侦察结果重写；桶 3 列出你丢掉了什么，让用户有机会否决。
4. **不修改样板仓库。** 它是只读参考。

## 本 skill 的自验证

修改本 skill 自身后运行：

```bash
node scripts/validate-skill.mjs
node scripts/validate-skill.mjs --negative-probe
```

第一条验证入口 front matter、本地链接、能力包注册表、v3/v4 状态和 OS 证据；第二条在内存中注入重复能力包与断链，证明检查器确实会失败。该命令验证的是可分发 skill 包，不代表任何目标项目、技术栈或操作系统已经完成认证。

## 深入阅读

| 文件 | 何时读 |
| --- | --- |
| [references/principles.md](references/principles.md) | 需要向用户论证某个设计决定，或要判断某条候选规则该不该存在 |
| [references/layers.md](references/layers.md) | 构建任意一层之前——逐层职责、边界、写什么不写什么 |
| [references/templates.md](references/templates.md) | 阶段 1–4 落文件时 |
| [references/gates-and-hooks.md](references/gates-and-hooks.md) | 建 L8 检查器或 L10 钩子时 |
| [references/memory-layer.md](references/memory-layer.md) | 建 L6 知识层、会话留痕、代码溯源、漂移门禁时 |
| [references/harness.md](references/harness.md) | 建 L9 任务运行时（跨会话/敏感/大任务）时 |
| [references/lifecycle.md](references/lifecycle.md) | 框架已落地，要回答「怎么让它不腐烂」时 |
| [references/cross-platform.md](references/cross-platform.md) | 支持 macOS/Windows/Linux，设计路径、脚本、适配器、hooks 或认证矩阵时 |
| [references/product-architecture.md](references/product-architecture.md) | 判断 B → C 产品边界、项目模式或能力证据等级时 |
| [references/interview-protocol.md](references/interview-protocol.md) | 多语言、多轮访谈、技术/UI 选型或跨会话恢复时 |
| [references/capability-packs.md](references/capability-packs.md) | 检测、选择、组合或认证 v3/v4 技术栈能力包时 |
| [references/ui-selection.md](references/ui-selection.md) | 为 React/Vue/Angular/Svelte 提出 UI 候选或评估遗留 UI 时 |
| [references/team-orchestration.md](references/team-orchestration.md) | 组建专家团队、定义 subagent 边界或做产品化发布时 |

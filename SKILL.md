---
name: ai-code-governance
description: >-
  为代码仓库建立或扩展 AI 编码治理框架：识别用户技术栈并检索当前官方/主流开发标准，结合业务不变量生成细粒度编码 skills，同时建立唯一正典源、上下文路由、AGENTS.md/CLAUDE.md 适配器、知识记忆、机器门禁、hooks 与成长闭环。用户说“AI 编码治理框架”“代码治理框架”“根据技术栈生成开发规范/skills”或在代码仓库、AGENTS.md、skills、门禁、hooks 语境下说“治理框架”时使用。未指定深度时默认自动完整模式；明确指定最小、标准或完整时遵从用户。不用于产品 AI 安全、模型风险、隐私合规、监管或业务治理，除非用户同时要求治理 AI 编码助手。
---

# AI 代码治理框架

给一个仓库建立（或扩展）一套让所有 AI 编码助手行为可预测、可审计的治理框架。

**产物不是一堆 Markdown。** 产物是三件事：一个**唯一正典规则源**、一层**让上下文保持最小的路由**、以及**一组在文档与代码脱节时会失败的机器检查**。少了第三件，前两件大约三周后开始腐烂——贡献者发现文档是虚构的，于是不再读它，于是框架变成考古现场。

本 skill 蒸馏自一套在生产仓库中长期运行的治理框架。它不携带一份冻结的“万能最佳实践”，但必须根据目标技术栈主动检索当前官方/权威标准，直接生成项目可用的标准编码 skills；再根据需求、代码和业务不变量生成项目业务写法 skills。技术标准与项目事实分别记录来源，不能把前者冒充业务决定，也不能因后者尚无代码就放弃 greenfield 的明确用户需求。

## 短语触发与自动完整模式

把用户的短语当作完整意图，不要要求用户复述长命令：

- **强触发**：`AI 编码治理框架`、`AI 代码治理框架`、`编码治理框架`、`代码治理框架`、`Agent 治理框架`、`代理治理框架`。
- **语境触发**：单独出现`治理框架`时，只有当当前任务明确涉及代码仓库、AI 编码助手、`AGENTS.md`、`CLAUDE.md`、skills、subagents、门禁或 hooks 才触发。
- **排除语境**：如果重点是模型输出安全、健康/金融风险、数据隐私、公平性、监管合规或产品问责，这是产品 AI 治理，不是本 skill。

模式选择：

1. 用户明确说“最小”、“标准”、“完整”或“先出方案/分步确认”时，严格遵从。
2. 用户只说上述触发短语、“建立治理”或“完成治理框架”时，默认进入**自动完整模式**（L0–L11）。
3. 自动完整模式仍先侦察仓库，但能从代码、配置、文档和 git 历史得到的答案不再反问用户。先简短回读发现和计划，然后连续执行各阶段。
4. 只在不同选择会实质改变产物、需要新的外部权限，或涉及安装 git/Stop hook、修改 CI/CD、发布或外部系统时才停下询问。**客户端支持范围 A2 永远属于实质选择**：用户未明确说过时，即使是自动完整模式也必须先问“全部内建客户端”还是“仅指定客户端”。
5. 默认使用 `docs/ai/` 作为正典、用户当前语言作为交互与产物语言、当前 OS 作为已验证平台；其他 OS 标记 `not yet verified`。仓库里检测到哪个客户端只能作为现状证据，不能替用户决定支持范围；取得 A2 选择后才生成对应适配器。
6. 无法从仓库证据得到的领域事故、硬边界或完成定义必须记为明确 gap；不为了“自动”而编造规则。

## 产品定位与版本边界

本 skill 的交付路线是：先作为**团队内部标准化治理工具（B）**积累证据，再演进为**可分发到不同项目的治理产品（C）**。版本号表示能力包覆盖范围，不改变下文的十二条原则和十二层架构：

- **v3.0**：首批支持 React、Vue、Angular、Node.js、Java；支持中文、英文、双语访谈与治理产物，并把 macOS、Windows、Linux 纳入验证矩阵。
- **v3.1**：增加 Svelte、Python、Go、PHP 的认证能力包。
- **v4**：沿用同一治理内核，增加 `.NET/C#`、原生移动端（Android、iOS）、混合 App、桌面端、嵌入式与 `C/C++` 平台家族包。
- **其他技术栈**：允许通过通用适配流程治理，但必须标记为 `unverified`，不得暗示已经达到认证能力包的证据等级。

技术栈能力包提供侦察信号、研究主题、skill 候选和验证发现方法。Agent 必须对已确认的栈检索目标版本官方文档、正式标准与权威安全基线，综合成项目级细粒度 skills；不直接复制文档，不使用无版本、无来源的模型记忆。遗留项目默认在原栈上增量治理；技术现代化是独立、显式选择的评估任务，不与治理落地捆绑。

## 动态技术标准与业务 Skill 工厂

完整协议见 [references/stack-skill-generation.md](references/stack-skill-generation.md)。自动完整模式默认执行，不等待用户额外说“生成开发规范”：

1. **识别**：记录语言、运行时、框架、UI/ORM/数据库/消息/媒体/队列及版本证据。
2. **检索**：针对实际编码决策搜索当前官方文档、语言/协议标准和权威安全基线；软件版本可能变化时必须联网验证。
3. **分解**：按可直接提出的任务生成细粒度栈 skills，而不是每个框架一个巨型 skill。
4. **项目化**：用真实目录、模块、actor、tenant、状态机和错误语义改写标准代码形状。
5. **业务化**：从高频用例与高后果边界生成业务动词 skills；缺少业务证据时只记 gap。
6. **路由与证明**：生成 stack/source/skill 覆盖清单、context profiles、能力目录和负向探针，再做独立现实请求 forward-test。

产物至少覆盖三类：栈基础 skills、横切质量 skills、业务写法 skills。`industry-standard`、`project-decision`、`business-invariant` 与 `unverified` 必须可区分。

跨系统实现与认证要求见 [references/cross-platform.md](references/cross-platform.md)。当前系统执行通过只能证明当前系统；其余系统必须分别标记为已验证、未验证或不支持。

B → C 的产品结构与能力证据等级见 [references/product-architecture.md](references/product-architecture.md)。技术栈状态以 [assets/capability-pack-registry.json](assets/capability-pack-registry.json) 为准，使用协议见 [references/capability-packs.md](references/capability-packs.md)。

## 不可协商的工作方式

每一条都对应一种已知失败：

1. **先侦察，再访谈，最后构建。** 绝不从假设生成目录树。规则由模型凭空发明 = 描述了一个不存在的仓库。
2. **问，不要猜。** 引导模式通过 Step 2 访谈确认决策；自动完整模式只对可推断项使用上文默认，不猜测会实质改变产物的隐含决策。所有默认和 gap 都必须**写进 `docs/ai/README.md`**。
3. **分阶段交付。** 四个阶段都要有可见的 diff 摘要和验收。引导模式每段停下确认；自动完整模式在无需新授权时连续执行，不用用户重复发送“继续”。
4. **正典源唯一；客户端目录只是适配器。** 优先使用相对符号链接；Windows 或客户端不支持时，可以使用工具生成且有哈希/漂移检查的镜像。适配器不可人工维护，绝不成为第二正典。
5. **业务规则来自本仓库事实；技术写法来自当前权威标准。** 业务不变量按“需求/代码/测试/事故 → 候选 → 确认或证据 → 写入”；框架惯用法按“版本证据 → 官方/标准检索 → 兼容性判断 → 项目化 skill”。两条证据轨不能互相冒充。
6. **每条机器强制的禁令都要有写下来的理由**，放 `anti-patterns.md`。没有理由的禁令会被下一个撞上它的人删掉。
7. **绝不写你没跑过的命令。** 落进入口文件的每条命令都必须真实存在于 `package.json` / `Makefile`，并且本次会话执行成功过，否则标 `# not yet verified`。
8. **无法验证的适配器要说出来。** 如果没有任何东西能证明某客户端真的自动加载了某文件，就在 README 里写明，而不是让它长得像治理。
9. **不碰 CI/CD、部署、发布配置**，除非用户要求。
10. **已有框架就扩展，不重构。** 沿用它的命名、编号、语气。发现结构性问题就报告，不要单方面修掉。
11. **平台支持按证据报告。** macOS、Windows、Linux 分别记录 gate、hook 和适配器状态；未在对应系统运行过就标 `not yet verified`，不得用“看起来可移植”代替验证。
12. **能力等级必须诚实。** `certified`、`supported`、`unverified`、`unsupported` 有不同证据要求；不能把“识别到了技术栈”写成“已认证”。
13. **技术栈包触发研究与生成，不是静态规则库。** 用户确认或仓库证明技术栈后，应直接生成有当前来源和版本边界的标准编码 skills；项目架构选择仍需仓库证据或用户决定。
14. **遗留项目默认不换栈。** 先在原栈上建立治理；现代化评估必须单独立项和批准。
15. **多语言仍然只有一个正典。** 双语产物在同一个正典记录中用稳定 ID 对齐，不建中英文两套规则树。
16. **标准 skill 必须细粒度且可路由。** “React 最佳实践”“Node 开发规范”这种巨型文档不算完成；要拆成组件、状态、表单、接口、授权、Repository、事务、事件等可识别任务。
17. **业务 skill 必须使用项目名词和不变量。** 只生成通用 CRUD 示例不算业务治理；但未知角色、状态和副作用必须保持开放问题，不能为了完整而编造。

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
| P9 | 后台守卫可降级，交付证据必须失败 | ambient hook 出错可警告放行并降级为 unverified；显式 gate/pre-commit/CI 检查器异常必须非零 |
| P10 | 任务状态外化 | 上下文窗口会重置、工具会换人；状态写进文件才能存活 |
| P11 | 记忆写「现在是什么」 | 知识层不是变更日志；git log 已经记了历史 |
| P12 | 诚实的最轻仪式 | 小任务不做大仪式，但不得用「任务小」来跳过行为变更的验证 |

## 十二层参考架构

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
| L10 | 运行时钩子 | `tools/hooks/`：session-start / post-tool-use / pre-compact / stop | 完整（客户端支持时） |
| L11 | 成长闭环 | `harness/lifecycle.md`：失败 → 提升 → 退休 | 完整 |

深度分级：

- **最小** = L0 + L1 + L8（一个检查器 + 一条门禁命令）。单人项目、或先证明价值再扩。
- **标准** = 最小 + L2 + L3 + L4 + L7。多人团队的默认档。
- **完整** = 标准 + L5 + L6 + L9 + L11；目标客户端支持且选择生命周期钩子时再加 L10。跨会话长任务、敏感数据、多客户端团队。

**不要跳级。** L8 的检查器在 L2/L3 存在之前就该建立——它是唯一防腐机制。反过来先堆 L5/L6 再补检查器，等到补的时候已经有一层需要考古的文档。

## Step 1 — 侦察（在问任何问题之前）

读仓库，让访谈是有信息量的、选项是具体的。不问就该测出来：

- **形态** — 单仓库 / monorepo workspaces / 一族兄弟 checkout。真实代码在哪。
- **技术栈与工具链** — 语言、框架、包管理器、测试运行器、linter、formatter、类型检查。
- **版本与组合** — lockfile/manifest/配置里的运行时、框架、UI、ORM、数据库、实时、媒体和队列版本；用户已确认但尚未安装的 greenfield 选型单独记录。
- **平台与 shell** — 当前 OS、团队支持的 OS、shell/PowerShell 版本、路径大小写、换行、symlink/junction 能力、已有 `core.hooksPath`。
- **真实命令** — `package.json` / `Makefile` / `justfile` 里的每个脚本。标出哪些**快到可以当门禁**（实测耗时）。
- **已有什么** — `AGENTS.md`、`CLAUDE.md`、`.cursor/rules/`、`.github/copilot-instructions.md`、`docs/ai/`、`docs/memory/`、`.claude/settings.json`、`.git/hooks/` 与 `core.hooksPath`。
- **既有文档地貌** — 架构文档、ADR、README 深度；框架应该**链接**它们而不是重述。
- **真实反模式** — 遗留区、废弃 helper、双实现、"不要用这个目录"的注释、最近被 revert 的提交。这是 L3/L4 的原料，也是访谈 D1 的种子。
- **词汇** — 代码与文档里被不一致使用的领域名词。

然后给用户一份 ≈10 行的发现摘要：形态、栈、候选门禁命令（含耗时）、已有什么、3–8 条候选反模式。引导模式在此等待确认；自动完整模式明确说明使用的默认后继续，不从侦察**静默**滑进构建。

同时把项目分类为 `greenfield`、`brownfield`、`monorepo` 或 `repository-family`，按 [references/capability-packs.md](references/capability-packs.md) 匹配能力包并记录证据路径。检测到未知栈时选 `generic-unknown` 并标记 `unverified`；缺少目标 checkout、构建描述或必需专家输入才是 `unsupported`。

## Step 2 — 访谈或自动决策

引导模式按 [references/interview-protocol.md](references/interview-protocol.md) 进行可恢复的多轮访谈。**用用户的语言**，一次只处理一个高影响决策；紧密相关的低风险问题每轮最多 4 问。侦察得出的默认值标 `(推荐)`。A–C 组是选择题；D 组需要散文，用纯文本开放提问。

自动完整模式将 A–E 当作决策检查表：先填入仓库证据和本文默认，只对仍然会改变产物或需要授权的项目提问。不得因为略过普通访谈就略过决策记录。

复杂或跨会话定制要建立决策账本，记录事实来源、已确认选择、默认假设、开放问题、被否决方案、能力包等级和各 OS 验证状态。引导模式在用户同意后创建；自动完整模式将它作为仓库内产物直接创建。恢复任务时先读账本，不重复询问已经确认的内容。

### A. 范围

| # | 问题 | 选项 |
| --- | --- | --- |
| A1 | 框架深度？ | **标准** / 最小 / 完整（见上表） |
| A2 | 哪些客户端必须读到同一套规则？ | **全部内建客户端**（Codex + Claude Code + Cursor + 通用正典）/ **仅指定客户端**（列出名称） |
| A3 | 给谁用？ | 单人 / 团队 / 团队 + CI 强制 |
| A4 | 正典位置？ | `docs/ai/`（推荐）/ `.ai/` / 侦察发现的位置 |
| A5 | 哪些操作系统必须支持？ | 当前系统 / macOS + Windows + Linux（产品化推荐）/ 自定义矩阵 |

monorepo 或仓库族还要问：根一套框架，还是每包/每仓一套 + 根上一个薄路由？**各包约定确实不同 → 分治 + 根路由；共享一套约定 → 单一根框架。**

**A2 不得自动推断。** “当前会话来自 Codex”“仓库里只有 `AGENTS.md`”“本机只安装了一个客户端”都不能证明团队只需要它。把选择记录为 `client_support.mode = all_built_in | selected`、`selected_clients` 与 `source: user`；没有这个已确认记录，不进入适配器生成。

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

### D. 内容种子（开放问题或证据 gap）

引导模式请用户补充下列内容。自动完整模式先从代码、测试、文档和 git 历史提取；无法证实的部分记为 gap，不编造答案。

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
| E1 | 新项目还是遗留项目？ | 引导模式侦察后让用户确认；自动完整模式按仓库证据分类；遗留项目默认保留现有栈 |
| E2 | 前后端技术组合？ | 新项目基于约束给 2–3 个组合；遗留项目展示检测结果与证据 |
| E3 | 是否需要 UI 框架提案？ | 按 [references/ui-selection.md](references/ui-selection.md) 给首选、备选、轻量与无框架选项 |
| E4 | 交互与治理产物使用什么语言？ | 跟随用户 / 中文 / English；产物选中文 / English / 双语 |
| E5 | 是否要做技术现代化评估？ | 默认否；选择“是”时建立独立范围，不混入治理落地 |
| E6 | 技术栈标准与业务 skills？ | 完整档默认检索当前标准并直接生成；标准档至少生成栈覆盖清单与高频编码 skills；最小档记录为后续 gap |

## Step 3 — 计划

产出下列计划。引导模式取得批准后构建；自动完整模式先展示计划和默认假设，若不需要新授权且没有实质分歧则继续：

- 文件清单（路径 → 一行用途），按阶段分组
- 编号规则清单（只要标题），每条追溯到 D1 的某个回答
- `context-map.yaml` 档案名，追溯到 D2
- 门禁链，含精确命令与**实测**耗时
- 什么会被强制 vs 什么只是被陈述
- 对任何被搁置的问题所套用的默认假设
- 选中的能力包、版本、证据等级与组合边界
- 技术标准检索主题、来源优先级、版本边界与刷新日期
- 栈基础 / 横切质量 / 业务写法 skill 矩阵，以及每项的 profile、证据和验证
- 交互语言、治理产物语言和双语对齐方式
- macOS、Windows、Linux 的目标支持与当前验证状态
- 遗留项目是否保持原栈；现代化评估必须列为独立范围

复杂项目按 [references/team-orchestration.md](references/team-orchestration.md) 分离侦察、访谈、架构、栈专家、实现和独立审计角色。一个人可以兼任，但探索、设计和批准不能在同一步骤自证。

## Step 4 — 分四阶段构建

各文件骨架见 [references/templates.md](references/templates.md)。检查器与钩子细节见 [references/gates-and-hooks.md](references/gates-and-hooks.md)。

**阶段 1 — 骨架。** L0 + L1 + L2：入口文件、`docs/ai/README.md`、`context-map.yaml`、`00_always.mdc`、按 A2 和目标 OS 选择 symlink、junction、原生导入或生成式适配器。
*验收*：决策账本有用户确认的客户端模式；A2 里选的每个客户端都能通过自己的原生入口触达常驻规则，且这些文件里点到的每个路径都真实存在。未选择的客户端明确记为 `not selected / not generated`，不能写成支持；每种目标 OS 分别记录已验证或未验证，不能从当前系统外推。

**阶段 2 — 门禁。** L8 + 按 B4 装 hook。
*验收*：**证明每类声明都会以正确方式失败**。把 [机器可读验收契约](assets/acceptance-contract.json) 作为版本化快照放进目标正典（默认 `docs/ai/acceptance-contract.json`）；至少覆盖缺失精确路径，凡目标仓库使用 glob、能力层、知识断言、来源 front matter、任务运行时或 hooks，还必须运行其中对应的条件探针。探针必须触发本次声称会阻断的真实入口，记录非零退出与修复动作，恢复后再证明同一入口通过。显式 gate、pre-commit 或 CI 检查器的内部异常和受管输入 schema 错误必须非零；只有后台客户端 hook 可以警告放行并把该声明降级为 `unverified`。**从未失败过的检查器等于未知是否可用。**

**阶段 3 — 能力层**（标准档生成栈清单和高频 skills；完整档生成完整矩阵）。L3 + L4 + L5 + L7。先按 [技术栈标准与业务写法 Skill 生成协议](references/stack-skill-generation.md) 检索当前标准，生成 `stack-sources`、`stack-skill-map`、细粒度栈 skills、横切质量 skills 和有真实证据的业务 skills。
*验收*：每个 skill 的 `description` 都写清触发与相邻排除；每个选定技术组件有编码 capability，高频决策不只落在 umbrella skill；每个业务 skill 有业务证据和 owner；所有 skill/command/agent 从入口、context profile、能力目录或已验证原生机制可达。门禁检查来源、版本、skill-map/profile 覆盖和 routing examples，并用 `stack-standard-source-coverage`、`stack-skill-coverage`、`business-pattern-routing` 的适用探针证明删除来源、能力或业务路由会失败。每条编号业务禁令仍映射真实事故/代码/用户决定；只有清单没有加载路径的能力只能记 `present`。

**阶段 4 — 完整档运行时。** L6 + L9 + L11；只有 B1 选择 Stop 且目标客户端确有相应 API 时增加 L10。
*验收*：L9 必须证明“旧 gate → 再次 implementing → 不重验无法 complete”，且只有专用 complete 入口能进入终态；L11 必须让改进候选与健康检查具备可机读的 owner、复核日期和状态。若交付 L10，必须用真实客户端的 Read、patch、shell 等载荷矩阵证明写入分类，并跑通“写入 → Stop 阻断 → 门禁/对应 memory → 同一代 receipt → Stop 放行”的完整成功闭环。ack 还要证明绑定入口/改动指纹并被原子单次消费。真实客户端触发确认不了就按第 8 条写进 README，不能用直接调用 handler 代替。

每阶段之后：总结 diff 并跑该阶段验收。引导模式停下等确认；自动完整模式在没有新授权需求时继续。

## Step 5 — 验证与交付

- 批量跑一次完整门禁，**贴真实输出**。
- 按 macOS、Windows、Linux 分别报告 gate、hook probe 与适配器模式；未实际运行的系统明确写 `not yet verified`。
- 逐层给出台账，并把四个维度分开：`present`（产物与引用存在）、`reachable`（入口或路由能找到）、`enforced`（机器检查会非零退出且对应负向探针已失败过）、`real-client-verified`（真实客户端/平台回放过实际接线）。散文约束另标 `stated`；未知边界标 `unverified`。
- 建立“声明 → 检查器入口 → 精确失败条件 → 正向证据 → 负向证据 → 剩余边界”的声明—证据矩阵。**warn-only、仅打印诊断、或只在可选严格环境变量下失败的入口，不得标成 `enforced`。**
- 在目标仓库生成 `docs/ai/acceptance-results.json`（若正典目录不同则等价放置），对项目内版本化的 `acceptance-contract.json` **每个探针 ID 恰好记录一次** pass / fail / not-applicable / unverified、实际入口、负向与恢复证据、适用性理由和剩余边界；目标仓库的 delivery checker 必须校验契约 schema、覆盖率、唯一性、合法状态和条件证据。不得用两个结构探针替代知识、路由、运行时与 hook 的语义探针，也不得用散文声称某探针已经跑过。
- 对完整档额外逐项核对四个闭环不变量：对应 owner 的 memory 才能满足同步；重新实现会使旧 gate receipt 失效；complete 只有一个受检入口；Stop 有不依赖 ack/kill switch 的正常放行路径。
- 在 `docs/ai/README.md` 记录：日期、深度档、被搁置问题所用的默认值，以及一段「如何扩展本框架」。
- 对照决策账本确认所有已批准选择都有产物或显式 gap，且没有重新打开被否决方案。
- 记录能力包版本与真实证据等级；未经认证的组合不得在交付摘要中写成“完全支持”。
- 报告技术标准来源、目标版本、检索日期与冲突；来源缺失或需要刷新时，相关 skill 不得标 current。
- 检查所有产出代码的 profile 必达设计质量策略；每个业务 skill 必须有业务 evidence，不能只靠技术栈名称生成。
- 用至少一个真实风格请求独立 forward-test 生成的栈/业务 skills，检查是否选中正确上下文并产出项目标准写法。
- 如果目标仓库自身有记忆/文档义务，在同一次改动里满足它。
- 完整模式在宣布完成前必须由独立的对抗审计步骤复核声明—证据矩阵；同一实现步骤的自述不算独立证据。无法使用独立角色时，单独重置上下文按审计清单执行，并显式记录该限制。
- **绝不以「文件已存在」为依据宣布框架落地。** 落地的证据是一次通过的门禁 + 一次真正用了它的会话。

## 元反模式（框架自身的坑）

| 反模式 | 为什么会失败 |
| --- | --- |
| 不检索版本就一次性生成“最佳实践” | 它描述的是模型记忆中的通用仓库；很快过时或与当前框架版本冲突 |
| 每个框架只有一个巨型 skill | 触发范围模糊、上下文过载，实际写组件/接口/Repository 时无法精确路由 |
| 只生成技术 skill，不生成业务写法 | AI 会写出框架正确但业务错误的通用 CRUD |
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

第一条验证入口 front matter、本地链接、能力包注册表、验收契约、v3/v4 状态和 OS 证据；第二条在内存中注入重复能力包、损坏验收契约与断链，证明检查器确实会失败。该命令验证的是可分发 skill 包，不代表任何目标项目、技术栈或操作系统已经完成认证。

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
| [references/stack-skill-generation.md](references/stack-skill-generation.md) | 技术栈已识别后，检索当前标准并生成栈/质量/业务 skills 时（完整档必读） |
| [references/ui-selection.md](references/ui-selection.md) | 为 React/Vue/Angular/Svelte 提出 UI 候选或评估遗留 UI 时 |
| [references/team-orchestration.md](references/team-orchestration.md) | 组建专家团队、定义 subagent 边界或做产品化发布时 |

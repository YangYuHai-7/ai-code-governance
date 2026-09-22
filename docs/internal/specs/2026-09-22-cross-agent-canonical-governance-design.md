# 跨 Agent 单一正典治理设计

## 目标

当项目选择 Codex、Claude Code、Cursor 和 GitHub Copilot 中的一个或多个 Agent 时，AICG 必须让它们消费同一套治理事实、任务路由、验证命令和交付证据要求。项目团队只能在正典中维护这些规则一次；客户端目录中的文件是可追溯、可重建、可检查的薄投影，而不是可独立演化的规则副本。

本设计将 GitHub Copilot 作为内置客户端接入，并把当前“生成了适配器”提升为可报告的跨客户端一致性契约。它不承诺不同模型每次推理或工具调用完全相同；它保证的是相同版本的治理输入、相同的机器检查和诚实的运行时证据边界。

## 成功标准

1. `docs/ai/`、`.ai-governance/config.json` 与 manifest 是项目 AI 治理的唯一权威来源。
2. 选择的每个客户端都有其原生发现位置的最小适配器，且适配器来源、内容哈希与支持范围被 manifest 记录。
3. AICG 支持 `github-copilot`；新项目的 `--clients all` 选择 Codex、Claude Code、Cursor 和 GitHub Copilot，既有配置不因升级而自动扩大客户端范围。
4. `aicg check` 能发现正典缺失、投影缺失、投影漂移、错误来源、未经管理的冲突和不支持的目标表面，并继续沿用默认报告模式。
5. 检查报告将声明、投影、结构一致性和真实客户端运行区分开来，不把文件生成误报为客户端已实际加载或模型必然遵守。
6. 同一受管 Skill 以正典 `SKILL.md` 为源，为所有选中的可发现目录生成等价适配器；不复制可编辑正文。
7. 所有生成、同步和迁移仍受精确计划哈希、保留用户内容和事务性回滚约束。
8. 治理文件按职责收敛，`docs/ai/` 根目录不再累积每种功能的 JSON、Markdown 和运行时结果；未激活或不可达的材料不在新项目中预先物化。

## 非目标

- 不生成或强制启用 Copilot 自定义 Agent、Prompt、Hook、MCP 或 GitHub Actions；它们是显式工作流选择，而不是基础治理入口。
- 不修改项目产品代码、CI 或外部 GitHub 配置。
- 不通过静态文件证明某个模型已经服从全部自然语言指令。
- 不把个人级、组织级或 IDE 专属设置视为仓库治理的权威来源。
- 不使用符号链接或文件系统链接作为跨客户端适配器。
- 不把“当前未被入口读取”直接等同于“可安全删除”；历史、用户内容和未验证业务材料必须经独立审查。

## 术语与状态模型

一个客户端在报告中具有相互独立的状态：

| 状态 | 含义 | 证据 |
| --- | --- | --- |
| `declared` | 用户在配置中选择了客户端。 | 已确认的配置与计划。 |
| `projected` | 该客户端的所有基础投影都由本次正典编译产生。 | manifest 中的来源和哈希。 |
| `checked` | 当前工作树的投影、正典、来源与哈希一致。 | `aicg check` 结构报告。 |
| `runtime-verified` | 在指定客户端、指定表面进行真实探针，并记录已加载的正典版本及结果。 | 具名运行时证据记录。 |

`checked` 绝不蕴含 `runtime-verified`。运行时探针也只证明被记录的客户端版本、入口和场景，不能概括为所有 IDE、云端表面或未来版本均已验证。

## 正典与投影架构

```text
owner decisions + repository evidence
                |
                v
   .ai-governance/config.json + docs/ai/  <-- the only editable governance canon
                |
                v
      AICG artifact compiler + manifest
       /          |           |         \
      v           v           v          v
 AGENTS.md    CLAUDE.md   .cursor/    .github/
 .agents/     .claude/   rules/       copilot-instructions.md
 skills/      skills/                skills/
       \          |           |         /
                v
    aicg check: projection integrity and evidence state
```

`AGENTS.md` 继续是跨工具共享入口。它指向小型上下文闭包（`docs/ai/context-map.yaml` 和 `docs/ai/rules/00_always.mdc`），而将架构、业务记忆、测试、标准和交付证据保留在按任务路由的正典中。

每个投影必须包含生成标记、稳定来源引用、来源内容哈希和“不得直接编辑”的说明。适配器本身不得承载独立的架构规则、验证命令或业务约束。修改治理时，操作者更新正典后运行 AICG 同步；修改生成器模板后，通过同一同步路径重建所有选中客户端的投影。

## 治理文件收敛与按需物化

跨 Agent 的单一来源不能以增加项目根 `docs/` 的杂乱文件为代价。AICG 将治理内容限定在 `docs/ai/`，且只允许两个根级入口：`README.md`（面向人）和 `context-map.yaml`（路由索引）。其余正典按职责归档：

```text
docs/ai/
├── README.md
├── context-map.yaml
├── policies/          # always, architecture, stack, business constraints
├── routing/           # task and verification route contracts
├── skills/            # on-demand reusable workflows
├── development/       # existing-project understanding, per development unit
├── memory/            # project business and code-backed memory indexes
├── evidence/          # acceptance policies and produced evidence indexes
└── integrations/      # only when a selected integration is active

.ai-governance/
├── config.json        # confirmed owner decisions
├── manifest.json      # ownership, source and projection hashes
└── state/             # generated machine-only ledgers and receipts
```

`task-routing-policy.json`、`verification-profiles.yaml`、`decision-ledger.json`、`skill-index.json`、`agent-team.json`、架构/技术栈 profile 等机器控制平面内容迁入 `.ai-governance/state/`。人或 Agent 需要阅读的解释性材料保留在相应的 `docs/ai/` 主题目录中，并由 `context-map.yaml` 建立路径索引。入口不得要求普通任务递归读取目录。

新建项目默认采用 `governanceFootprint: "compact"`。它只生成启动闭包、已确认的生命周期材料和当前实际激活的路由；发布、端验证、集成、团队、技术标准、能力演进、长期任务和结果文件均在明确选择或首次真实使用时物化。没有对应任务、证据或配置选择的候选模板只存在于 AICG 包内，不写入目标项目。

既有项目默认采用 `governanceFootprint: "preserve"`，不会因升级自动移动或删除任何已生成材料。操作者可显式选择 `compact` 并预览收敛计划。计划将每个现有文件归为：

| 分类 | 处理 |
| --- | --- |
| `required` | 是启动闭包、已激活路由或当前证据的依赖，保留或迁移到新目录。 |
| `reachable` | 由上下文地图、激活配置或已记录证据引用，保留或迁移。 |
| `dormant-managed` | AICG 受管但当前无激活入口，列为清理候选，不自动删除。 |
| `historical-or-user` | 历史、漂移或用户内容，保持原样并要求人工决定。 |

迁移先以 `sync --dry-run` 给出旧路径、新路径、来源、哈希、引用更新和候选清理；移动、归档或删除必须由独立的新计划哈希批准。无用户修改的可信 `dormant-managed` 文件可在批准后移至 `docs/ai/archive/` 或删除；后者仍是显式、可审查的操作。链接、漂移文件、未知文件、外部证据和业务记忆不得自动移动或删除。

## 客户端注册表与投影契约

注册表扩展一个 `github-copilot` 条目。条目不只描述可执行文件，而是描述该客户端可用的仓库级表面、Skill 目录、必要投影和每个表面的支持边界。基础客户端契约如下：

| 客户端 | 基础入口投影 | Skill 投影 | 说明 |
| --- | --- | --- | --- |
| Codex | `AGENTS.md` | `.agents/skills/` | 共享入口和 Codex 可发现 Skill。 |
| Claude Code | `CLAUDE.md`，原生导入共享入口 | `.claude/skills/` | `CLAUDE.md` 不复制共享正文。 |
| Cursor | `.cursor/rules/ai-code-governance.mdc` | `.agents/skills/` | Rule 只路由至正典与共享入口。 |
| GitHub Copilot | `.github/copilot-instructions.md` | `.github/skills/` | 仓库级指令覆盖 Copilot 的广泛入口；它可同时提示共享 `AGENTS.md`。 |

Copilot 适配器必须是 AICG 管理块，以保护用户已有 `.github/copilot-instructions.md` 的块外内容。它以相对引用声明共享入口与正典，而不是复制完整规则。由于 Copilot 各运行表面对 `AGENTS.md`、路径指令和 Skills 的支持不同，基础投影必须保留 `.github/copilot-instructions.md`；仅有 `AGENTS.md` 不满足跨表面治理目标。

路径特定 Copilot instructions 只在已有 AICG 路由能表达文件路径边界、并由用户显式启用时生成。它们从同一 `docs/ai` 路由事实编译而来，必须包含 `applyTo`、来源和哈希。自定义 Agent、Prompt、Hook 和 MCP 维持为独立、按需能力，不能成为基础一致性检查的前置条件。

## 配置、兼容与迁移

`clients` 的合法 ID 扩展为 `github-copilot`。`--clients all` 对新计划解析为四个内置客户端。已存在的 `.ai-governance/config.json` 保留其历史 `clients` 数组；`sync` 不因新版本自行添加 Copilot，也不会删除未选择客户端的用户文件。

新的配置/manifest schema 使用显式版本迁移：旧 manifest 在读取时被视为“无 Copilot 投影、保留既有文件布局”的兼容状态，重新预览或同步时才产生包含新字段的计划。计划会精确列出 `.github` 文件和治理目录收敛的新增、保留、迁移、替换或冲突；没有与当前树匹配的 `--approve <planHash>` 不写入任何文件。

`--clients github-copilot` 与组合选择均受相同的路径安全、链接拒绝、用户内容保护、预算和事务回滚规则约束。`.github/` 仅在 Copilot 被选择或已由当前受管 manifest 所有时进入 AICG 的可写治理根集合。

## 检查与同步

编译器为每个投影写入以下元数据：客户端 ID、表面 ID、正典路径、正典 SHA-256、投影模板版本、可选的路径范围和发现状态。manifest 以这些元数据建立投影到正典的一对多映射。

`aicg check` 按以下顺序执行：

1. 校验受管配置、正典路径、manifest 和注册表契约。
2. 对每个声明客户端解析所需基础表面与 Skill 目录。
3. 重新计算正典和投影的期望内容与哈希，检查缺失、漂移、错误来源、额外受管块和链接风险。
4. 输出每个客户端的 `declared`、`projected`、`checked`、`runtime-verified` 状态以及精确修复建议。
5. 以现有报告模式返回真实 finding，不因默认 exit 0 而隐藏失败状态；`--enforce` 保持为明确选择。

普通 `sync` 仅根据当前受管配置重建投影，且零删除。将来移除客户端、切换到 compact footprint 或关闭某项能力时，受管投影进入保留/清理候选；只有 `sync --prune --dry-run` 后使用新的精确批准，才可以移动、归档或删除可信、未编辑的受管文件。任何含用户内容、漂移、未知或链接对象的文件都不得自动删除。

## 真实客户端验证

运行时验证是可选、显式的只增证据流程。记录应至少包含：客户端 ID、运行表面（例如 Copilot CLI、VS Code Agent Mode、GitHub code review）、客户端版本或可识别环境、时间、选定的探针、预期正典/投影哈希、观察结果和证据文件路径。

首批探针只验证加载链与安全行为：基础适配器被识别、任务能路由到正典、故意篡改投影能被检查发现、恢复后检查通过。它们不执行产品代码变更、外部发布或 GitHub 写操作。没有真实环境、账户或可重放证据时，状态保持 `not-verified`，不得用模拟命令替代。

## 测试策略

实现以失败测试开始，至少覆盖：

- 注册表接受 `github-copilot`，并在新项目 `--clients all` 中选择它；既有配置不发生隐式扩展。
- 仅选择 Copilot、Copilot 与其他客户端组合、以及取消选择 Copilot 的生成与保留行为。
- `.github/copilot-instructions.md` 的管理块保留用户块外内容；`.github/skills/` 的每个适配器都绑定对应正典 Skill。
- Copilot 投影缺失、哈希漂移、错误正典引用、未知受管块、软链接和不安全路径均形成结构 finding。
- 所有选中客户端的基础规则、路由和验证命令指向同一正典摘要；修改正典后，未同步投影被可靠发现。
- 计划哈希绑定 `.github` 的写入，过期计划或验证失败时事务完整回滚。
- 检查报告正确区分 `checked` 与 `runtime-verified`，且报告模式仍保留真实失败信息。
- compact 新项目只物化启动闭包和当前激活材料，且根级 `docs/ai/` 不出现未归类的治理文件。
- preserve 既有项目保持零删除；compact 迁移准确列出 required、reachable、dormant-managed 和 historical-or-user 分类，并拒绝自动处理后两类。
- 现有 Codex、Claude Code、Cursor 夹具与 CLI 组合测试保持通过。

完成后依次执行针对注册表/生成/检查的测试、`npm run test:fast`、`npm run test:full`、`npm run validate`、`npm run smoke` 和 `npm run smoke:package`。真实客户端探针仅在操作者提供实际客户端环境后执行，并独立记录其证据。

## 失败行为与证据边界

错误必须指出客户端、表面、路径、期望正典和安全修复动作，例如：

- `github-copilot: missing .github/copilot-instructions.md; run aicg sync .`；
- `github-copilot: projection drift from docs/ai/rules/00_always.mdc; review and sync`；
- `github-copilot: .github/skills/release-check/SKILL.md is a link and cannot be managed`；
- `github-copilot: runtime verification is not recorded for surface github-code-review`。

结构检查通过只证明受管投影与当前正典一致。它不证明任何模型总会读取全部文件、所有 Copilot 产品表面均支持相同发现机制、模型不会忽略自然语言规则、或产品验证命令在未执行时已通过。报告必须持续把这些边界呈现为未验证事实。

# 外部规格与执行工作流集成协议

机器可读注册表在 [../assets/workflow-integration-registry.json](../assets/workflow-integration-registry.json)。本协议用于发现、选择和约束 OpenSpec、Superpowers 或相邻工具；它不要求目标项目安装任何一个，也不授权 Agent 自动安装插件、修改全局配置或采用第三方 bridge。

## 为什么需要单独协议

治理框架容易在两个方向重复造轮子：

- 自己实现一套 proposal、delta spec、verify、archive，重复规格工具；
- 自己实现一套 brainstorming、TDD、调试、worktree、subagent review，重复执行方法库。

反过来，把多个完整工作流直接叠加也会产生第二正典、重复审批和相互矛盾的计划。正确做法是先确定权威，再把外部工具当作可替换 provider。

## 四种模式

| 模式 | 使用条件 | 权威 |
| --- | --- | --- |
| `project-native` | 目标项目已有成熟 change/runtime 能力，或用户不希望增加依赖 | 现有项目正典 |
| `external-primary` | 用户选择某个外部工具独立拥有完整工作流 | 该工具拥有它声明的生命周期；`docs/ai/` 只补项目治理 |
| `coordinated` | 需要 OpenSpec 管规格、项目治理管路由与门禁、精选执行能力负责实施 | 必须填写下文权威矩阵 |
| `external-bridge` | 用户明确选择已审计的 bridge/custom schema | bridge 自身有版本、来源、冲突和探针证据；默认 `unverified` |

检测到工具不等于选择工具。未检测到且用户未要求时，保持 `project-native`；检测到重叠工具时，这属于会改变产物的决策，自动完整模式也必须询问用户选择，不得静默接管。

## 单一权威矩阵

每个集成项目生成 `<CANON>/workflow-integrations.yaml`，至少为以下对象指定唯一 owner：

```yaml
schema_version: 1
mode: coordinated

providers:
  change_governance:
    id: openspec-change-governance
    selected_by: <user decision id>
    installed_version: <observed version>
    version_checked_at: YYYY-MM-DD
    source_checked_at: YYYY-MM-DD
    license: <observed upstream license>
    source_ids: [<official source ids>]
  execution_discipline:
    id: superpowers-execution-discipline
    selected_by: <user decision id>
    installed_version: <observed version>
    version_checked_at: YYYY-MM-DD
    source_checked_at: YYYY-MM-DD
    license: <observed upstream license>
    source_ids: [<official source ids>]

authority:
  current_product_behavior: openspec/specs
  active_change: openspec/changes/<change-id>
  project_ai_governance: <CANON>
  implementation_task_list: openspec/changes/<change-id>/tasks.md
  runtime_state: <CANON>/long-running/state/<task-slug>/task.yaml
  execution_method: selected-provider-capabilities
  delivery_evidence: <CANON>/acceptance-results.json

overlap_policy:
  duplicate_design: forbidden
  duplicate_plan: forbidden
  copied_requirements: forbidden
  conflict_action: stop-and-report
```

`<CANON>` 通常是 `docs/ai`。矩阵只记录被选中的真实 provider；不用的 provider 不生成假版本或空配置。

## OpenSpec 作为 change-governance provider

采用前先读取当前官方文档，记录已安装版本、schema 解析来源和项目配置。官方工作流可能变化，不能把本协议里的示例当作永久 API。

选择 OpenSpec 后：

- `openspec/specs/` 是当前产品行为正典；
- `openspec/changes/<change-id>/` 是本次变更正典；
- proposal、delta specs、design 和 tasks 不再复制到 `<CANON>`；
- L9 `task.yaml` 只记录 provider、change id、权威路径和观察到的版本；
- context profile 加载对应 change artifact 和项目 rules/skills；
- 产品行为测试要能追溯到 requirement/scenario；结构验证不能冒充行为验证；
- archive 只能在当前实现代的项目门禁、OpenSpec change validation 和人工要求都满足后发生。

纯重构、工具或文档任务是否允许无 delta spec，必须由当前 OpenSpec schema 和项目政策决定，不得用“这不是功能”静默跳过。

### OpenSpec 不负责的部分

- 不替代 `<CANON>` 中的 AI 客户端、上下文路由和业务编码规则；
- 不替代项目 lint、test、security、architecture 和 delivery gate；
- 不因为 Markdown 结构合法就证明实现符合业务行为；
- 不自动获得安装、更新、archive 或外部发布权限。

## Superpowers 作为 execution-discipline provider

采用前检查真实运行时能否发现相应 skills，并记录插件/skill 版本或 commit。优先选择可观察的能力，而不是笼统写“已启用 Superpowers”。

适合复用的执行能力包括：

- test-driven development；
- systematic debugging；
- worktree isolation；
- plan execution 或 subagent-driven development；
- spec-compliance review 与 code-quality review；
- verification before completion；
- branch finishing。

### 重叠处理

Superpowers 的完整工作流通常还拥有 brainstorming、design 和 writing-plans。目标项目已有批准的 OpenSpec change 或项目计划时，不得再生成第二份正式 design/plan。

只有满足以下任一条件才能声明 `coordinated`：

1. 运行时支持选择性调用，且真实回放证明所选执行 skill 不会强制创建冲突 artifact；
2. 项目采用有来源、许可证和版本证据的本地适配 skill，并通过行为 forward-test；
3. 用户选择并审计了 external bridge/custom schema，且 bridge 明确单一权威。

如果上游 bootstrap 强制完整流程且项目无法选择性调用，不能写“已无冲突集成”。应选择一个完整 orchestrator，或把状态标记为 `unverified` 并停止生成冲突接线。

复制或改写外部 skill 时保留来源、许可证、上游版本、局部修改和刷新策略；不要让复制内容无主地进入项目正典。

## L9 任务关联

存在外部 provider 时，`task.yaml` 增加引用而不是内容副本：

```yaml
external_workflows:
  change:
    provider: openspec-change-governance
    change_id: <change-id>
    authority_paths:
      - openspec/changes/<change-id>/proposal.md
      - openspec/changes/<change-id>/specs
      - openspec/changes/<change-id>/design.md
      - openspec/changes/<change-id>/tasks.md
    observed_version: <version>
  execution:
    provider: superpowers-execution-discipline
    mode: selective
    capabilities:
      - test-driven-development
      - systematic-debugging
      - verification-before-completion
    plan_authority: openspec-tasks
```

恢复任务时必须先验证：change 仍存在、权威路径仍解析到同一 change、任务未引用已归档或被替代的变更、provider 版本没有在未复核情况下漂移。

## 风险分级与轻重仪式

| 任务 | 默认建议 |
| --- | --- |
| 只读解释、局部调查 | 不创建 OpenSpec change，不启用完整执行工作流 |
| 单文件无行为修复 | 项目原生任务 + 定向验证；是否 TDD 按风险决定 |
| 可观察行为变化 | change contract + requirement/scenario traceability |
| API、权限、数据、跨仓契约 | change contract + L9 + 完整项目门禁 + 独立 review |
| 生产修复、迁移、敏感操作 | L9 权限与审计 + systematic debugging + rollback/verification evidence |

工具不能决定风险等级。目标仓库事实、用户影响、可逆性和权限边界决定需要多少仪式。

## 必需验证

启用任何集成时，目标项目的 acceptance contract 至少实例化适用的探针：

| 探针 | 必须证明 |
| --- | --- |
| `workflow-source-freshness` | provider 有官方来源、观察版本和刷新日期；漂移会降级或失败 |
| `change-authority-single-source` | 当前行为和 active change 各只有一个 owner，删除/冲突会失败 |
| `execution-plan-single-authority` | 实施只能消费一份正式任务/计划，第二份会失败 |
| `external-change-runtime-linkage` | L9 task 引用真实、当前、未归档的 change |
| `external-archive-completion-gate` | 未完成当前代门禁或未验证 change 时不能 archive |
| `selective-execution-capability` | 声称 selective 时真实运行时能发现并调用能力而不生成冲突 artifact |

这些探针必须触发项目真实 delivery/complete/archive wrapper。只检查 YAML 出现字段、直接调用内部 helper 或打印 warning，不能标 `enforced`。

## 上游来源与刷新边界

截至 2026-09-07，本协议依据以下上游资料设计；使用时仍需重新检查当前版本：

- [OpenSpec Getting Started](https://github.com/Fission-AI/OpenSpec/blob/main/docs/getting-started.md)
- [OpenSpec Customization](https://github.com/Fission-AI/OpenSpec/blob/main/docs/customization.md)
- [OpenSpec Writing Good Specs](https://github.com/Fission-AI/OpenSpec/blob/main/docs/writing-specs.md)
- [Superpowers repository and workflow](https://github.com/obra/superpowers)
- [Superpowers using-superpowers skill](https://github.com/obra/superpowers/blob/main/skills/using-superpowers/SKILL.md)
- [Superpowers systematic-debugging skill](https://github.com/obra/superpowers/blob/main/skills/systematic-debugging/SKILL.md)

OpenSpec community schema 或其他第三方 bridge 必须作为独立 provider 记录自己的仓库、版本、许可证和证据等级；不能借用 OpenSpec/Superpowers 上游名称获得 `supported` 或 `certified`。

## 反模式

- 因为目录被检测到就静默采用外部工具。
- 同时保留 OpenSpec tasks、Superpowers plan 和项目 harness plan，声称它们会自然同步。
- 把 `openspec validate` 通过写成产品测试通过。
- 声称 selective integration，却没有真实运行时调用证据。
- 把第三方 bridge 当作两个上游项目的官方能力。
- 把外部工具更新造成的行为变化当作项目无关事项。
- 为了接入外部流程，复制整个 `<CANON>` 或降低现有项目门禁。

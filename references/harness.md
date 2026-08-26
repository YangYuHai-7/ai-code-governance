# L9 任务运行时（harness）

把**任务状态**从对话里搬到文件里。对话会被压缩、会中断、会换工具、会换人；文件不会。

---

## 先判断你是否需要这一层

**需要**，只要出现以下任意一条：
- 任务跨会话（今天开始，明天继续，可能换工具）。
- 任务碰生产数据、密钥、客户数据（需要可审计的权限声明）。
- 任务是大任务（多模块、迁移、数据/权限模型变更）。
- 多人或多助手接手同一件事。

**不需要**：单会话就能做完的中小任务。给它上运行时是纯开销——这层最常见的死法就是**给不需要它的任务强制启用**，然后所有人开始绕过它。

L9 是**最容易过度工程**的一层。不确定时先不建；等到真的被"上个会话做到哪了？"卡住一次，再建。

---

## 目录布局

```text
docs/ai/long-running/
  README.md            # 这层怎么用（入口）
  runtime.yaml         # 全局配置：状态目录、严格度、门禁目录、按任务类型的门禁
  task-schema.yaml     # 单个任务文件的字段契约（带注释的模板）
  state-machine.md     # 状态与合法转移
  completion-gates.md  # 每个门禁是什么、怎么跑、谁负责
  fallback-policy.md   # 情境 → 必须采取的退路
  lifecycle.md         # 一个任务从进入到完成的完整流程
  state/               # gitignored；只跟踪 .gitkeep
    <task-slug>/
      task.yaml
      conversation/    # 会话留痕（见 memory-layer.md）
      artifacts/       # 计划、脱敏输出、报告
```

**`state/` 必须 gitignored。** 它是本机运行状态，不是团队产物。跟踪一个 `.gitkeep`，让新 clone 上目录存在（否则第一次写入要先猜目录）。

---

## `runtime.yaml`：全局配置

```yaml
version: 1
state_dir: docs/ai/long-running/state
strict_env: <PREFIX>_HARNESS_STRICT_STATE   # 置 1 时把警告升为失败

task_types:
  - feature
  - bugfix
  - migration
  - investigation
  - docs
  - review

# 门禁目录：每个门禁只定义一次，被所有任务类型引用
gate_catalog:
  framework_check:
    description: 框架结构与引用完整性
    command: <pkg> run framework:check
  drift_check:
    description: 知识层与代码一致
    command: <pkg> run drift:check
  tests:
    description: 受影响范围的测试
    command: <pkg> test -- <scope>
  memory_sync:
    description: 行为变更已写进 docs/memory/
    manual: true          # 没有命令能判定；由助手声明并给出证据
  scope_review:
    description: 改动范围与讨论一致，无搭车改动
    manual: true

# 按任务类型要求哪些门禁
gates_by_task_type:
  feature:       [framework_check, drift_check, tests, memory_sync, scope_review]
  bugfix:        [framework_check, tests, scope_review]
  migration:     [framework_check, drift_check, tests, memory_sync, scope_review]
  investigation: [framework_check, scope_review]
  docs:          [framework_check]
  review:        [framework_check, scope_review]
```

三个设计点：

1. **`gate_catalog` 与 `gates_by_task_type` 分开。** 门禁定义一次，引用多次。合在一起写会让同一个门禁的命令在五个地方漂移。
2. **`command:` 与 `manual: true` 必须区分。** 有命令的门禁是机器事实；`manual: true` 的门禁是助手声明——它在报告里必须**附证据**，否则它就是一句"我觉得可以了"（P5）。把两者混成一个列表，就等于把声明伪装成验证。
3. **按任务类型裁剪**（P6）。文档任务要求跑迁移测试，只会训练出跳过门禁的习惯。

`doctor` 可以保留一个 warn-only 的采用/诊断入口，但**被完整门禁调用的入口必须显式 strict**（例如 `harness doctor --strict`），不得依赖开发者碰巧设置环境变量。README 里的强制力声明必须指向 strict 入口；warn-only 入口只能描述为诊断工具。

---

## `task.yaml`：单个任务的契约

```yaml
task:
  slug: <kebab-case-id>          # 也是 state/ 下的目录名、留痕的 task 字段
  title: <一句话>
  created_at: YYYY-MM-DDTHH:MM
  updated_at: YYYY-MM-DDTHH:MM
  owner: <人或团队>
  implementation_generation: 0   # 每次进入 implementing 递增；旧 gate receipt 立即失效

classification:
  type: feature | bugfix | migration | investigation | docs | review
  size: small | medium | large
  sensitive: true | false        # 碰生产数据/密钥/客户数据
  profiles: [<context-map 档案名>]   # 这个任务该加载哪些档案

permissions:
  data_access: none | read-only | read-write
  granted_by: <谁授权的；read-write 必填>
  granted_at: YYYY-MM-DDTHH:MM
  scope: <被授权的具体范围>

context:
  entry_docs: [AGENTS.md, docs/ai/context-map.yaml]
  code_paths: [<归属代码路径>]
  memory_pages: [docs/memory/<module>/README.md]
  sources: [docs/memory/sources/YYYY-MM-DD-<slug>.md]

gates:                            # 从 gates_by_task_type 实例化，逐条带状态
  - name: framework_check
    status: pending | passed | failed | blocked | acked
    evidence: <命令 + 输出摘要 / 声明 + 证据>
    checked_at: YYYY-MM-DDTHH:MM
    generation: 0                 # 必须等于当前 implementation_generation

state:
  current: <见状态机>
  history:
    - at: YYYY-MM-DDTHH:MM
      from: <state>
      to: <state>
      note: <为什么转移>

fallback:
  triggered: []                   # 见 fallback 策略表；记录哪条退路被用过

audit:
  acks:
    - gate: <name>
      reason: <理由原文>
      at: YYYY-MM-DDTHH:MM
  redactions: <做了哪些脱敏；敏感任务必填>
```

**`permissions` 是这份文件里最重要的块**，别省。它把"谁在什么时候授权了对什么的写权限"写成可审计事实，而不是留在某条被压缩掉的对话里。`data_access: read-write` 而 `granted_by` 为空 = 门禁失败。

**`profiles` 字段把 L9 接回 L2**：恢复一个任务时，助手不用重新猜要加载什么。

### Gate receipt 的新鲜度是不变量

`passed` 不是永恒属性，而是“某个 gate 对某一代实现的证据”。运行时必须：

1. 每次从任何状态进入 `implementing` 时递增 `implementation_generation`；
2. 原子地把全部 gate 重置为 pending，并清除旧 evidence/checked_at/generation；
3. machine gate 与 manual attestation 只允许在 `verifying` 写入，并记录当前 generation；
4. completion 要求 required gate 集合与 `gates_by_task_type` 完全一致，每项 passed/acked 都有非空证据、
   合法时间且 generation 等于当前代；
5. 完成时记录 `completed_generation`，供 doctor 与接手者核对。

只比较 status 会产生“旧证据证明新实现”的假完成。时间戳本身也不够；generation 或稳定 change
fingerprint 才是证据归属。

---

## 状态机

### 主状态（9）

| 状态 | 含义 | 允许的下一步 |
| --- | --- | --- |
| `intake` | 已建 task.yaml，需求还没澄清 | `clarifying`, `abandoned` |
| `clarifying` | 正在补齐需求与约束 | `exploring`, `blocked`, `abandoned` |
| `exploring` | 读代码/文档，建立现状认知 | `planning`, `blocked` |
| `planning` | 出方案与改动清单，待确认 | `awaiting_approval`, `exploring`, `blocked` |
| `awaiting_approval` | 等用户确认方案或授权 | `implementing`, `planning`, `abandoned` |
| `implementing` | 正在改代码/文档 | `verifying`, `blocked`, `planning` |
| `verifying` | 跑门禁、补知识层与留痕 | `complete`, `gate_failed`, `implementing` |
| `complete` | 全部门禁 passed 或 acked，已交付 | （终态） |
| `paused` | 主动挂起（换优先级、等外部） | 回到挂起前的状态 |

### 失败/例外状态（5）

| 状态 | 含义 | 出口 |
| --- | --- | --- |
| `blocked` | 缺信息、缺权限、缺环境 | 记录**是谁/什么**在阻塞 → 解除后回原状态 |
| `gate_failed` | 门禁跑了并且失败 | 修 → `implementing`；或 ack → `verifying` |
| `gate_blocked` | 门禁因**先存在的问题**跑不了 | 用 blocked-gate 报告格式上报，不得静默通过 |
| `abandoned` | 决定不做了 | 写原因（终态） |
| `superseded` | 被另一个任务取代 | 指向新 slug（终态） |

### 转移规则

- **每次转移都追加到 `state.history`**，带时间与原因。历史比当前状态更有用——它回答"上次为什么停在这"。
- **不允许跳到 `complete`**：必须经过 `verifying`。
- **`complete` 只有专用命令能进入**：通用 `transition` 必须显式拒绝终态 `complete`，即使状态表里
  存在 `verifying → complete`。专用命令先运行完整 task validation，再原子执行终态转移。
- **`implementing` 之前必须有 `awaiting_approval` → 已确认**（大任务与敏感任务强制；小任务可跳过 `planning`/`awaiting_approval`，但要在 history 里写明"按小任务跳过"）。
- **`gate_failed` 与 `gate_blocked` 是两回事**：前者是"我做错了"，后者是"这里本来就坏了"。混成一个状态，会让先存在的问题被当作本次改动的锅，然后被顺手"修一修"——那就是搭车改动。
- 文档列出的每个非终态都必须在同一个机器可读转移表中有可达的入口与出口，并带负向测试。`paused` 要保存并只恢复到 `resume_state`；`gate_blocked` 要保存 gate 名与证据；`superseded` 要保存新的 task slug。只写在表格里的状态不是运行时能力。

`gate_blocked` 的上报格式（与 [principles.md](principles.md) P4 同一份）：

```text
Gate: <name>
Status: blocked by pre-existing issue
Evidence: <命令 / 输出摘要>
Next action: <具体清理动作或需要谁决策>
```

---

## Fallback 策略表

这张表是 L9 的实际价值所在：**它把"卡住了怎么办"从临场判断变成查表**。没有它，助手在每种意外下都会即兴发挥，而即兴发挥的方向通常是"绕过"。

| 情境 | 必须采取的退路 |
| --- | --- |
| 需求有多种合理解读且解读不同则做出的东西不同 | 停下来问；不要选一个解读默默做完 |
| 需要写生产数据但没有授权 | 停在 `blocked`，写清需要谁授权什么范围 |
| 门禁命令在这台机器上跑不了（缺工具/缺凭据） | 记 `gate_blocked` + 上报格式；**不要**改门禁定义来适配本机 |
| 门禁失败原因**先于**本次改动存在 | `gate_blocked` + 证据；征求是否在本任务内清理，不要自己扩大范围 |
| 上下文即将被压缩 | 先落留痕与 `task.yaml`，再继续 |
| 换工具/换会话接手 | 先按时间倒序读完该 slug 的全部留痕与 `task.yaml`，再动手 |
| 计划执行中发现方案不成立 | 回 `planning`，说明为什么，不要在 `implementing` 里悄悄换方案 |
| 发现范围外的真实问题 | 记录下来单独报，**不在本次改动里顺手修**（搭车改动会让评审失效） |
| 状态文件与实际工作树不一致 | 以工作树为准（P3），修状态文件，并在 history 里记这次纠偏 |
| ambient `status` / `resume` / `session-start` 自身坏了 | 警告 + 继续（P9），并把这层标为 `unverified` 直到修好 |
| delivery gate / `complete` / strict doctor 自身坏了 | 非零退出，记 `gate_failed` 或 `gate_blocked`；不得把跳过的断言算成通过 |

---

## CLI 入口

一层薄 CLI，让状态转移是**命令**而不是"记得去改 YAML"：

```jsonc
{
  "scripts": {
    "harness:intake":   "node docs/ai/tools/harness.js intake",
    "harness:status":   "node docs/ai/tools/harness.js status",
    "harness:resume":   "node docs/ai/tools/harness.js resume",
    "harness:gate":     "node docs/ai/tools/harness.js gate",
    "harness:complete": "node docs/ai/tools/harness.js complete",
    "harness:doctor":   "node docs/ai/tools/harness.js doctor"
  }
}
```

| 命令 | 做什么 |
| --- | --- |
| `intake` | 交互式建 `task.yaml`：分类、权限、要加载的档案；从 `gates_by_task_type` 实例化 `gates` |
| `status` | 列出所有未完成任务 + 当前状态 + 未过的门禁。`session-start` 钩子调它 |
| `resume` | 打印某个 slug 的恢复包：状态、历史尾部、未过门禁、留痕文件列表（按时间倒序） |
| `gate` | 跑该任务类型要求的门禁链，把结果与证据写回 `task.yaml`；`manual: true` 的门禁提示需要助手声明 |
| `complete` | 只在全部门禁 `passed` 或 `acked` 时允许转 `complete`；否则打印缺什么 |
| `doctor` | 校验所有 `task.yaml` 对 schema 有效、状态是合法值、`read-write` 有 `granted_by` |

`doctor` 由 L8 检查器调用（或反过来），这样**运行时自身的完整性也被门禁覆盖**。

`resume` 的恢复包必须包含 `permissions`、`context`、`fallback`、`audit`、当前 generation 与 gate receipt
摘要；对敏感/读写任务省略这些字段会让接手者看不到授权、脱敏或已使用的例外。

### L9 必需负向矩阵

只测非法 enum 不足以证明完成语义。至少回放：

- passed/attested → 重新 implementing → 未重验 complete 必须失败；
- 通用 transition 到 complete 必须失败；
- 删除 required gate、重复 gate、空 evidence/checked_at、旧 generation 必须失败；
- strict doctor 必须让非法终态继续可见，不能因为 status 隐藏 complete 而漏掉；
- 修复并对当前 generation 重验后，专用 complete 必须成功。

---

## 严格度与迁移友好

引入这层时仓库里已经有一堆在做的事。所以：

- **默认宽松的 status/resume**：采用期读取旧 task 时，缺字段可以警告并说明缺什么。
- **显式 strict 的 delivery doctor**：`gate` / pre-commit / CI 必须调用显式 strict 入口；缺字段、schema
  错误或 checker exception 非零，不得依赖开发者碰巧设置环境变量。
- **允许无任务工作**：不是所有工作都要先 `intake`。没有匹配任务时钩子只提示，不阻塞（P9）。

宽松的交互读取不是妥协，是让这层能被真正采用；但它不能被当成交付证据。交付入口必须 strict，
否则“0 issues”可能只是整段校验被跳过。

---

## 与其他层的接线

| 关系 | 怎么接 |
| --- | --- |
| → L2 上下文路由 | `classification.profiles` 直接命名要加载的档案 |
| → L6 留痕 | 共用 `<task-slug>`；留痕落在 `state/<slug>/conversation/` |
| → L8 检查器 | `doctor` 进门禁链；`gate` 复用同一批检查器命令，不另写逻辑 |
| → L10 钩子 | `session-start` 调 `status`；`stop` 的完成判定与 `complete` 共用同一个函数 |

**共用函数这条是硬要求**：如果 `harness:complete` 与 `stop` 钩子各自实现"是否可以完成"，它们会分叉，而分叉的那一天你不会知道——你只会发现门禁"有时候"不管用（P8）。

---

## 这层的反模式

| 反模式 | 为什么坏 |
| --- | --- |
| 每个小任务都 `intake` | 纯开销 → 所有人开始绕过 → 连大任务也不用了 |
| `task.yaml` 与实际工作树长期不一致 | 状态文件变成第二个需要维持为真的事实（P1、P3） |
| 用状态文件代替和用户确认 | `awaiting_approval` 是个状态，不是一次确认。写进文件不等于对方同意了 |
| 门禁失败就改门禁定义 | 门禁的价值全部来自"它挡得住"（P4） |
| 重新实现后沿用旧的 passed/acked | 旧证据没有验证新实现；这是最隐蔽的假完成 |
| 通用 transition 能进入 complete | 绕过专用 completion validation，状态机形同虚设 |
| 状态机加到二十个状态 | 状态机的用途是让下一个人知道现在能做什么；状态越多越没人维护 |

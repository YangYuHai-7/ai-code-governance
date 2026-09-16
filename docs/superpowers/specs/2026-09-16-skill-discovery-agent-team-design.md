# Skill 发现与动态 Agent 团队设计

## 状态

- 决策状态：产品负责人已于 2026-09-16 批准方向与默认 PK 阈值。
- 范围：为 AICG 初始化和后续任务增加可信 Skill 发现、用户决策、项目 AI 角色推荐、动态角色选择和有独立性的 PK 裁决。
- 适用项目：greenfield 与 brownfield。
- 默认 Skill 来源：项目内已有 Skill、当前 Agent 已安装 Skill、官方或 curated Skill 目录；任意网络来源默认关闭。
- 默认 PK 阈值：L0/L1 不强制多人 PK；L2 使用两个独立专业角色和一个裁决角色；L3 使用三至五个独立专业角色和一个裁决角色。
- 权限边界：推荐不是授权。联网、安装、项目写入、全局 Agent 配置修改、角色入队和外部操作分别需要明确批准。

## 问题

当前 AICG 已能根据技术栈生成项目级 Skills，也有只读的人类团队建议和 AICG 产品内部成员池，但缺少两个面向目标项目的闭环：

1. 初始化时不能统一发现项目已有、本机已安装和可信目录中的可复用 Skills，并让用户逐项决定是否加入治理；后续任务发现能力缺口时也没有同一条安全推荐路径。
2. 初始化时不能根据新旧项目证据推荐项目专用的 AI 专业角色；后续需求分析、实现和评审也没有一个按任务等级选择最小角色集合、让角色独立提出方案并交叉质疑的运行协议。

如果直接把所有候选 Skill 和角色装进项目，会重新制造上下文膨胀、流程变慢和职责重叠。如果让模型自动安装或自动扩充团队，则会越过用户的供应链、写入和授权边界。如果只让一个模型依次扮演多个角色，又无法形成真正的独立评审。

新设计必须在不过度设计、速度、质量、完整性和不越界五项底线之间取得可验证的平衡。

## 目标

1. 初始化时根据仓库事实或用户确认的新项目信息，推荐最小必要 Skills 和 AI 角色。
2. 候选必须说明来源、适用证据、收益、重叠、权限、上下文成本和验证状态。
3. 用户可以逐项添加、暂缓、拒绝或查看详情；未批准项不能安装、持久化或激活。
4. 后续任务由轻量路由器根据 L0-L3、领域、风险和所需能力选择最小角色与 Skills。
5. 能力不足时提出新的 Skill 或角色建议，但继续保持在建议状态，直到用户批准。
6. L2/L3 使用真正独立的提案、交叉质疑和证据裁决，避免一言堂和简单多数票。
7. 保持人类团队建议、AICG 产品团队和项目 AI 角色团队三个概念及其正典完全分离。
8. 为推荐精度、上下文预算、额外延迟、角色独立性和越界行为建立机器检查与真实 Agent forward-test。

## 非目标

- 建设开放 Skill 市场、通用包管理器或远程团队控制平面。
- 初始化时下载任意 GitHub、网页或未知来源的 Skill。
- 把每个角色都生成为一份大型 Skill 或长期运行的 Agent。
- 让所有问题都启动多 Agent、设计文档、计划或完整治理门禁。
- 让 AI 角色代替用户批准需求、业务规则、风险、团队成员、安装、发布或外部操作。
- 把多个 AI 角色的输出描述为多名人类的独立审批。
- 从技术栈、文件名、代码形状或自由文本猜测业务规则、合规结论或高风险信号。
- 为了“完整”推荐没有当前使用场景或验证路径的 Skill 和角色。

## 核心原则

### 一个轻量路由入口，两个独立能力目录

目标项目默认生成两个职责窄的 Skills：

- `skill-discovery`：发现、去重、比较和推荐 Skill；不安装、不联网、不写配置。
- `team-orchestrator`：任务分级、能力提取、已批准角色选择、PK 编排和角色缺口建议；不自行批准新角色。

两者只读取小型元数据索引。候选被任务命中后才加载对应 Skill 正文或角色执行说明。角色卡是数据，不因为存在一个角色就自动生成一份重复的 Skill；只有角色确实需要非显然的专业流程时才关联已有或已批准 Skill。

### 推荐、批准、应用和激活是四个状态

任何候选都必须经过明确状态转换：

```text
discovered -> recommended -> approved -> applied
                                      -> active-for-task
```

- `discovered` 只表示在可信来源中存在。
- `recommended` 只表示与当前项目或任务有证据匹配。
- `approved` 必须来自用户对精确候选、来源、版本和权限的确认。
- `applied` 表示已按批准计划安装、复制、生成适配器或写入项目正典。
- `active-for-task` 只在当前任务需要时成立，任务结束后回到已批准但未激活状态。

模型不能把前一状态解释成后一状态。批准一个候选也不批准其未来版本、依赖、网络访问或其他候选。

### 最小充分集合

路由器先尝试用项目已有能力覆盖任务，再尝试已安装能力，最后才显示可信目录候选。选择顺序为：

```text
复用项目已有 Skill
  > 复用已安装且兼容的 Skill
  > 推荐官方或 curated Skill
  > 记录能力缺口
```

同一能力只允许一个当前 owner。相邻 Skill 重叠时推荐合并、复用或选择其一，不并行建立第二正典。初始化默认最多展示五个候选；单个任务默认最多激活三个 Skills。超过预算必须说明原因并请求用户扩大范围。

### 证据裁决，不按角色数量投票

PK 的裁决优先级固定为：

```text
用户确认的业务约束
  > 当前代码、测试和运行结果
  > 已批准的规格与决策
  > 项目治理规则
  > 目标版本的权威技术标准
  > 角色专业判断
```

多数意见不能覆盖更高优先级证据。无法闭环的分歧必须保留为 dissent 或 user-decision，不得用综合措辞隐藏。

## 现有能力边界

下列现有能力继续保持原义：

- `aicg team` 和 `assets/registries/team-role-registry.json` 仍只提供人类交付与治理职责建议，不创建 Agent。
- `assets/registries/aicg-product-team.json` 仍只描述 AICG 产品自身的已批准成员池。
- `technical-standard-registry.json` 继续提供 AICG 自带、经过审阅的技术标准 Skill 快照。
- capability harvest 继续从已验证实现提取项目 Skill 候选，不自动晋升。

新能力不能复用 `teamScope: human` 表示 AI 角色，也不能把 AICG 产品内部角色泄漏到客户项目。项目 AI 团队使用新的 `teamType: project-ai-agent-team` 和独立 schema。

## 总体架构

```text
仓库扫描或 greenfield 决策
  -> 项目能力需求
  -> Skill 元数据发现与去重
  -> AI 角色能力推荐
  -> 用户逐项决策
  -> 精确 planHash
  -> 事务式应用
  -> 结构与真实 Agent 验证

后续任务
  -> L0-L3 + 风险 + 领域分类
  -> requiredCapabilities
  -> 选择已批准最小角色集合
  -> 选择已批准最小 Skill 集合
  -> 单角色执行或独立 PK
  -> 证据裁决
  -> 缺口推荐
  -> 用户批准后另行应用
```

实现分为五个边界清晰的组件。

### 1. Skill 发现与决策路由器

路由器接收项目扫描、用户确认的技术栈、任务能力和可用 Skill 元数据，输出确定式候选。它不能执行进程、访问网络或写文件。

可信来源按以下顺序扫描：

1. 目标项目的正典 Skills 与已验证适配器；
2. 当前选择 Agent 已安装并可发现的 Skills；
3. AICG 自带注册表与 OpenAI/Codex 官方或 curated 目录快照；
4. 用户明确开启后，才可形成任意外部来源的只读检索计划。

第三方候选即使由用户开启检索，也只能进入 `recommended`，必须显示 URL、版本或提交、许可证、发布者、检索时间、所需权限、依赖和未验证边界。AICG 不执行其安装，直到用户批准精确计划。

候选至少包含：

```json
{
  "id": "stable-skill-id",
  "sourceKind": "project|installed|official-curated|external-explicit",
  "source": "non-secret source identifier",
  "version": "exact-or-unverified",
  "capabilities": ["bounded-capability"],
  "matchedEvidence": ["repository-or-user-confirmed evidence id"],
  "reason": "Why the current project or task benefits",
  "overlaps": [],
  "permissions": ["filesystem-read"],
  "contextBudget": { "estimatedTokens": 0 },
  "verification": "verified|reachable|stated|unverified",
  "decision": "recommended"
}
```

自由文本需求可以由 Agent 提取能力，但确定式核心只接受规范化 capability ID 和证据引用。关键词不能直接授权安装、网络、写入或高风险分类。

### 2. 项目 AI 团队推荐器

推荐器根据项目阶段生成 AI 角色候选：

- brownfield：使用实际语言、框架、模块、测试、外部集成和已确认风险；代码事实可以推荐技术角色，不能产生业务批准。
- greenfield：使用用户确认的产品类型、技术栈、目标端和风险信号；尚未确认的能力只能标 `conditional`。

基础候选包括需求/领域分析、技术架构、对应栈实现、质量测试和条件性的安全、数据、DevOps、无障碍或行业专家。只有当前证据命中的角色进入推荐；不存在“默认全家桶”。

项目批准后的角色清单写入 `docs/ai/agent-team.json`：

```json
{
  "schemaVersion": 1,
  "teamType": "project-ai-agent-team",
  "selectionPolicy": "minimum-sufficient-set",
  "roles": [
    {
      "id": "backend-domain-engineer",
      "title": "Backend domain engineer",
      "status": "approved-available",
      "capabilities": ["backend-domain-analysis"],
      "responsibilities": ["..."],
      "outOfScope": ["..."],
      "skillIds": ["..."],
      "requiredCompanionRoleIds": [],
      "mustRemainIndependentFrom": ["quality-reviewer"],
      "activation": { "levels": ["L1", "L2", "L3"], "signals": [] },
      "approval": { "source": "user", "evidenceId": "decision-id" }
    }
  ]
}
```

批准证据只保存稳定决策 ID，不复制对话全文或敏感业务描述。配置必须区分 `recommended`、`approved-available`、`active`、`deferred` 和 `rejected`；只有 `approved-available` 可被后续任务激活。

### 3. 任务能力与角色分配器

分配器扩展已批准的 L0-L3 路由输出：

```json
{
  "level": "L2",
  "requiredCapabilities": ["requirements-analysis", "backend-domain-analysis"],
  "skillIds": ["project-existing-skill"],
  "activeRoleIds": ["business-analyst", "backend-domain-engineer", "decision-referee"],
  "pkPolicy": "two-independent-plus-referee",
  "reasonCodes": ["business-behavior-change"],
  "gaps": []
}
```

默认策略：

| 等级 | 角色策略 | Skill 策略 |
| --- | --- | --- |
| L0 | 一个最匹配角色直接回答 | 只加载必要的零至一个 Skill |
| L1 | 一个实施角色；存在明确风险时增加一个快速复核角色 | 默认最多两个 Skills |
| L2 | 两个独立专业角色先分析，另一个裁决角色综合 | 默认最多三个 Skills |
| L3 | 三至五个独立专业角色，另一个裁决角色综合 | 按批准计划加载，必须报告预算 |
| 治理/发布 | 实现与独立验收必须分离 | 加载治理或发布专用 Skills |

风险证据可以提升等级和角色数量，不能降低。清晰度不足只增加发现与澄清，不自动把一个低风险任务升级成大团队。用户明确要求更轻流程时仍不能取消已确认的独立安全或发布复核边界。

### 4. 独立 PK 与裁决器

L2/L3 的逻辑阶段固定为：

1. **独立提案**：每个专业角色只接收共同任务事实、自己的职责和最小 Skill；不能看到其他角色的提案。
2. **交叉质疑**：角色读取匿名化的其他提案，逐项指出证据、完整性、越界、性能和验证问题；不能改写对方结论。
3. **证据裁决**：裁决角色按固定证据优先级形成推荐方案，记录胜出理由、被否决方案、未解决异议和需要用户决定的事项。
4. **执行分离**：需要写代码时，实施角色执行批准方案；高风险、治理或发布任务由独立角色验证。裁决角色不能把自己的综合当作用户批准。

标准输出：

```json
{
  "recommendation": "bounded conclusion",
  "evidence": [],
  "selectedProposalIds": [],
  "rejectedProposals": [{ "id": "...", "reason": "..." }],
  "dissent": [],
  "userDecisionsRequired": [],
  "implementationOwner": "role-id-or-null",
  "independentReviewer": "role-id-or-null",
  "limits": []
}
```

无法提供真正隔离的 Agent 会话时，不得声称“独立 PK”。运行时应降级为 `role-perspective-review`，明确它是同一 Agent 的多视角分析，并把独立性标为 `unverified`。

### 5. 缺口与增量批准协调器

后续任务发现能力缺口时：

- 缺 Skill：输出最多三个候选，或一个有理由的 `no-suitable-skill`；当前任务仍可在不越界的范围内继续。
- 缺角色：输出一个职责有界的角色提案和独立性关系，状态为 `needs-role-approval`。
- 缺业务决定、外部权限或高风险 owner：停止相应变更并询问用户，不能用新增角色或 Skill 替代授权。

用户批准后，协调器生成独立的配置变更 planHash。应用前重新扫描当前 Skill、团队配置和 manifest；任何来源、版本、权限、内容或配置变化都会使旧批准失效。

## 初始化体验

在 Agent、产物语言、项目阶段和技术栈确认后，初始化器增加两个紧邻的推荐步骤。

### Skill 推荐

展示最多五项：

```text
Skill / 来源 / 为什么匹配 / 复用或新增 / 上下文成本 / 权限 / 验证状态
```

每项可选择：添加、暂缓、拒绝、查看详情。默认不预选第三方安装。项目已有且无冲突的 Skill 标为 `reuse`，不复制第二份。

### AI 团队推荐

展示三组：

- `needed-now`：当前项目和首批开发任务已需要；
- `conditional`：达到明确触发条件时建议加入；
- `gap`：缺少证据，不能确定。

每个角色展示职责、不负责事项、关联 Skills、必须独立的角色和预计激活等级。用户逐项选择加入、暂缓或拒绝。选择“加入”只使角色成为 `approved-available`，不会让它参与每个任务。

最终 init 预览同时显示精确文件动作、Skill/角色决定、初始上下文预算、网络/安装需求和 planHash。批准前零写入；应用后统一运行结构检查和一次真实风格路由 forward-test。

## 上下文与性能预算

- `skill-discovery` 与 `team-orchestrator` 的默认加载正文合计不超过约 800 tokens。
- Skill 和角色索引只包含 ID、description、capabilities、来源、状态和路由字段；不包含完整正文。
- 初始化默认最多展示五个 Skill 和五个角色候选，其余只报告“存在更多候选”。
- L0 最多一个活跃角色；L1 默认一个、最多两个；L2 固定两个专业角色加一个裁决角色；L3 最多五个专业角色加一个裁决角色。
- 普通任务默认最多加载三个 Skills。只有 L3 的已批准计划可以扩大，并必须显示预计上下文成本。
- 本地确定式推荐不得访问网络，目标 p95 增量不超过 100 ms；网络目录刷新是单独、显式动作，不计入 init 默认路径。
- 多 Agent PK 的网络或模型等待必须与本地治理耗时分开报告。

## 完整性与不越界规则

### 完整性

每次推荐输出能力覆盖矩阵：

```text
required capability -> existing coverage -> selected Skill -> selected role
                    -> verification -> remaining gap
```

“没有候选”是合法结果，但必须说明搜索过的可信来源和剩余缺口。不能通过添加泛化角色或巨型 Skill 伪造完整性。

### 不越界

- 只读扫描不获得网络、安装或写入权限。
- 用户批准 Skill 不等于批准其依赖执行脚本、hook、CI、外部服务或未来更新。
- 用户批准角色不等于批准该角色提出的范围、风险或外部操作。
- 角色不能读取与当前任务无关的 secrets、业务上下文或完整 Skill 正文。
- 安装外部 Skill 前必须验证普通目录、来源、版本/commit、许可证、manifest、预期文件和脚本；不执行安装生命周期脚本作为发现步骤。
- 任意外部来源默认关闭，只有用户明确开启一次具体检索后才能访问。
- Skill 或角色的升级、删除、替换和退休都使用新的显式计划；普通 sync 不自动改变用户决定。

## 错误与降级

- Agent Skill 目录不可读：保留项目内发现结果，标记该来源 `unavailable`，不把空结果解释为没有 Skill。
- 官方/curated 快照过期：候选保持可见但标记 `refresh-due`；不在 init 中隐式联网刷新。
- 候选冲突或同一 capability 多 owner：返回 `needs-user-decision`，不自动选择。
- 角色需要不存在的 Skill：角色可被推荐但不能标 `ready`；显示依赖缺口。
- 运行时没有多 Agent 能力：降级为单 Agent 多视角，并明确独立性未验证。
- PK 角色超时或失败：裁决器不能假装得到该角色意见；记录缺席和剩余风险，根据最低角色要求决定继续还是请求用户。
- 用户拒绝候选：记录稳定 ID 和决定来源，后续相同证据不重复打扰；出现新版本、新风险或新任务能力时才可重新推荐。

## 配置与迁移

现有配置增加可选字段，新字段缺失时保持旧行为：

```json
{
  "skillDiscovery": {
    "trustedSources": ["project", "installed", "official-curated"],
    "externalSearch": "explicit-only",
    "maxRecommendations": 5
  },
  "agentTeam": {
    "enabled": true,
    "rosterPath": "docs/ai/agent-team.json",
    "selectionPolicy": "minimum-sufficient-set",
    "pkThresholds": {
      "L0": "single",
      "L1": "single-with-conditional-review",
      "L2": "two-independent-plus-referee",
      "L3": "three-to-five-independent-plus-referee"
    }
  }
}
```

旧项目第一次 `sync` 只输出推荐和迁移预览，不自动生成团队、安装 Skill 或改变现有路由。用户批准精确计划后才增加新产物。普通升级零删除，不把历史项目 Skills 重新归属为 AICG 管理。

## 验证策略

### 单元与契约测试

- Skill 来源优先级、去重、兼容、冲突、过期和推荐上限。
- 默认路径零网络、零进程执行、零写入。
- 未批准候选不能进入配置、manifest、适配器或活跃任务。
- greenfield 与 brownfield 推荐只使用各自允许的证据。
- 人类团队、AICG 产品团队和项目 AI 团队 schema 互相拒绝。
- L0-L3 角色数量、Skill 数量、独立性关系和风险升级规则。
- 缺 Skill、缺角色、拒绝、暂缓、过期批准和 stale planHash。
- 任意来源默认关闭，显式检索也只能产生候选。

### 集成测试

- `init --dry-run` 展示推荐但不写文件。
- 精确批准后只应用选中的 Skills、适配器和团队角色。
- 二次 init/sync 幂等，不重复推荐已拒绝且证据未变的候选。
- 外部 Skill 安装失败完整回滚，既有项目和全局 Agent 配置不变。
- 旧配置保持可读，普通 sync 不自动添加团队或删除历史 Skill。
- 生成的两个默认 Skills、团队正典、上下文路由和 manifest 引用闭合。

### 真实 Agent forward-test

至少覆盖：

1. L0 问答只启用一个角色，不读取无关 Skill。
2. L1 小修由一个实施角色完成，风险信号出现时才增加复核。
3. L2 业务变更产生两个相互独立的提案、交叉质疑和一个证据裁决。
4. L3 跨前后端功能选择三至五个角色，不超过预算。
5. 缺少专业能力时只推荐角色和 Skill，未获批准前不持久化、不激活。
6. 同一 Agent 模拟多视角时明确标为非独立，不冒充多 Agent PK。

### A/B 验收

在相同模型、提示、仓库起点和隐藏验收下，对 L0-L3 分别比较旧路由与新路由：

- 首次有效响应时间；
- 总 token 与治理上下文 token；
- 用户打断与确认次数；
- 产品测试和隐藏验收通过率；
- 无需求行为扩展；
- 越界安装、写入或角色激活；
- 返工次数与剩余未闭环项。

通过标准：L0/L1 不因新能力强制启动 PK；普通任务治理上下文满足预算；L2/L3 的完整性或边界覆盖提高且无越界；任何质量收益不能以未授权写入、安装或虚假独立性换取。

## 实施边界与预计修改面

实现应优先扩展现有确定式模块，不建立第二套框架：

- 扩展初始化决策和预览，增加 Skill 与 AI 团队逐项选择。
- 新增只读 Skill 元数据发现/推荐核心和项目 AI 团队 schema/分配器。
- 生成 `skill-discovery`、`team-orchestrator` 和 `docs/ai/agent-team.json`。
- 扩展 context map、manifest、checker、sync/prune 和本地化输出。
- 保持 `aicg team` 的人类职责语义和现有 AICG 产品团队实现不变。
- 增加结构、迁移、性能、真实场景和 forward-test 证据。

第一版不新增开放市场、远程服务、任意插件执行、常驻 Agent 进程或可编程规则语言。

## 成功标准

1. 初始化能对 greenfield/brownfield 输出有证据的 Skill 和 AI 角色建议，并允许逐项决策。
2. 默认发现路径离线、只读、确定式，未知外部来源不会被访问。
3. 未经用户批准，不安装 Skill、不写团队、不修改全局配置、不激活新增角色。
4. 后续任务只激活最小已批准角色与 Skills，L0/L1 不强制多人 PK。
5. L2/L3 的独立提案、交叉质疑和证据裁决可被真实 Agent 回放；无法独立时诚实降级。
6. 能力缺口会再次推荐，但不能以新角色或 Skill 替代业务授权和风险决定。
7. 普通上下文、候选数量和本地推荐耗时满足预算。
8. 现有项目升级零删除、旧配置兼容、现有三类团队语义不混淆。
9. A/B 结果证明速度没有被无条件 PK 拖慢，质量与完整性提升不伴随越界行为。

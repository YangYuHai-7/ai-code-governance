# Skill 发现与动态 Agent 团队设计

## 状态

- 决策状态：产品负责人已于 2026-09-16 批准方向；同日根据 DSH 对抗评审批准动态领域角色、风险等级与评审模式解耦，以及高风险领域必须由资质真人最终复核。
- 范围：为 AICG 初始化和后续任务增加可信 Skill 发现、用户决策、项目 AI 角色推荐、动态角色选择和有独立性的 PK 裁决。
- 适用项目：greenfield 与 brownfield。
- 默认 Skill 来源：项目内已有 Skill、当前 Agent 已安装 Skill、官方或 curated Skill 目录；任意网络来源默认关闭。
- 默认评审策略：任务等级只决定验证强度，不直接决定角色数量。局部、可逆、无业务或公共契约变化的生产修复可以保持 L2 验证强度但使用单角色或快速复核；只有业务行为、公共契约、跨模块、跨端、高后果或不可逆证据才启动独立 PK。L3 默认使用三至五个独立专业角色和一个裁决角色。
- 权限边界：推荐不是授权。联网、安装、项目写入、全局 Agent 配置修改、角色入队和外部操作分别需要明确批准。
- 专业边界：法律、医疗、财务、食品安全等高风险领域可以启用 AI 专业视角，但最终专业判断必须标记为需要相应资质真人复核；AI 角色不得冒充持证专业人士。

## 问题

当前 AICG 已能根据技术栈生成项目级 Skills，也有只读的人类团队建议和 AICG 产品内部成员池，但缺少两个面向目标项目的闭环：

1. 初始化时不能统一发现项目已有、本机已安装和可信目录中的可复用 Skills，并让用户逐项决定是否加入治理；后续任务发现能力缺口时也没有同一条安全推荐路径。
2. 初始化时不能根据新旧项目证据动态提出项目专用的 AI 专业角色；现有固定角色池不能覆盖合同、餐饮等开放领域，也不应通过预置所有行业角色解决。后续需求分析、实现和评审也没有一个按任务能力与风险证据选择最小角色集合、让角色独立提出方案并交叉质疑的运行协议。

如果直接把所有候选 Skill 和角色装进项目，会重新制造上下文膨胀、流程变慢和职责重叠。如果让模型自动安装或自动扩充团队，则会越过用户的供应链、写入和授权边界。如果只让一个模型依次扮演多个角色，又无法形成真正的独立评审。

新设计必须在不过度设计、速度、质量、完整性和不越界五项底线之间取得可验证的平衡。

## 目标

1. 初始化时根据仓库事实或用户确认的新项目信息，动态提出最小必要 Skills 和 AI 角色；角色集合不由固定行业名单决定。
2. 候选必须说明来源、适用证据、收益、重叠、权限、上下文成本和验证状态。
3. 用户可以逐项添加、暂缓、拒绝或查看详情；未批准项不能安装、持久化或激活。
4. 后续任务由轻量路由器根据 L0-L3、领域、风险和所需能力选择最小角色与 Skills。
5. 能力不足时提出新的 Skill 或角色建议，但继续保持在建议状态，直到用户批准。
6. 命中独立 PK 触发条件的 L2/L3 使用真正独立的提案、交叉质疑和证据裁决，避免一言堂和简单多数票；L2 本身不再等同于必须 PK。
7. 保持人类团队建议、AICG 产品团队和项目 AI 角色团队三个概念及其正典完全分离。
8. 为推荐精度、上下文预算、额外延迟、角色独立性和越界行为建立机器检查与真实 Agent forward-test。

## 非目标

- 建设开放 Skill 市场、通用包管理器或远程团队控制平面。
- 初始化时下载任意 GitHub、网页或未知来源的 Skill。
- 把每个角色都生成为一份大型 Skill 或长期运行的 Agent。
- 让所有问题都启动多 Agent、设计文档、计划或完整治理门禁。
- 让 AI 角色代替用户批准需求、业务规则、风险、团队成员、安装、发布或外部操作。
- 把多个 AI 角色的输出描述为多名人类的独立审批。
- 把 AI 法律、医疗、财务、食品安全等专业视角描述为持证专业服务，或让 AI 替代法律责任、诊断、投资决定、食品安全签字等真人决策。
- 从技术栈、文件名、代码形状或自由文本猜测业务规则、合规结论或高风险信号。
- 为了“完整”推荐没有当前使用场景或验证路径的 Skill 和角色。
- 建立覆盖所有行业的固定角色大全；系统固定的是角色协议、证据和授权边界，不是项目成员名单。

## 核心原则

### 一个轻量路由入口，两个独立能力目录

标准档和完整档在用户批准后可以生成两个职责窄的管理 Skills；最小档不生成正文，所有档位在批准前都只显示预览：

- `skill-discovery`：发现、去重、比较和推荐 Skill；不安装、不联网、不写配置。
- `team-orchestrator`：任务分级、能力提取、已批准角色选择、PK 编排和角色缺口建议；不自行批准新角色。

两者只读取小型元数据索引。候选被任务命中后才加载对应 Skill 正文或角色执行说明。角色卡是数据，不因为存在一个角色就自动生成一份重复的 Skill；只有角色确实需要非显然的专业流程时才关联已有或已批准 Skill。`agentTeam.enabled` 默认关闭，批准 roster 或当前任务的角色计划后才启用。

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

推荐器根据项目阶段和当前能力缺口动态生成 AI 角色候选。AICG 固定保存的是角色 schema、风险分类和授权协议，不是合同、餐饮、医疗、金融等行业角色名单：

- brownfield：使用实际语言、框架、模块、测试、外部集成和已确认风险；仓库事实可以提出技术或领域候选，不能替代用户确认领域含义或产生业务批准。
- greenfield：使用用户确认的产品类型、首批功能、技术栈、目标端、领域和风险信号；尚未确认的能力只能标 `conditional`。
- 后续任务：先计算现有 roster 的能力覆盖；缺口存在时生成一个职责有界的角色提案，不从固定行业清单硬选，也不自动入队。

角色提案由规范化能力组合生成，例如需求/领域分析、技术架构、对应栈实现、质量测试，以及条件性的安全、数据、DevOps、无障碍或行业专业视角。只有当前证据命中的角色进入推荐；不存在“默认全家桶”，也不存在覆盖全部行业的内置 roster。

领域识别遵循两阶段证据：

1. Agent 可以从用户需求、项目文档或代码中提取 `domainNeed` 候选及引用，但候选状态只能是 `proposed-unconfirmed`；
2. 用户确认后转换为规范化 `confirmedDomainNeeds`，确定式推荐器才能据此产生 `recommended` 角色。

例如：

- 合同起草、审批、履约或条款分析命中 `contract-law`，推荐合同法律专业视角，并要求用户确认司法辖区；最终法律判断必须由相应辖区持证律师复核。
- 餐厅官网只命中餐饮领域理解，不自动推荐食品安全角色；后厨、过敏原、冷链、保质期或监管流程被确认后，才分别推荐餐饮运营或食品安全专业视角，并要求具备相应资质的真人复核高风险结论。
- 技术栈、文件名或包依赖本身不能证明行业语义，也不能把候选提升为已确认领域。

项目批准后的角色清单写入 `docs/ai/agent-team.json`：

```json
{
  "schemaVersion": 1,
  "teamType": "project-ai-agent-team",
  "selectionPolicy": "minimum-sufficient-set",
  "roles": [
    {
      "id": "contract-legal-domain-reviewer",
      "title": "Contract legal domain reviewer",
      "status": "approved-available",
      "origin": "dynamic-project-role",
      "domainNeeds": ["contract-law"],
      "capabilities": ["contract-clause-risk-review"],
      "responsibilities": ["Identify clause, obligation, approval, and jurisdiction issues for qualified human review."],
      "outOfScope": ["Issuing final legal advice, approving a contract, or claiming professional licensure."],
      "skillIds": ["project-contract-review"],
      "requiredCompanionRoleIds": [],
      "mustRemainIndependentFrom": ["quality-reviewer"],
      "activation": { "reviewModes": ["quick-review", "independent-pk", "high-consequence-pk"], "signals": ["contract-law"] },
      "professionalBoundary": {
        "humanReviewRequired": true,
        "qualification": "licensed-lawyer",
        "jurisdiction": "user-confirmed-or-open-gap",
        "decisionAuthority": "human-only",
        "reason": "AI output is issue spotting and analysis, not final legal advice."
      },
      "approval": { "source": "user", "evidenceId": "decision-id" }
    }
  ]
}
```

批准证据只保存稳定决策 ID，不复制对话全文或敏感业务描述。配置必须区分 `proposed-unconfirmed`、`recommended`、`approved-available`、`active-for-task`、`deferred` 和 `rejected`；只有 `approved-available` 可被后续任务激活。动态角色 ID 在同一项目中稳定，但不进入 AICG 产品内置角色池，也不对其他项目形成默认推荐。

`professionalBoundary.humanReviewRequired` 为 true 时，任务输出必须包含尚缺的真人资质、司法辖区或责任主体；该边界不能被 PK 多数票、用户选择较轻流程或添加更多 AI 角色取消。

### 3. 任务能力与角色分配器

分配器扩展已批准的 L0-L3 路由输出：

```json
{
  "level": "L2",
  "requiredCapabilities": ["requirements-analysis", "backend-domain-analysis"],
  "skillIds": ["project-existing-skill"],
  "activeRoleIds": ["backend-domain-engineer"],
  "reviewMode": "single",
  "reviewModeTriggers": [],
  "reasonCodes": ["business-behavior-change"],
  "gaps": []
}
```

任务等级与评审模式分开计算：

| 评审模式 | 默认角色策略 | 触发证据 | Skill 策略 |
| --- | --- | --- | --- |
| `single` | 一个最匹配角色直接回答或实施 | L0；或局部、可逆、无业务/契约变化的 L1/L2 | 只加载必要的零至两个 Skills |
| `quick-review` | 一个实施角色加一个定向复核角色 | 明确但局部的质量、安全或领域检查点 | 默认最多三个 Skills |
| `independent-pk` | 两个独立专业角色加一个裁决角色 | 业务行为、公共契约、多模块或不可逆决定 | 默认最多三个 Skills |
| `high-consequence-pk` | 三至五个独立专业角色加一个裁决角色 | 跨端、迁移、外部动作、法律/医疗/财务/食品安全等高后果边界 | 按批准计划加载并报告预算 |
| 治理/发布 | 实现与独立验收必须分离 | 治理 schema、发布或证据边界 | 加载治理或发布专用 Skills |

`taskLevel` 继续决定验证类别和最低门禁；`reviewMode` 决定分析与复核编排。生产路径可以保持 L2 的行为验证要求，但路径本身不能成为启动 PK 的唯一证据。评审模式只能由用户确认的业务/风险、公共契约、计划改动面和不可逆性提升。清晰度不足只增加发现与澄清，不自动把低风险任务升级成大团队。

路由必须在编辑前使用计划路径和已知风险先计算一次，在完成前使用真实 diff 重算。若最终 diff 提升 `taskLevel` 或 `reviewMode`，必须停止完成并补足尚未执行的审批或复核，不能在代码完成后伪造事前独立提案。

### 4. 独立 PK 与裁决器

`independent-pk` 与 `high-consequence-pk` 的逻辑阶段固定为：

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
  "rejectedProposals": [{ "id": "proposal-b", "reason": "Conflicts with the approved public contract." }],
  "dissent": [],
  "userDecisionsRequired": [],
  "implementationOwner": "role-id-or-null",
  "independentReviewer": "role-id-or-null",
  "limits": []
}
```

无法提供真正隔离的 Agent 会话时，不得声称“独立 PK”。运行时应降级为 `role-perspective-review`，明确它是同一 Agent 的多视角分析，并把独立性标为 `unverified`。

PK 默认只允许一次独立提案、一次交叉质疑和一次裁决。裁决可以选择“无需替代方案或新增抽象”；PK 不自动生成设计文档、任务运行时或更多角色。扩大轮数、角色数或上下文预算必须由用户批准新的计划。

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

推荐界面同时显示角色来源：`generic-capability-composition`、`repository-evidence` 或 `user-confirmed-domain`。动态领域角色必须展示领域证据和专业边界。例如合同角色显示司法辖区是否已确认以及“需要持证律师复核”；餐饮角色显示它覆盖餐饮运营还是食品安全，不能用笼统的“餐饮专家”隐藏责任差异。

最终 init 预览同时显示精确文件动作、Skill/角色决定、初始上下文预算、网络/安装需求和 planHash。批准前零写入；应用后统一运行结构检查和一次真实风格路由 forward-test。

## 上下文与性能预算

- Minimal 不生成或默认加载 `skill-discovery`、`team-orchestrator` 正文；Standard/Complete 在用户批准后生成，正文只在对应推荐或编排任务中按需加载，不能进入 ordinary 常驻闭包。两份正文合计仍不超过约 800 tokens，并计入对应任务总预算。
- Skill 和角色索引只包含 ID、description、capabilities、来源、状态和路由字段；不包含完整正文。
- 初始化默认最多展示五个 Skill 和五个角色候选，其余只报告“存在更多候选”。
- `single` 最多一个活跃角色；`quick-review` 最多两个；`independent-pk` 固定两个专业角色加一个裁决角色；`high-consequence-pk` 最多五个专业角色加一个裁决角色。
- 普通任务默认最多加载三个 Skills。只有 L3 的已批准计划可以扩大，并必须显示预计上下文成本。
- 本地确定式推荐不得访问网络，目标 p95 增量不超过 100 ms；网络目录刷新是单独、显式动作，不计入 init 默认路径。
- 多 Agent PK 的网络或模型等待必须与本地治理耗时分开报告。
- A/B 还必须记录端到端完成时长和全任务累计 tokens；只测首次响应不能证明 PK 没有拖慢交付。

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
- 用户批准 AI 专业角色不等于获得真人专业意见；`humanReviewRequired` 的完成缺口只有满足相应资质和辖区的真人证据才能关闭。
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
    "enabled": false,
    "status": "pending-approval",
    "rosterPath": "docs/ai/agent-team.json",
    "selectionPolicy": "minimum-sufficient-set",
    "reviewModes": {
      "default": "single",
      "quickReview": "explicit-local-review-evidence",
      "independentPk": "behavior-or-contract-or-multi-module-evidence",
      "highConsequencePk": "cross-surface-or-external-or-professional-risk"
    }
  }
}
```

旧项目第一次 `sync` 只输出推荐和迁移预览，不自动生成团队、安装 Skill 或改变现有路由。Minimal 保持无 roster、无管理 Skill 正文；Standard/Complete 也只有在用户批准精确计划后才增加索引、正文或 roster。普通升级零删除，不把历史项目 Skills 重新归属为 AICG 管理。

## 验证策略

### 单元与契约测试

- Skill 来源优先级、去重、兼容、冲突、过期和推荐上限。
- 默认路径零网络、零进程执行、零写入。
- 未批准候选不能进入配置、manifest、适配器或活跃任务。
- greenfield 与 brownfield 推荐只使用各自允许的证据。
- 人类团队、AICG 产品团队和项目 AI 团队 schema 互相拒绝，任何命令输出不得嵌入另一类团队 roster。
- 任务等级与评审模式独立计算；角色数量、Skill 数量、独立性关系和风险升级规则分别断言。
- 动态领域角色只能由确认的 `domainNeed` 推荐；自由文本或仓库候选保持 `proposed-unconfirmed`。
- 法律、医疗、财务和食品安全等专业风险的角色必须带不可取消的真人资质复核边界。
- 缺 Skill、缺角色、拒绝、暂缓、过期批准和 stale planHash。
- 任意来源默认关闭，显式检索也只能产生候选。

### 集成测试

- `init --dry-run` 展示推荐但不写文件。
- 精确批准后只应用选中的 Skills、适配器和团队角色。
- 二次 init/sync 幂等，不重复推荐已拒绝且证据未变的候选。
- 外部 Skill 安装失败完整回滚，既有项目和全局 Agent 配置不变。
- 旧配置保持可读，普通 sync 不自动添加团队或删除历史 Skill。
- 经批准后生成的两个管理 Skills、团队正典、上下文路由和 manifest 引用闭合；未批准和 Minimal 场景不生成这些产物。

### 真实 Agent forward-test

至少覆盖：

1. L0 问答只启用一个角色，不读取无关 Skill。
2. L1 小修由一个实施角色完成，风险信号出现时才增加复核。
3. 两行局部生产修复保持所需验证强度，但没有行为、契约或风险证据时不启动 PK。
4. L2 业务或公共契约变更产生两个相互独立的提案、交叉质疑和一个证据裁决。
5. L3 跨前后端或高后果功能选择三至五个角色，不超过预算。
6. 合同项目会建议合同法律专业视角并保留司法辖区和持证律师复核缺口；普通餐厅官网不误触发食品安全角色，确认过敏原或后厨监管后才触发。
7. 缺少专业能力时只推荐动态角色和 Skill，未获批准前不持久化、不激活。
8. 同一 Agent 模拟多视角时明确标为非独立，不冒充多 Agent PK。

### A/B 验收

在相同模型、提示、仓库起点和隐藏验收下，对 L0-L3 分别比较旧路由与新路由：

- 首次有效响应时间；
- 端到端完成时间；
- 总 token 与治理上下文 token；
- 用户打断与确认次数；
- 产品测试和隐藏验收通过率；
- 无需求行为扩展；
- 越界安装、写入或角色激活；
- 返工次数与剩余未闭环项。

通过标准：L0/L1 和无行为/契约/风险证据的小型 L2 不因新能力强制启动 PK；普通任务治理上下文满足预算；命中 PK 的 L2/L3 完整性或边界覆盖提高且无越界；任何质量收益不能以未授权写入、安装、虚假独立性或冒充真人专业意见换取。

## 实施边界与预计修改面

实现应优先扩展现有确定式模块，不建立第二套框架：

- 扩展初始化决策和预览，增加 Skill 与 AI 团队逐项选择。
- 新增只读 Skill 元数据发现/推荐核心和项目 AI 团队 schema/分配器。
- 只在对应档位和用户批准后生成 `skill-discovery`、`team-orchestrator` 和 `docs/ai/agent-team.json`。
- 扩展 context map、manifest、checker、sync/prune 和本地化输出。
- 修复 `aicg team` 的混合输出，使人类职责建议、AICG 产品团队和项目 AI 团队分别使用独立入口或互斥 schema；各自实现可以复用，但输出不得互相嵌套。
- 增加结构、迁移、性能、真实场景和 forward-test 证据。

第一版不新增开放市场、远程服务、任意插件执行、常驻 Agent 进程或可编程规则语言。

## 成功标准

1. 初始化能对 greenfield/brownfield 输出有证据的 Skill 和动态 AI 角色建议，并允许逐项决策；项目 roster 不依赖固定行业角色大全。
2. 默认发现路径离线、只读、确定式，未知外部来源不会被访问。
3. 未经用户批准，不安装 Skill、不写团队、不修改全局配置、不激活新增角色。
4. 后续任务只激活最小已批准角色与 Skills，任务等级与评审模式分离，L0/L1 和无 PK 证据的小型 L2 不强制多人 PK。
5. 命中 PK 触发条件的 L2/L3 独立提案、交叉质疑和证据裁决可被真实 Agent 回放；无法独立时诚实降级。
6. 能力缺口会再次推荐，但不能以新角色或 Skill 替代业务授权和风险决定。
7. 合同、医疗、财务、食品安全等高风险专业视角始终保留相应资质真人的最终复核缺口，AI 不能自行关闭。
8. 普通上下文、候选数量和本地推荐耗时满足预算。
9. 现有项目升级零删除、旧配置兼容、现有三类团队语义不混淆。
10. A/B 结果证明速度没有被无条件 PK 拖慢，质量与完整性提升不伴随越界行为。

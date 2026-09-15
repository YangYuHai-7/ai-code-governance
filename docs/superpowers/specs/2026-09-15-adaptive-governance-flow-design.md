# 自适应 AI 编码治理流程设计

## 状态

- 决策状态：产品负责人已于 2026-09-15 批准。
- 范围：重新设计 AICG 的安装引导、产物选择、任务路由、批准门槛和能力收割，使治理成本随真实任务动态变化。
- 治理产物默认语言：英语。
- 首批正式支持的治理产物语言：英语、简体中文。
- 兼容边界：现有项目和已有双语配置必须继续可读；普通升级不得破坏性压缩历史产物。
- 证据边界：模型分类只能推荐流程；只有仓库状态、负责人确认的风险、真实命令和当前 diff 证据才能满足机器门禁。

## 问题

当前产品包含了正确的治理能力，但把过多能力放进了无条件基线。Codex-only 的最小档目前会生成 19 个治理文件，更高档位会生成 21–37 个文件；普通实现任务启动时也需要固定加载约 1,600–2,700 个治理 token。相比之下，小型 fixture 上的治理检查约为 0.1 秒，10,000 文件 fixture 约为 0.68 秒。因此主要延迟来自上下文和流程仪式，而不是检查器本身的 CPU 时间。

当前安装流程还存在三个问题：交互语言和治理产物语言可能被绑定；`defaultConfig()` 默认生成中文产物；模糊的治理请求可能直接触发完整能力模型。任务运行阶段又把“一句话需求”“完整需求”“小问题”“大功能”混在同一分类里，而它们实际属于两个维度：输入明确度与改动影响。这会让一个表达简短的小需求走最重流程，也可能让一份写得很完整的高风险需求显得过于简单。

新设计必须同时保留单一正典、最小路由、真实机器门禁、安全迁移和能力成长，但不能让所有任务都执行完整生命周期。

## 目标

1. 把支持哪些编码 Agent 作为安装时第一个用户可见的决策。
2. 单独询问治理产物语言，并默认使用英语。
3. 在提问前检测既有技术栈；既有项目由用户确认检测结果，而不是重新选栈。
4. 只根据既有仓库中的真实证据提取架构和公共能力候选。
5. 生成小型稳定内核，以及由证据和用户决策选中的能力。
6. 根据变更类型、影响范围、风险和明确度路由对话。
7. 简单问答和低风险修复不强制走设计或计划流程。
8. 业务、高风险、大型或跨端变更必须经过需求与计划批准。
9. Skill 成长采用有证据的候选收割，优先更新已有 Skill，而不是新建。
10. 精简产物时，不允许普通升级删除用户内容或历史内容。

## 非目标

- 建设通用插件市场或任意表达式驱动的产物规则引擎。
- 仅靠关键词判断任务风险或获得发布授权。
- 替代项目已有的规格或执行工作流。
- 要求每个请求都生成设计文档、计划、子 Agent 或治理子进程。
- 根据文件名或当前聊天客户端推断业务规则、风险接受、架构或支持的客户端。
- 自动升级既有项目的技术栈。
- 把文件已生成、模拟评审或结构检查通过视为产品行为证据。
- 未获独立授权时发布包、推送仓库、部署或安装 hook。

## 设计原则

### 稳定内核，条件能力

每个受治理仓库必须保留三项不可退让的能力：

1. 一个治理正典源；
2. 一条通向最小相关上下文的路由；
3. 被强制声明不成立时会失败的机器检查。

十二层模型继续作为能力目录，不再作为必须全部生成的文件套餐。preset 选择能力，能力选择产物，任务 profile 决定哪些产物进入上下文。

### 分类维度彼此独立

任务范围、风险、变更类型和明确度分别判断。一句话需求可能是 L0 问答，也可能是 L3 大功能；完整需求可能只是 L1 文档修改，也可能是 L3 高风险变更。

### 流程只能升级

任务发现新证据时可以升级，但跨过更强批准边界后不能降级。文档任务的实际 diff 如果改变生产行为，交付前必须升级。只有明确发布意图才能进入发布流程，文档里出现“发布”二字不算授权。

### 提问保护决策，不追问实现琐事

只有不同答案会实质改变业务行为、公共契约、数据、兼容性、外部副作用、验收或任务范围时，Agent 才打断用户。普通实现细节应根据项目证据自行决定，并在交付时说明。

### 没有所有权就不能自动删除

历史、seed、未知、漂移或用户编辑过的内容一律保留。破坏性压缩必须有可信 manifest、dry-run 计划、精确 planHash 和显式批准。

## 总体架构

```text
只读扫描仓库
  -> 收集安装决策
  -> 选择能力
  -> 选择产物
  -> 预览计划和预算
  -> 事务式应用
  -> 完整性检查

对话意图
  -> 推荐任务等级
  -> 加载最小上下文 profile
  -> 按需执行需求/设计/计划批准
  -> 实现并运行项目验证
  -> 根据实际 diff 校验最低等级
  -> 生成能力收割候选
```

实现拆为七个边界清晰的组件。

### 1. 安装决策收集器

决策收集器接收扫描结果和用户答案，但不写文件。交互顺序固定为：

1. 支持哪些编码 Agent；
2. 治理产物使用什么语言；
3. 确认新项目还是既有项目；
4. 确认或选择技术栈；
5. 既有代码采用什么策略；
6. 推荐的治理档位和可选能力；
7. AICG 调用方式，以及需要单独授权的集成。

仓库扫描仍然先于第一个问题执行，以便问题能携带真实证据；但扫描结果不能替用户决定客户端范围，也不能静默覆盖用户答案。

### 2. 能力选择器

能力选择器是一个小型内部模块，不建设公开的注册框架。它把现有 `governanceDepth`、`features`、已确认的仓库证据和用户决策解析成六组能力：

| 能力 | 职责 | 启用条件 |
| --- | --- | --- |
| `core` | 正典目录、配置、manifest、根入口、完整性门禁 | 始终启用 |
| `routing` | 上下文 profile 和验证路由 | standard 或 complete |
| `policy` | 架构、技术栈、业务和反模式规则 | 有证据且用户确认 |
| `evidence` | acceptance、surface、release 证据 | 首次使用 |
| `lifecycle` | memory、长任务、harvest 和 promotion | 显式启用 |
| `integration` | 客户端 adapter、hook、CI、外部工作流 bridge | 显式选择 |

第一版可以把这些能力编码成紧邻产物 builder 的 JavaScript 元数据，但不能引入可配置表达式语言、动态插件加载或第二份 JSON 正典。

### 3. 产物选择器

每个产物 builder 声明：

```text
id
path
capability
activation: eager-core | selected | first-use | evidence-produced
requires
ownership
routeProfiles
gateAssertions
```

选择器为新项目计算精确 allowlist。`buildArtifacts()` 改为委托选择器，而不是把所有已知产物当作基线。检查器从同一份选择结果计算期望产物，避免生成器和检查器分别定义一套档位契约。

### 4. 任务路由推荐器

CLI 无法仅凭关键词可靠理解语义，因此初始意图分类仍由 Agent 完成。治理框架负责生成机器可读路由策略和简洁的客户端原生指令。

路由输入模型：

```text
mutation: none | governance-only | non-production | product-behavior | external-action
scope: single-file | single-module | multi-module | multi-surface
risk: low | business | high-consequence
clarity: clear | locally-ambiguous | exploratory
```

路由输出模型：

```text
level: L0 | L1 | L2 | L3
profile
requiredApprovals
verificationClass
overlays
reasonCodes
```

Agent 推荐初始等级。交付前，CLI 根据实际 diff、已选择风险、发布意图和验证证据计算机器可验证的最低等级。如果声明等级过低，完成门禁必须失败并要求升级。机器检查不能自动降级，也不能授权外部操作。

### 5. 批准门槛协调器

治理框架只定义何时需要批准，不创建第二套计划正典。如果项目已经选择规格或执行工作流 provider，其 design、plan、task list 和 completion artifact 继续由该 provider 管理；否则 L2 批准可以保留在客户端对话中，L3 使用所选客户端原生的设计和计划流程。只有显式启用 task runtime 能力时，才创建持久任务运行时。

### 6. 能力收割器

harvest 只在产品行为变更通过真实验证后运行。它生成候选，不生成自动可信的 Skill。候选必须绑定当前实现路径、公共入口、测试、owner 和实现 fingerprint。

候选处理优先级：

```text
更新已有 Skill
  > 扩展已有 Skill
  > 创建新 Skill
  > 记录 no-skill-with-reason
```

### 7. 迁移保护器

template v3 引入新的选择和路由行为。普通跨版本 sync 必须保留历史产物。物理压缩是单独批准的动作，并复用已有 execution plan 的 planHash 和事务回滚能力。

## 安装流程

### Agent 选择

第一个可见问题询问哪些客户端必须读取同一个治理正典：

- 仅 Codex；
- 仅 Claude Code；
- 仅 Cursor；
- 用户多选；
- 全部内建客户端。

在尚未选择交互语言前，第一个问题默认使用简短的中英双语；如果用户已经通过 `--locale` 明确指定交互语言，则使用指定语言。第二个问题才选择治理产物语言，聊天语言不能静默替用户回答产物语言。

选择记录的来源必须是 `user` 或 `interactive`。仓库现有文件和当前聊天客户端只能说明现状，不能授权缩小支持范围。

### 语言选择

第二个可见问题询问治理产物语言：

- 英语，推荐且默认；
- 简体中文。

配置分离三类语言：

```json
{
  "interactionLanguage": "en",
  "artifactLanguage": "en",
  "codeDocumentationPolicy": "inherit-existing"
}
```

- `interactionLanguage` 控制提示和 CLI 人类可读输出，可以跟随用户。
- `artifactLanguage` 控制治理正文，独立于交互语言，默认 `en`。
- `codeDocumentationPolicy` 在既有项目默认 `inherit-existing`，新项目默认 `en`，除非用户覆盖。

所有模式下，JSON/YAML 字段名、ID、枚举、命令和文件名都保持英语。为兼容旧项目，现有 `bilingual` 配置继续有效，但不再作为推荐的引导默认值。未来如果生成翻译伴随文件，必须指定一种正典语言；翻译文件带 generated 标识和 hash，不进入默认上下文闭包。

### 技术栈

既有项目由扫描器展示检测到的语言、运行时、框架、基础设施、package 证据和置信度，用户确认或修正结果。流程跳过从零选型，但不能把检测结果静默视为负责人批准。

新项目由用户选择目标技术栈，AICG 只生成所选技术栈能力。只有实际请求对应 Skill 时才检索当前官方来源，不生成无关框架资料。

### 架构和公共能力

既有项目检查模块边界、依赖方向、公共 Client、Repository、Adapter、Guard、Policy、重复实现、测试和已记录业务不变量。发现分为：

- `verified-candidate`：代码和测试能够支持该声明；
- `needs-owner-confirmation`：实现存在，但目标契约不明确；
- `gap`：命名或弱证据不足以形成规则。

只有前两类进入批准预览；只有用户批准且有证据绑定的候选才能成为项目 Skill 或架构规则。

新项目的架构状态记录为 `not-established`。初始化器不能虚构分层和模块边界；等功能形成真实稳定模式后，再补充架构或项目 Skill。

### 预览与应用

写入前必须展示：

- 所选客户端和语言；
- 项目阶段和技术栈证据；
- 推荐档位和启用能力；
- 精确文件动作；
- 受管文件数、字节数和默认上下文估算；
- 哪些声明只是 `stated`、哪些 `reachable`、哪些计划成为 `enforced`；
- 所需 hook、CI、AI assist、网络权限或外部 provider 授权；
- planHash。

用户批准计划前不得写入。应用必须具备事务性，完成后统一执行一次完整性检查。

## 档位与产物预算

### Minimal：可信内核

适合单人、小仓库和首次采用治理。只包含配置、manifest、共享原生入口、正典索引、常驻不变量、必要的已选客户端 adapter 和一个完整性门禁。

默认不生成架构、技术规范、发布策略、acceptance contract/results、surface profiles/results、decision ledger、memory、task runtime、reviews/reports 占位目录、hook、CI 或 capability evolution 产物。

- Codex-only 目标：不超过 8 个受管文件。
- 首版硬门禁：不超过 10 个受管文件。
- 默认启动治理上下文：不超过约 1,200 tokens。

### Standard：项目路由与策略

在 Minimal 上增加 context map 和 verification profiles。架构、反模式、技术 Skill 和业务 Skill 只有存在仓库证据并经负责人确认才生成。release、surface 和正式 acceptance 产物首次使用时才物化。

- Standard 核心预算：不含条件性项目 Skill 和已选客户端 adapter 时，不超过 20 个受管文件。
- 普通任务初始上下文：不超过 900 tokens。
- 行为变更初始上下文：不超过 1,800 tokens。

### Complete：提供生命周期能力

Complete 表示生命周期治理可以使用，不表示所有可选功能立即物化。memory、长任务 runtime、hook、CI、外部工作流和额外 evidence 仍需分别选择。

只有用户明确选择，或存在多个负责人确认的信号时才推荐 Complete，例如长周期任务、高后果边界、多客户端团队、CI 强制或持续 capability promotion。

- Complete 核心预算：不含条件 Skill 和额外客户端 adapter 时，不超过 26 个受管文件。
- 普通任务和行为变更的启动预算与 Standard 相同。

用户只说“建立治理”时，根据扫描证据推荐 Minimal 或 Standard，绝不静默启用 Complete。

## 动态对话流程

### L0：直接回答

适用于只读解释、评审、发现和状态查询。

```text
理解问题 -> 读取最小证据 -> 直接回答
```

不生成设计、plan，不运行治理子进程，也不执行 harvest。

### L1：快速低风险修改

适用于局部修改，且不改变业务规则、公共 API/schema、权限、兼容性或外部副作用。

```text
定位 -> 只澄清实质歧义 -> 修改 -> 定向测试 -> 一次完成检查
```

不要求正式的用户批准 plan。发现新证据跨入 L2/L3 边界时，必须在扩大修改前停止并升级流程。

### L2：业务或中等影响变更

适用于改变产品行为、业务规则、状态流、公共契约或负责人确认的风险边界。

```text
理解当前行为
  -> 明确目标、规则、边界和验收
  -> 每次询问一个实质问题
  -> 用户确认需求
  -> 给出实施 plan
  -> 用户批准 plan
  -> 实现并验证
```

需求和计划都必须获得批准。

### L3：大型、跨端、架构或高后果变更

适用于多模块、多端、架构契约、迁移、兼容性工作或高后果行为。

```text
分析 -> 按需执行对抗性/多角色评审
  -> 逐项关闭需求缺口
  -> 用户批准需求与设计
  -> 拆分任务和依赖
  -> 用户批准执行计划
  -> 串行或并行实现
  -> 集成验证
```

只有任务边界清晰、输入输出契约已固定、文件所有权不重叠且可以独立测试时，才使用不同客户端或子 Agent 并行实现。前后端共享 API 必须先确定契约，再开始并行开发。

### 一句话需求与完整需求

“一句话需求”不是固定等级。已经足够明确时，立即重新分类到 L0–L3；不明确时才进入头脑风暴，每轮询问一个实质问题，形成经批准的需求摘要后，再按影响分类。

“完整需求”也不是固定等级。先检查矛盾、异常路径、权限和数据边界、不可验收描述与跨系统影响。只有达到 L3 范围或风险时才执行多角色对抗评审。

## 上下文 Profile

生成的根入口只保留：

1. 正典位置；
2. 选择最小 profile 的指引；
3. 作用域和用户改动保护；
4. generated adapter 的所有权边界；
5. 一个交付门禁入口。

常驻规则只保留跨任务不变量。架构细节、技术规范、harvest、hook、reviews/reports、acceptance 和 release policy 都不进入普通启动闭包。

建议 profile：

```yaml
base:
  required:
    - docs/ai/rules/00_always.mdc

profiles:
  ordinary:
    extends: base
    required: []

  behavior_change:
    extends: ordinary
    conditional:
      architecture: route-if-confirmed
      stack: route-one-or-two-matching-skills
      business: route-matching-owner-confirmed-skill

  release:
    extends: ordinary
    required:
      - docs/ai/release-acceptance-policy.json
```

同一任务中，正典内容按 canonical path 和 content hash 去重。客户端 adapter 解析到 canonical ID，不能造成第二次加载。

## 批准与打断规则

当答案会改变以下事项时，Agent 必须打断并提问：

- 产品行为或验收标准；
- 公共 API、schema、数据迁移或兼容性；
- 权限、支付、租户、敏感数据或外部副作用；
- 破坏性或不可逆操作；
- 用户指定范围；
- 架构所有权或所选工作流的权威归属；
- 部署、发布或外部消息。

以下情况不应打断用户：命名偏好、内部实现选择、格式或项目约定已覆盖的可逆低风险决定。

外部操作始终需要独立且精确的批准，即使实施 plan 已经批准。

## 能力收割与 Skill 成长

只有行为变更任务通过产品验证后，才有资格运行 harvest。候选必须包含：

- 稳定 capability ID；
- 已验证实现路径；
- owner 或明确的 owner gap；
- 公共入口或明确 gap；
- 当前测试或验证证据；
- 触发条件和相邻排除条件；
- 实现 fingerprint；
- 复核日期。

只读任务、纯文案修改、格式修改、测试 fixture、临时脚本以及没有公共能力变化的低风险修复都不运行 harvest。

候选必须先与现有 Skill 去重。没有通过既有 promotion 审批和真实项目命令验证的候选，不能成为 `adopted` 或 `enforced`。fingerprint 变化会使旧 promotion evidence 失效，并要求重新评审。

## 安全迁移

不能通过直接删减当前 builder 清单来开始产物精简。安全顺序是：

1. 在授予 stale-removal 权限前，校验 manifest 来源、schema、tool/template 来源、ownership、source path 和 hash；
2. sync 删除复用已有 execution plan 的 preimage 和 planHash 契约；
3. template v3 的普通 sync 保留所有历史产物；
4. 先从活动路由移除历史产物，再考虑物理清理；
5. seed 文件只作为人工清理候选报告；
6. 只有可信、完全受管、未修改且属于历史模板的产物才能自动 prune；
7. 先执行 `sync --prune --dry-run`，再执行 `sync --prune --approve <planHash>`；
8. 任何输入变化都使旧批准失效；
9. `--force` 不能代替或绕过 prune 批准；
10. 应用后运行正常 checker；验证失败时事务式恢复所有 preimage。

现有 release、acceptance 和 surface evidence 作为 dormant 历史保留。未选择的旧客户端 adapter 保留到用户显式 prune。既有项目保留原 invocation mode；只有新安装采用新默认值。

## 性能与行为预算

| 指标 | L0 普通任务 | L1 快速修改 | L2/L3 行为变更 | 发布 |
| --- | ---: | ---: | ---: | ---: |
| 初始唯一治理文件 | <= 3 | <= 3 | <= 5 | <= 5 |
| 初始治理 tokens | <= 900 | <= 900 | <= 1,800 | <= 3,000 |
| 单轮累计治理文件 | <= 3 | <= 5 | <= 8 | <= 8 |
| 治理子进程 | 0 | 1 | 默认 1 | 精确 2 |

机器预算：

- 小型 fixture 的 `check` p95 <= 250 ms；
- 1,000 文件 `check` p95 <= 300 ms；
- 10,000 文件 `check` p95 <= 1 秒；
- 路由计算 p95 <= 20 ms；
- 本地 `test:fast` p95 <= 5 秒；
- 完整回归只用于合并、发布或显式完整验证。

性能测试需要预热和重复采样，同时检查绝对上限和相对基线退化。文件数、字节数、上下文闭包、负向内容和进程数分别设门禁；运行速度快不能掩盖上下文膨胀。

## 测试策略

实现必须遵循测试驱动开发。

### 安装测试

- 第一个可见选择是客户端范围。
- 治理产物语言单独询问且默认英语。
- 交互语言不能静默覆盖治理产物语言。
- 中英文正文正确生成，ID 和 schema 字段保持稳定。
- 既有项目展示技术栈检测证据，并要求确认或修正。
- 新项目把架构记录为 `not-established`。

### 产物契约测试

- Minimal、Standard 和 Complete fixture 使用精确 allowlist。
- Minimal 不包含 release、surface、lifecycle、reviews/reports 占位项或未选择客户端。
- checker 和 generator 使用同一份产物选择结果。
- 超出上下文或产物预算时确定性失败。

### 路由测试

- 覆盖只读问答、README 修改、test-only、单文件 bugfix、业务行为、依赖升级、公共 API、权限/支付、跨端功能、明确发布，以及只讨论发布的场景。
- 实际 diff 出现生产变更时，必须升级，且不能复用较弱等级的 completion receipt。
- 多客户端 adapter 指向同一内容时，每个 canonical hash 只加载一次。
- L0 使用零治理子进程，L1/L2 符合对应进程数预算。

### Skill 成长测试

- 只读和不可复用改动不产生 harvest candidate。
- 创建新 Skill 前先尝试更新已有 Skill。
- 候选必须包含证据，且不能冒充 adopted。
- 实现漂移会使旧 fingerprint 和 promotion evidence 失效。

### 迁移与安全测试

- foreign、伪造、未来版本、unsafe path、symlink、CRLF 和用户编辑 fixture 按契约 fail closed 或保留内容。
- v1/v2 到 v3 的普通 sync 自动删除数为零。
- prune dry-run 不写文件，并展示全部动作和 planHash。
- 缺失、错误或过期批准必须非零退出，文件树和 manifest 字节完全不变。
- 注入 checker 故障后，事务回滚恢复文件、权限、链接、时间戳和 manifest。

### 测试套件分层

- `test:fast`：参数、安装引导、配置、选择器、artifact plan/apply、生成器、checker、路由策略、架构边界和技术规范。
- `test:full`：全部 Node 测试；至少一个版本内保留 `npm test` 作为兼容别名。
- `test:scenarios`：打包后的新项目、既有项目、迁移、回滚和跨客户端 fixture。
- `test:perf`：确定性的产物、上下文、路由和文件系统规模基准。

## 交付顺序

1. **D0 — 安全契约：**在允许缩减 allowlist 前，为所有 stale-removal/prune 路径增加可信 manifest 校验和 planHash 批准。
2. **D1 — 零删除上下文减负：**缩短根入口和常驻规则，把 release/harvest/standards 移出普通路由，保留全部历史产物。
3. **D2 — 安装决策与语言：**调整提问顺序，分离交互语言与产物语言，默认英语，确认既有栈，并记录新项目架构 gap。
4. **D3 — 能力与产物选择：**实现内部选择器、精确 preset allowlist、惰性 evidence 产物和选择驱动的 checker 期望。
5. **D4 — 动态任务路由：**生成路由策略和 profile，根据 diff 校验最低等级，并在不复制外部工作流正典的前提下强制批准边界。
6. **D5 — 本地执行与快速反馈：**新项目优先使用已验证的 project-local CLI，合并普通行为变更的完成链，并拆分 fast/full/scenario/performance 测试。
7. **D6 — 安全压缩历史项目：**提供 dry-run prune、精确批准、legacy retention 状态和回滚场景。
8. **D7 — 能力收割策略：**只对已验证行为变更收割，强制候选去重和证据，并检查 Skill 增长预算。
9. **D8 — 候选版本验证：**运行完整仓库验证、package smoke、新旧项目 fixture 和平台证据，不宣称未执行客户端或系统已验证。

每个交付单元必须能够独立测试和回滚。D0 是物理精简产物的前置条件。D1 只改变路由而不删除历史文件，因此可以先于 D2–D8 单独交付。

## 验收标准

- 新的引导安装先询问客户端范围，再询问治理产物语言。
- 新配置的 `artifactLanguage` 默认 `en`，且与交互语言相互独立。
- 旧双语配置继续可读，不被静默改写。
- 既有项目展示带证据的技术栈检测结果，并要求用户确认或修正。
- 新项目初始化不虚构架构或项目 Skill。
- 新建 Codex-only Minimal 项目不超过 10 个受管文件，且不包含 release、surface、lifecycle 或占位工作区产物。
- 普通启动链不加载 technical standards、capability evolution、harvest、hook、reviews/reports 或 release policy。
- L0 不运行治理子进程；L1 最多执行一次完成流程；L2/L3 执行规定批准；发布仍需精确的两阶段批准。
- 实际生产或高风险 diff 不能在较弱任务等级下完成。
- 只有独立、不重叠、契约固定且可单独测试的任务才建议多 Agent 执行。
- 不符合条件的任务不运行 harvest；任何候选都不能无证据、无批准晋升。
- 普通模板升级不删除文件；获批 prune 不能删除 seed、未知、漂移或不可信内容。
- 产物、上下文、路由、进程数、性能、迁移和回滚测试全部通过。
- 交付报告必须区分 `stated`、`reachable`、`enforced` 和真实客户端/平台证据。

## 已确定的语言边界

首批正式语言选择为英语或简体中文。已有 `bilingual` 值只作为兼容能力保留，不进入推荐的引导路径。任意语言生成推迟到中英文模板、上下文预算和 schema 稳定性测试完成之后。

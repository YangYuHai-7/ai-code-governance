# 评测 2026-09-16 DSH PK AICG 治理框架最终报告

## 执行汇总

- 评审对象：`adaptive-governance-flow`，HEAD `c4f6a99`。
- 对抗输入：DSH Desktop 会话“AI治理框架只读审查”的七项结论。
- 复核方式：架构与边界、效率与产品体验、测试与门禁三个独立视角，加主审源码裁决。
- 动态验证：纯内存路由与团队输出探针、`npm run test:fast`、默认 `npm run test:full`、隔离 `npm run test:perf`。
- 除本报告外未修改产品代码、配置或测试，未安装依赖，未联网。

## 最终结论

**当前 2026-09-15 自适应治理主体为“有条件通过”，2026-09-16 Skill 发现与动态 Agent 团队设计为“方向通过，但禁止按当前默认值直接实施”。**

DSH 的主要事实判断成立，但有三处需要校正：

1. “新能力 0% 实现”只适用于专用闭环，不能解释为底层能力为零。现有路由、Skill 生成、capability harvest、团队注册表和 planHash 可以复用。
2. AICG 内部 16 角色进入客户命令输出是实际的输出边界缺陷，但当前没有创建 Agent、写文件或授予权限。当前版本定为 P1，不是运行破坏型 P0；对新项目 AI 团队上线则是 stop-ship。
3. “新增产物必然让所有档位超预算”过于绝对。Standard 明确超出现有文件预算；Minimal 取决于是否生成适配器和 roster；Complete 可能刚好达上限。真正缺口是设计没有定义 preset、first-use 和加载预算矩阵。

本次复核还发现 DSH 未能验证的新事实：当前完整测试不是全绿。功能快速套件 213/213 通过，但性能门禁失败。

## DSH 七项结论裁决

| DSH 结论 | 最终裁决 | 当前严重度 | 新设计影响 |
| --- | --- | --- | --- |
| 9/15 自适应主体基本实现但仍有 P1 | 支持，但 P1 必须按当前 HEAD 重新列举，不能沿用旧快照 | P1 | 必须先建立可信基线 |
| 9/16 Skill 发现、动态 Agent、PK 为 0% | 专用闭环尚未实现；“0%”没有可审计分母，底层能力并非为零 | 非缺陷，属于待实现范围 | 不得把设计文档描述为现有能力 |
| `aicg team` 混入内部 16 角色，判 P0 | 事实成立，严重度过重 | P1 | stop-ship |
| 所有生产源码最低 L2，没有小修快速通道 | 对已识别生产源码成立；未知目录或未知扩展名不是语义全覆盖 | P2 | 与固定 2+1 PK 叠加后成为 stop-ship |
| L2/L3 批准没有机器强制 | 成立；`requiredApprovals` 没有消费方，漏填 task level 仍可 `ok:true` | P1 | 必须先定义批准证据，不一定复制计划正文 |
| 技术规范只是建议，不检查源码遵守 | 成立，但当前明确标记为 `stated`，没有伪装成 `enforced` | P2 能力缺口 | 只对可机器验证规则接 lint/test/checker |
| 新设计前先解决团队隔离、审批、小任务分流和授权 | 支持，其中团队隔离、授权状态机和 PK 触发是 stop-ship | — | 必须处理 |

## 实测证据

### 测试结果

- `npm run test:fast`：213/213 通过，约 6.67 秒。
- `npm run test:full`：540 项中 539 通过、1 失败；唯一失败为性能预算测试。
- 隔离 `npm run test:perf`：
  - routing p95：0.84 ms，预算 20 ms，通过；
  - small check p95：106.02 ms，预算 250 ms，通过；
  - 10k check p95：720.44 ms，预算 1000 ms，通过；
  - 50k check p95：2954.30 ms，仅观测、无硬门禁；
  - fast suite p95：6635.16 ms，预算 5000 ms，失败。

这说明实际治理检查快速路径没有显示出明显性能退化，但当前仓库自己的发布级性能契约是红色，不能宣称完整验证通过。

### 路由与批准

纯内存探针确认：

- `src/foo.ts`、`web/editor.tsx`、`ui/label.vue`、根目录 `index.js` 和 `main.py` 均为最低 L2；
- docs 和普通 tests 为 L1；
- 不声明 `task-level` 时状态为 `unverified-declaration`，但 completion 仍可 `ok:true`；
- `requiredApprovals` 只存在于分类输出、策略产物和测试，没有批准 receipt 的生产消费方。

因此，路由等级检测已实现，批准闭环没有实现。

### 团队边界

对 `teamScope: human` 的实际调用返回：

- 顶层 `teamType: human-delivery-and-governance`；
- 同一输出包含 `productTeam.availableRoles` 的 16 个 AICG 内部角色；
- 输入 `requiredCapabilities` 后会在 `productTeam` 中选择内部活跃角色；
- `actionsPerformed` 仍为空，没有写入或授权动作。

这是客户输出合同混杂，不是越权执行。新设计第 110 行要求三类团队隔离，第 423 行又要求保持当前 `aicg team` 实现不变，两者必须先统一。

### 产物与上下文预算

当前 Codex-only 空项目生成结果（含 manifest）：

| 档位 | 当前文件数 | 加两份正典 Skill 与 roster | 再加两份 Codex adapter | 当前硬上限 |
| --- | ---: | ---: | ---: | ---: |
| Minimal | 6 | 9 | 11 | 10 |
| Standard | 19 | 22 | 24 | 20 |
| Complete | 21 | 24 | 26 | 26 |

当前 ordinary 闭包均为 3 个文件，英文估算约 418–452 tokens。若把新设计约 800 tokens 的两个管理 Skill 默认加入 ordinary，总量约 1218–1252 tokens，会超过现有 900 token 上限；若完全按需加载则不一定冲突。

结论不是“禁止新增文件”，而是必须在实现前写清楚各档位的生成、适配、加载和 first-use 矩阵。

## 最终缺陷分级

### P0：当前运行版本

无证据证明当前版本存在破坏性写入、越权执行、数据泄漏或核心功能不可用，因此当前运行版本不列 P0。

### Stop-ship：阻止新 Skill/Agent 团队默认上线

1. **L2 路由与固定 2+1 PK 直接绑定。** 当前生产源码几乎都会进入 L2，导致注释、格式和局部可逆小修也承担独立提案、交叉质疑、裁决三阶段成本。
2. **三类团队没有输出隔离。** 人类团队建议、AICG 产品内部团队、客户项目 AI Agent 团队必须使用独立命令或独立 schema，不能继续共用当前混合输出。
3. **授权状态机只有文档。** `discovered -> recommended -> approved -> applied -> active-for-task` 必须有不可越级的机器检查、stale approval 失效和负向探针。
4. **preset 与上下文预算未闭合。** 在没有生成/适配/加载矩阵前，不得通过放宽现有预算测试掩盖新增默认产物。
5. **独立性能力未探测。** 不具备隔离会话时只能标记 `role-perspective-review / unverified`，不得输出“独立 PK”。

### P1：当前实现应修复

1. **`aicg team` 输出合同混杂。** 当前输出同时承载客户人类职责和 AICG 内部产品角色。虽无副作用，但会误导调用方并破坏新设计的团队隔离前提。
2. **completion 可在未声明任务等级时返回成功。** `unverified-declaration` 不应与生产源码变更下的 `ok:true` 同时出现；至少必须阻断或要求显式兼容确认。
3. **批准声明与完成门禁不一致。** 如果文档继续说 L2/L3 “需要批准”，就必须消费可验证批准证据；否则应明确写成 Agent 流程提示而非机器门禁。
4. **当前性能门禁失败。** CLI 检查预算通过，但 fast suite p95 超过硬上限，完整测试为 539/540。

### P2：能力边界与设计清理

1. 技术标准当前是诚实的 `stated` 建议；需要提供项目 lint、typecheck、test 或专用 checker 的可选映射，不能把所有散文规范假装成可执行规则。
2. Greenfield 同时记录 `architecture-not-established`，又启用 `module-first-new-code / active` 的未来布局政策。应把“现有架构证据”和“用户选择的未来政策”拆成两个状态。
3. 当前人类团队推荐没有明确最大推荐数；宽技术栈可能产生过多角色建议，应使用最小充分集合和用户可见上限。
4. token 预算采用字符数除以 4，是估算值；应保留边界说明，并在真实 Agent forward-test 中记录实际输入 token。

## 修订后的目标流程

### 1. 分离任务等级与评审编排

保留 L0–L3 作为风险与验证等级，新增独立的 `reviewMode`：

```text
single
quick-review
independent-pk
high-consequence-pk
```

评审模式由行为变化、公共契约、跨端、跨模块、高后果和不可逆证据决定，不能只由“路径属于 src”决定。

- 无业务/契约变化的局部生产修复：可以保持 L2 验证强度，但使用 `single` 或 `quick-review`，不强制 PK。
- 业务行为、公共契约或多模块变化：`independent-pk`。
- 跨端、外部动作、迁移、安全、支付、租户等：`high-consequence-pk`。

这样无需降低现有路径安全底线，也能避免小修被过度编排。

### 2. 明确档位与懒加载

- Minimal：不生成团队 roster，不生成两份管理 Skill 正文；只保留内核和可选 first-use 提示。
- Standard：生成轻量元数据索引；候选 Skill、角色说明和 PK 协议按需加载。
- Complete：只有用户逐项批准后才生成 roster、适配器和完整执行协议。
- `agentTeam.enabled` 默认应为 `false` 或 `pending-approval`。
- 旧项目首次 sync 只做预览，零写入、零删除。

### 3. 三类团队彻底分离

建议使用三个明确入口：

```text
aicg team              # 人类交付与治理职责建议
aicg product-team      # AICG 产品自身内部团队，仅开发 AICG 时使用
aicg agent-team        # 目标项目 AI Agent 团队
```

如果不新增命令，至少必须使用互斥 schema 和不同 `teamType`，禁止一个输出同时包含另外两类团队。

### 4. 最小批准证据

不复制需求、设计和计划正文，只记录可验证引用：

```json
{
  "taskId": "...",
  "taskLevel": "L2",
  "requiredApprovalIds": ["requirements", "plan"],
  "approvalEvidence": [
    { "id": "requirements", "source": "conversation-or-provider", "digest": "..." },
    { "id": "plan", "source": "conversation-or-provider", "digest": "..." }
  ],
  "planHash": "..."
}
```

内容 owner 仍可以是项目原生、OpenSpec 或客户端会话；AICG 只验证引用、摘要、当前 diff 和 freshness，不建立第二份计划正典。

### 5. 技术规范分层

- `stated`：只能指导 Agent；
- `reachable`：能被路由加载；
- `enforced`：有 lint/typecheck/test/checker 和失败探针；
- `verified`：本次真实运行通过。

只有能绑定真实命令或专用检查器的规则才允许升级为 `enforced`。

## 实施顺序

1. 修复 `aicg team` 输出隔离和设计文档第 110/423 行冲突。
2. 将 `taskLevel` 与 `reviewMode` 解耦，补小型生产修复用例。
3. 定义 preset、first-use、adapter 和上下文预算矩阵。
4. 实现 Skill 发现的只读元数据阶段与去重，不先实现安装。
5. 实现批准状态机、planHash、stale approval 和负向探针。
6. 实现项目 AI Agent 团队 schema 与最小角色选择。
7. 最后接独立 PK；先探测客户端隔离能力，不能隔离时诚实降级。
8. 运行真实 greenfield/brownfield、L0–L3 A/B，再决定是否默认启用。

## 上线验收条件

必须同时满足：

1. 普通局部生产小修不会仅因路径为 `src/**` 而强制 2+1 PK。
2. Minimal 和 Standard 默认 ordinary 闭包仍不超过 3 文件、900 估算 tokens。
3. 新产物不能通过简单放宽 6/19/21 基线或 10/20/26 上限来“通过”。
4. 未批准 Skill/角色不能进入 config、manifest、adapter 或 active task。
5. 来源、版本、权限或内容变化会使旧批准失效。
6. 无隔离 Agent 会话时不能标记 independent PK。
7. 人类团队、产品内部团队、项目 AI 团队的 schema 和输出互不包含。
8. `npm run test:full` 与隔离性能门禁真实通过。
9. A/B 记录总完成时长、累计 tokens、用户确认次数、隐藏验收、越界行为和返工次数。
10. L0/L1 不退化；L2/L3 的质量提升不能以未授权写入、安装或虚假独立性换取。

## 最终判断

当前框架已经有效控制了生成文件和普通上下文的膨胀，CLI 检查本身也足够快；它尚未满足“完整质量治理”，因为批准链、项目规范执行和测试全绿仍有缺口。

新 Skill/Agent 设计值得继续，但必须先把“风险等级”和“是否启动多人 PK”分开，并默认关闭团队落盘。否则它会把已解决的文件/上下文过度设计，替换成更隐蔽的流程过度设计。

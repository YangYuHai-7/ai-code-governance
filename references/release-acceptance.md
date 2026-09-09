# AICG 分级发布验收协议

本协议把“发布前要验证什么”变成与变更风险成比例、可机器拒绝的证据契约。质量底线不会因为改动小而降低；变化的是参与人数、测试范围和证据深度。

机器正典是 [`assets/policies/release-acceptance-policy.json`](../assets/policies/release-acceptance-policy.json)。发布证据建议保存在目标仓库的 `docs/ai/release-evidence/<version>.json`，引用的报告和日志也必须是仓库内普通文件，并且每个文件必须已被 Git 跟踪、与 HEAD blob 一致，便于审计、复现和后续退休。仅存在于工作树、被 `.gitignore` 忽略或未提交的证据不能通过。

`docs/ai/release-acceptance-policy.json` 是由 `aicg sync` 更新的受管基线快照；漂移或落后于当前 CLI 时，发布检查会提前要求审阅并同步。项目要收紧标准时，新增完整的 `docs/ai/release-acceptance-override.json`：可以增加风险信号、证据或提高人数/分数，但不能删除内置维度、降低分数、减少参与者、移除证据、改写基线语义或放宽风险升级；这种弱化会被 `release-check` 直接拒绝。override 不由生成器覆盖，并由最终证据的 policy hash 绑定。

## 统一质量评分

所有发布类型都使用同一张 100 分表：

| 维度 | 权重 | 验收重点 |
| --- | ---: | --- |
| 业务理解 | 15 | actor、资源 owner、状态、授权、事务、副作用、失败语义与未知 gap |
| 项目生命周期边界 | 10 | greenfield/brownfield/monorepo 判断；不越权迁移或重构 |
| 目录设计 | 10 | 领域模块、职责归属、入口和测试位置；不堆平铺业务文件 |
| 架构设计 | 15 | 依赖方向、低耦合、高内聚、事务/实时/Provider 边界和可演进性 |
| 代码设计 | 15 | 单一职责、契约、类型、错误语义、可测试性和不过度设计 |
| 封装与复用 | 10 | 复用正典 Client、Guard、Repository、Adapter 和公共入口 |
| 安全与可靠性 | 10 | 租户隔离、授权、防篡改、防重放、幂等、并发和审计 |
| Skill 质量与演进 | 10 | 细粒度路由、来源、业务 evidence、owner、查重和实现 fingerprint |
| 门禁效率与可用性 | 5 | 普通对话不跑完整门禁；提交/手动完成入口准确、快速、可修复 |

加权总分必须不低于 85。业务理解、架构、代码设计、安全四项至少 80；其他项至少 70。P0/P1 发现必须全部解决，不能用平均分或多数票掩盖。

## 三种基础发布类型

### Bug 修复：`bugfix` / patch

至少 1 名全栈工程师和 1 名独立架构师。必须证明：旧版本可稳定复现；回归测试修复前失败、修复后成功；受影响范围的测试/类型/lint/build 通过；没有搭车重构；真实治理门禁和包 smoke 通过；具备明确回滚方案。

Bug 修复不要求全产品回归，但只要实现者或独立架构师任一方把权限、租户、支付、敏感数据、迁移、公共契约或外部副作用列为风险信号，就会提升到 feature 级验收深度。

### 功能新增：`feature` / minor

至少 2 名全栈工程师和 2 名独立架构师。除了产品验证，还必须提交业务契约、目录与依赖评审、单元/集成/契约测试、定向负向探针、正典封装复用检查、capability evolution 结论、包 smoke 和回滚方案。

新增功能的验收重点是“第二个人是否会继续使用现有能力”。完成权限、统一 HTTP Client、Adapter、Repository 或领域流程后，必须更新已有 Skill、创建有证据的新 Skill、进入 candidate，或记录 `no-skill-with-reason`；不能默默跳过。

### 大版本：`major` / major

至少 5 名全栈工程师和 3 名架构师。工程师应在隔离环境中覆盖：greenfield、brownfield、业务高风险接口、实时/Provider 边界、公共封装和后续复用。三名架构师分别从业务/领域、应用/平台、安全/治理角度先盲审，再处理分歧。

大版本还必须覆盖两个结构不同的真实项目、对照实验、声明平台矩阵、升级/兼容/弃用/迁移、全部适用负向探针、真实 AI 客户端入口、安装后 smoke 和回滚演练。一个架构师提出的 P0 不得由另两人投票忽略。

## 风险升级

`riskSignals` 不改变版本号类别，但会提高验收深度。例如安全补丁仍可发布 patch，但必须满足 feature 证据和人数；`breaking-public-api` 或 `governance-schema` 必须使用 major 版本并执行 major 验收。当前协议只接受稳定 SemVer（可带 build metadata），不把 prerelease precedence 猜成 patch/minor/major；预发布流程需另行定义后再启用。

风险信号至少由实现者和独立架构师各判断一次。机器只能检查声明是否完整，不能证明操作者没有漏报风险。

## 5 + 3 对抗测试分工

| 执行者 | 主要场景 |
| --- | --- |
| 工程师 1 | greenfield 初始化、目录规划和代表性功能实现 |
| 工程师 2 | brownfield 保护、增量架构和兼容行为 |
| 工程师 3 | 当前栈的高风险业务边界、安全、事务与幂等 |
| 工程师 4 | 跨模块/Provider/事件边界、失败恢复和资源生命周期 |
| 工程师 5 | 公共封装复用、升级兼容和 Skill 演进 |
| 架构师 1 | 业务与领域模型、模块 owner、状态和不变量 |
| 架构师 2 | 分层、依赖、封装、数据/实时/基础设施边界 |
| 架构师 3 | 安全威胁、门禁真实性、负向探针、效率和剩余风险 |

这些是跨技术栈的正交评测席，不把 React、NestJS 或其他框架写死为通用规则；具体任务由项目 capability packs、风险信号和发布范围展开。初次评分前不得由小组共同修正输出。每个参与者的 `scorecard` 必须是独立结构化 JSON，并绑定同一 candidate/policy hash；之后才能进行共识评审。工程师通过状态和架构师批准状态只证明各自场景，不替代机器测试。

## 一票否决项

- 编造业务角色、租户、状态或权限不变量；
- 未授权重构遗留代码、换栈或移动目录；
- 跨租户越权、权限提升、重放、篡改或不可恢复的数据半状态；
- 重新创建已有正典 Client、Guard、Repository 或 Adapter；
- 写入不存在或未执行的验证命令并声称成功；
- 门禁从未通过定向负向失败与修复后恢复；
- 覆盖用户文件、自动暂存或静默改变发布/CI 权限；
- 普通对话重复运行完整门禁；
- Skill/实现已漂移却继续标记为 `adopted`、`enforced` 或 current。

## 部署前入口

```bash
aicg release-check . --type feature --evidence docs/ai/release-evidence/1.3.0.json --json
# Review replayPlan.commands, including exact commandText and commandSha256.
aicg release-check . --type feature --evidence docs/ai/release-evidence/1.3.0.json \
  --replay --approve <replayPlan.planHash>
```

聊天入口使用精确短语“检查发布验收”，并通过 `--config` 提供：

```json
{
  "releaseAcceptance": {
    "changeType": "feature",
    "evidencePath": "docs/ai/release-evidence/1.3.0.json",
    "replayCommands": true
  }
}
```

聊天调用第一次不带 `--approve` 时只预检并返回 plan；确认后用相同请求加 `--approve <replayPlan.planHash>`。`replayCommands: true` 本身不是执行授权。

发布采用“两次提交”模型：先提交代码形成 `candidate.releaseRevision`，独立评审全部绑定该 commit 与 tree；再把报告和 receipts 提交到 `docs/ai/release-evidence/`。当前 HEAD 相对 candidate 只能增加或修改该证据目录，且工作树/index 必须干净。根 evidence、scorecard、receipt、subject、项目 policy/override 与参与重放的 `package.json` 都必须被 Git 跟踪并与 HEAD 一致。任何代码、策略或打包文件在评审后改变，旧证据立即失效。

证据文件至少包含 `schemaVersion`、前后版本、发布单元、版本权威、Git candidate、策略 ID/hash、生成/共识时间、实现作者、双人风险评估、参与者、发现和必选证据。版本权威可以是目标发布单元的仓库内 `package.json`，也可以是分别解析到 base/candidate 的 `1.2.3`/`v1.2.3` 风格 Git tags，因而不把整个协议限制为 Node 根包。总分不由根文件自填；检查器读取每个独立 scorecard，对各维度采用所有评审者最低分，再执行阈值检查。每个参与者 scorecard 与每项 evidence receipt 都必须是仓库内、互不复用的普通 JSON 文件；软链接、硬链接、相同内容、越界路径和空占位文件都会失败。

根文件形状如下；示例为节选，不足以通过 feature 验收：

```json
{
  "schemaVersion": 1,
  "changeType": "feature",
  "previousVersion": "1.2.4",
  "releaseVersion": "1.3.0",
  "releaseUnit": { "type": "npm-package", "packagePath": "package.json" },
  "versionAuthority": { "type": "package-json", "path": "package.json" },
  "candidate": {
    "baseRevision": "1111111111111111111111111111111111111111",
    "releaseRevision": "2222222222222222222222222222222222222222",
    "releaseTree": "3333333333333333333333333333333333333333"
  },
  "policy": {
    "id": "aicg-release-acceptance-v1",
    "sha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
  },
  "generatedAt": "2026-09-09T00:05:00.000Z",
  "consensusAt": "2026-09-09T00:04:00.000Z",
  "implementationAuthors": ["author-1"],
  "riskSignals": ["authorization"],
  "riskAssessments": [
    {
      "role": "implementer",
      "reviewerId": "author-1",
      "candidateRevision": "2222222222222222222222222222222222222222",
      "candidateTree": "3333333333333333333333333333333333333333",
      "policySha256": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      "submittedAt": "2026-09-09T00:02:00.000Z",
      "signals": ["authorization"],
      "rationale": "Authorization behavior changed."
    }
  ],
  "participants": {
    "engineers": [
      {
        "id": "engineer-1",
        "scorecard": "docs/ai/release-evidence/reviews/engineer-1.json"
      }
    ],
    "architects": [
      {
        "id": "architect-1",
        "scorecard": "docs/ai/release-evidence/reviews/architect-1.json"
      }
    ]
  },
  "findings": [],
  "evidence": [
    {
      "id": "scope-boundary",
      "status": "passed",
      "reference": "docs/ai/release-evidence/receipts/scope-boundary.json"
    }
  ]
}
```

每个 scorecard 还必须包含 `participantId`、`role`、`independent`、`verdict`、候选与策略绑定、`submittedAt`、九维 `scores`、`findings`，以及工程师 `primaryScenario` 或架构师 `primaryLens`。每个 receipt 必须包含匹配的 `evidenceId`、候选与策略绑定、`recordedAt`，以及带 `mode`、`outcome`、`summary`、起止时间、subject 路径/hash 的 `verification`；允许的 mode 由 policy 中该 evidence ID 决定，不能用 prose review 冒充测试、smoke 或负向探针。

根证据还必须声明 `releaseUnit`。当前执行器支持 `type: npm-package`，所有 command/probe 的 `packagePath` 必须与该发布单元一致；使用 package-json 版本权威时，两者路径也必须一致。这样 monorepo 的嵌套包可以被明确验收，但结果只代表声明的发布单元。AICG 自身的 npm publication 模式固定要求根 `package.json`，不能转向嵌套测试包。

`command` verification 必须声明 `runner: npm-script`、真实 `package.json` 路径、script、预期 `exitCode: 0` 以及 stdout/stderr SHA-256。`probe` 必须声明相同 runner/packagePath，并提供严格且保持顺序的两个 steps：先是预期非零的 `failure`，再是预期为零的 `recovery`；每步都要记录 script、exitCode 和两个输出 digest。检查器拒绝伪 JSON、install/publish 生命周期和任何隐式 `pre<script>`/`post<script>`，将发布单元、预检 HEAD、candidate 中精确脚本文本及 hash 放入 `replayPlan`。只有在所有非执行校验均通过且 `--approve` 精确匹配 plan hash 时才会执行，真实退出码与输出 digest 必须逐项匹配；执行后再次验证 preflight HEAD 完全不变、全部已验证 evidence artifact hash 不变、candidate 与 clean worktree，并在 npm publication 模式重算最终包指纹。P0/P1 标为 resolved 时还必须提供同样绑定且可重放的 `resolutionReference`；个人报告中的发现必须无损进入根 `findings`。

对于 AICG 自身的 npm 发布，`prepublishOnly` 要求 `AICG_RELEASE_TYPE`、`AICG_RELEASE_EVIDENCE` 和预先审阅的 `AICG_RELEASE_APPROVAL`，然后执行相同的 `release-check`，并额外用 `npm pack --dry-run --ignore-scripts --json` 重新计算发布包的 filename、shasum、integrity 和 entryCount，与根证据的 `packageArtifact` 比对。证据目录不进入 npm `files` 清单，因此可在 candidate 之后记录 digest 而不形成循环。没有达到对应级别的证据时，发布必须在访问 npm registry 之前停止。

## 结果解释

`release-check` 证明 Git candidate、policy hash、结构化 evidence contract、评审席分离声明、最低评分、版本分类、双人风险并集、必选 receipt、阻断缺陷与已批准的本地命令重放符合策略。它不能认证真人身份，也不读取自然语言报告来判断架构结论是否正确；若实现者与独立架构师同时漏报语义风险，机器仍无法补全。npm script 仍是操作者批准的项目代码，AICG 不提供操作系统或网络沙箱；有外部副作用风险的命令必须在一次性、最小权限、网络受限的 CI runner 中执行。所有结论继续区分 `present`、`reachable`、`enforced` 和 `real-client-verified`。

# 项目能力自动提取与 Skill 升级协议

本协议让已经落地的治理框架随着产品代码一起进化。它捕获的不只是失败和事故，也捕获成功完成、经过验证、值得复用的项目能力：权限模型、HTTP Client、存储适配器、领域工作流、事务模式、第三方集成封装等。

目标不是“每完成一个功能就新增一篇文档”，而是让后续 AI 和开发者优先使用项目当前的正典能力，不再绕过封装、重新实现或复制旧写法。

## 自动升级的定义

“自动”表示治理框架在每次有行为变化的任务完成前自动执行能力收割（harvest），不等待用户再次说“提取 Skill”：

```text
实现完成 → 产品验证通过 → 扫描当前 change set
→ 识别可复用能力 → 查重并决定 create/update/no-op/candidate
→ 生成或升级 Skill → 更新路由/能力目录/知识 owner
→ 运行负向探针与现实请求 → 写入 harvest receipt → 才能 complete
```

自动升级不授权隐式重构、发布、安装 hook、修改 CI/CD 或改变公共 API。若能力边界仍不稳定，框架自动记录有 owner 和复核日期的候选，而不是把猜测晋升为规范。

### 两段式实现，不伪装成后台魔法

能力提取同时需要确定性机器层和语义判断层：

1. **机器 prepare/finalize**：解析受管 product change set、计算 fingerprint、发现 owning path/public export 漂移、校验 registry/receipt schema，并在遗漏时阻止 delivery/complete。
2. **当前 AI 任务执行者**：阅读真实实现和测试，完成查重、分类、Skill 内容生成或升级、routing forward-test，并提交结构化结论给 finalize。

没有正在执行的 AI Agent 时，普通 Git/CI gate 只负责发现“本次变化尚未 harvest”并失败，不能假装一个本地脚本理解了业务语义。若团队要在 CI 中调用外部模型自动生成，属于新增外部服务、成本和权限，必须单独获得用户授权。

### 避免 harvest 自己让 receipt 永远过期

至少分开两个指纹：

- `product_change_fingerprint`：源码、配置、migration、测试等受管产品路径；harvest 之后这些路径再次变化会使 receipt 失效。
- `governance_output_fingerprint`：本次生成/升级的 Skill、registry、profile、routing、memory 与 evidence；finalize 在所有治理输出写完后计算并写入 receipt。

harvest 自己写 `docs/ai/` 不应递归制造新的 product change；但人工在 finalize 后修改治理输出，会让 output fingerprint 不匹配并失败。受管路径必须由目标仓库显式配置，不能靠隐藏的全仓通配猜测。

## 1. 何时触发能力收割

完整档把 harvest 作为 L9 专用 complete 入口的前置步骤；标准档在 delivery gate 前执行等价命令。L10 hook 可以提示或收集 change set，但不能成为唯一入口。

满足任一信号即必须评估：

- 新增或实质修改共享 export、client、adapter、provider、repository、guard、policy engine、middleware、SDK wrapper；
- 完成认证、权限、租户隔离、幂等、事务、outbox、webhook、实时消息或媒体授权等高后果能力；
- 同一实现出现第二个消费者，或任务明确声明它是团队正典入口；
- 替换、弃用或升级已有项目封装；
- 新增一段后续任务必须遵循、且仅读框架官方文档无法知道的项目写法；
- 现有 Skill 的 owning implementation path、public export、错误语义或验证命令发生变化。

纯重命名、格式化、测试数据、一次性页面细节、单个业务字段和可以完全由类型/lint/生成器表达的约束通常不生成 Skill，但仍要留下本次已评估的 receipt。

## 2. 识别四类结果

| 结果 | 何时选择 | 动作 |
| --- | --- | --- |
| `update-existing` | 已有 Skill 描述同一稳定 capability | 原地升级 Skill 和证据，不建立平行 Skill |
| `create-new` | 新能力有稳定 owner、正典实现和明确复用入口 | 创建细粒度 Skill 并接入 profile/catalog |
| `candidate` | 有复用价值，但接口、owner、测试或业务不变量尚未稳定 | 写入候选队列，记录缺口和复核日期 |
| `no-skill` | 一次性实现、显而易见代码或更适合机器工具 | receipt 记录理由，不制造文档噪音 |

默认先查重再创建。查重不能只比文件名，要比稳定 capability ID、别名、owning paths、public exports、领域动词和 routing examples。

## 3. 自动晋升判据

下列条件全部成立时可以自动 `create-new` 或 `update-existing`：

1. **真实实现已存在**：有明确 owning path 和 public/canonical entrypoint，不是计划或伪代码。
2. **行为已验证**：本次运行过真实 lint/typecheck/test/integration/build 中适用的门禁，并绑定当前 `product_change_fingerprint`。
3. **可复用边界明确**：至少已有一个真实消费者，或用户/ADR/模块导出明确声明它是未来调用的唯一正典入口。
4. **非显然项目知识存在**：后续调用者必须知道认证、错误、重试、事务、状态、租户、序列化或生命周期中的至少一个项目决定。
5. **owner 与验证存在**：能写出维护 owner、验证命令和最小现实使用例。
6. **不重复**：没有已有 Skill 能通过原地升级覆盖同一能力。

权限、安全、支付、跨租户、不可逆副作用和公共平台封装属于高后果能力：一次成功实现即可进入自动晋升评估，不要求先重复两次。普通局部 helper 默认先进入 candidate，直到出现复用证据。

## 4. 能力演进注册表

完整/标准档生成 `docs/ai/capability-evolution.json`。每个 capability 使用稳定 ID；文件路径和 Skill 名称可以变化，ID 不变：

```json
{
  "schema_version": 1,
  "last_harvest": {
    "product_change_fingerprint": "<git-or-ledger-product-fingerprint>",
    "governance_output_fingerprint": "<generated-governance-fingerprint>",
    "status": "complete",
    "receipt": "docs/ai/evidence/skill-harvest-<fingerprint>.json"
  },
  "capabilities": [
    {
      "id": "platform-http-client",
      "kind": "platform-adapter",
      "status": "adopted",
      "owner": "platform",
      "aliases": ["axios-wrapper", "api-client"],
      "implementation_paths": ["packages/http-client/src/**"],
      "public_entrypoints": ["@project/http-client"],
      "consumer_paths": ["apps/web/src/**"],
      "verification": ["pnpm test:http-client"],
      "skill": "docs/ai/skills/use-project-http-client/SKILL.md",
      "profiles": ["frontend-development", "api-integration"],
      "capability_version": 2,
      "implementation_fingerprint": "<content-fingerprint>",
      "verified_at_commit": "<commit-or-uncommitted-fingerprint>",
      "supersedes": [],
      "evidence_ids": ["impl-http-client", "test-http-client"]
    }
  ]
}
```

允许状态：`candidate`、`adopted`、`superseded`、`retired`。`capability_version` 只在调用契约或必须加载的指导发生实质变化时递增；排版和措辞调整不递增。历史交给 Git，Skill 只描述当前正确写法。

## 5. 单次 harvest receipt

每个被评估的 product change fingerprint 恰好对应一个 receipt，至少包含：

- `product_change_fingerprint`、`governance_output_fingerprint`、`evaluated_at`、`changed_product_paths`；
- 发现的稳定 ID、分类结果和理由；
- 创建/升级/候选/no-skill 的目标路径；
- 产品门禁证据与 Skill forward-test 证据；
- catalog、profile、routing、memory、skill-map 的同步结果；
- 剩余 gap 和 owner。

产品代码在 receipt 后再次变化，receipt 立即过期；harvest 输出被人工修改则 output fingerprint 失配。不能拿旧任务的 harvest 证明当前实现已经被吸收。

## 6. 生成或升级 Skill

优先升级已有 Skill。一个 adopted capability 的 Skill 必须包含：

1. 稳定 capability ID、owner、当前版本和 owning implementation paths；
2. 何时使用该正典入口，以及何时不适用；
3. 最小 public entrypoint 与真实 import/call 形状；
4. 认证、授权、租户、错误、重试、超时、事务、缓存或生命周期中的适用项目决定；
5. 禁止的旁路实现及其具体风险；
6. 项目真实验证命令和代表性测试；
7. 适用 profiles、routing examples 和相邻 Skill；
8. implementation fingerprint 或注册表链接，证明 Skill 对应当前实现。

Skill 不复制整份源码。它教调用者如何找到并正确复用正典实现；实现细节仍由代码、类型和测试负责。

## 7. 两个典型场景

### 权限功能完成

当项目完成统一权限能力后，harvest 应识别 policy/guard/service enforcement、角色与资源 owner、跨租户边界、拒绝语义和测试：

- 平台 Skill：`authorize-project-operation`，说明必须调用哪个 policy service/guard，禁止 controller-only 或 UI-only 权限；
- 业务 Skill：若“邀请成员”“修改角色”等用例有稳定业务不变量，升级对应业务动词 Skill；
- 路由：所有新增写接口和高风险操作 profile 必达权限 Skill；
- 漂移：权限正典实现变化但 Skill、测试证据或 fingerprint 未更新时，delivery gate 失败。

### Axios 被项目封装

当项目建立统一 Axios/HTTP Client 后，harvest 应生成或升级 `use-project-http-client`：

- 唯一 import/public entrypoint；
- base URL、认证/session、CSRF、错误归一化、超时、取消、trace/request id 和允许的 retry 语义；
- browser 与 server client 的边界；
- 禁止业务代码再次 `axios.create()` 或直接从 `axios` import 的适用目录；
- wrapper 测试和一个真实 consumer 的 forward-test。

只有项目声明正典 wrapper 后才能启用“禁止 raw Axios”的机器检查；在迁移期使用 allowlist 和 owner，不一次性把遗留调用伪装成已治理。

## 8. 漂移、旁路与替换

目标项目的 delivery gate 至少检查：

- `implementation_paths` 或 `public_entrypoints` 变化时，对应 Skill/registry/receipt 是否同步；
- adopted capability 的 Skill、profile、catalog 和 routing examples 是否仍可达；
- 新代码是否绕过声明为唯一正典的 adapter/client/policy；
- 新 capability 是否与已有稳定 ID、别名或 owning path 重叠；
- superseded Skill 是否从默认路由移除，并把消费者指向替代 capability；
- 无法确定是否影响契约时，状态是否降为 `needs-review` / candidate，而不是静默保持 current。

旁路检查必须限定到声明的 governed paths，并支持有理由、可审计、限时的迁移 allowlist。不要用全仓 regex 误伤测试 fixture、adapter 自身和迁移代码。

## 9. 必须证明会失败

新增以下条件探针：

| ID | 负向场景 | 证明 |
| --- | --- | --- |
| `feature-skill-harvest-freshness` | 完成可复用功能后缺少 receipt，或代码变化后复用旧 receipt | 每个行为 change set 都被当前 harvest 评估 |
| `capability-promotion-evidence` | adopted capability 缺 owner、正典入口、真实测试或 consumer/明确复用决定 | 自动升级不会把猜测变成规范 |
| `skill-implementation-drift` | 修改 owning implementation/public export，却不升级 Skill/fingerprint | Skill 描述的是当前实现 |
| `canonical-capability-reuse` | 在 governed path 绕过项目 HTTP Client、权限 service 等正典入口 | 后续代码会复用项目能力而不是重新造轮子 |

每个探针必须触发目标项目的真实 structure/delivery/complete 入口并记录恢复证据。只检查本协议里出现了这些单词，不等于目标项目已实现自动升级。

## 10. 完成语义

完成一个有行为变化的任务时，允许的 harvest 结论只有：

- `updated-existing`：已有 Skill 已随实现升级；
- `created-new`：新 Skill 已生成、接线并验证；
- `candidate-recorded`：证据不足，候选已记录 owner/gap/review date；
- `no-skill-with-reason`：本次变化不值得进入 Skill，理由可审计；
- `not-applicable`：没有产品代码行为变化。

“忘了看”“以后再补”“文件太多”不是合法结论。自动升级闭环不是要求 Skill 数量持续增长，而是要求每次行为变化都被评估，并让当前正典能力优先于重新实现。

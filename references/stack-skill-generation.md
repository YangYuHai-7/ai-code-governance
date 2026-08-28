# 技术栈标准与业务写法 Skill 生成协议

本协议用于把“用户选了什么技术”和“这个产品怎么运作”转换成一组可直接指导编码的项目级 skills。它不保存一份永远不变的最佳实践清单；它规定如何找到当前标准、判断是否适用、生成什么粒度的 skill，以及如何证明生成物可达且没有误导。

## 双证据模型

每条指导先归类，不能混写来源：

| 证据轨 | 可产生什么 | 首选来源 | 不能产生什么 |
| --- | --- | --- | --- |
| 技术标准 | 框架惯用法、API 边界、生命周期、无障碍、安全、测试与工具链写法 | 当前版本官方文档、语言/协议标准、框架维护者指南、权威安全标准 | 项目独有角色、业务状态机、团队未经确认的架构 |
| 项目业务 | 领域不变量、租户/权限、状态转换、外部副作用、错误语义、DTO 与模块 owner | 用户决策、需求、代码、测试、ADR、事故与 Git 历史 | 与项目无关的通用教程或猜测的未来需求 |

技术标准是合法的外部证据，可以直接生成项目级编码 skill；但必须先确认版本与项目兼容。业务写法必须由项目证据支持，greenfield 可由用户明确的业务描述和架构决定作为来源。

## 1. 建立栈清单

按 package/module 记录，而不是只写“前端/后端”：

- 语言与运行时版本；
- 框架、元框架、UI、ORM、数据库、消息、媒体、任务队列；
- 测试、类型检查、lint、格式化、构建与部署适配器；
- 调用方类型：browser、mobile、server、provider/webhook、worker；
- 来源：manifest/lockfile/config/用户确认；
- 证据状态：`detected`、`user-confirmed`、`conflicting` 或 `unknown-version`；
- 采用状态：`required`、`conditional`、`deferred` 或 `rejected`。`conditional` / `deferred` 还要记录 `activation_threshold` 与 `decision_source`。

Greenfield 以用户确认的选型为事实；brownfield 以 lockfile、配置和实际 import 为当前事实。未知版本不得阻止生成所有能力，但涉及版本差异的写法必须标 `unverified` 或先补证据。`conditional` 表示达到明确阈值后启用，`deferred` 表示已知候选但当前不进入能力覆盖；两者都不能被 `stack-skill-coverage` 误判为缺少 required skill。

## 2. 检索当前开发标准

技术栈已识别后，必须进行当前资料检索；软件框架会变化，不得只依赖模型记忆。

来源优先级：

1. 目标版本的官方文档、迁移指南和维护者仓库；
2. 语言、HTTP、SQL、OAuth、可访问性等正式标准；
3. OWASP 等权威安全基线；
4. 官方维护者认可的 style guide、reference application 或 RFC；
5. 多个成熟项目一致采用的社区模式，仅作为补充。

检索时针对“编码决策”而不是搜索宽泛的 “best practices”。示例：

- React：组件纯度、状态 owner、Effect 边界、表单、可访问性；
- NestJS/Fastify：module/export、Controller/DTO、Guard、raw body、异常映射；
- PostgreSQL/Drizzle：约束、事务、并发、query shape、migration；
- Socket.IO：授权 room、事件版本、重复/乱序、重连恢复；
- LiveKit：token scope、控制面/媒体面、Webhook 生命周期；
- Redis/BullMQ：引入阈值、job identity、retry、业务幂等。

每个采用的来源记录：

```json
{
  "id": "src-react-state-ownership",
  "technology": "React",
  "detected_version": "19.x",
  "topic": "state ownership",
  "url": "https://react.dev/learn/choosing-the-state-structure",
  "publisher": "React",
  "retrieved_at": "YYYY-MM-DD",
  "applies_to": ["frontend-development"],
  "decision": "adopted",
  "notes": "Compatible with the selected client-state model."
}
```

完整/标准档必须把来源保存为 `docs/ai/stack-sources.json`，并为每条来源分配稳定、唯一的 `id`。Skill 覆盖清单用 `source_ids` 引用这些 ID；`topic` 只用于检索和阅读，不能代替稳定关联。来源只证明技术写法；项目仍需通过自己的测试和门禁。

## 3. 处理冲突与过时

- 仓库已实现行为与新官方建议冲突：brownfield 先记录当前事实；除非用户批准迁移，不把治理变成隐式重构。
- 官方文档与博客冲突：采用目标版本官方文档。
- 两个官方来源适用于不同版本：以 lockfile/用户确认版本分流 skill，或标明迁移前后边界。
- 没有权威来源：至少交叉验证两个独立成熟来源，并把结论标 `community-consensus` / `unverified`。
- 安全、法律、支付、认证等高风险主题：使用当前权威来源并保留剩余风险，不以“主流写法”代替威胁建模。
- 来源内容更新但项目尚未复核：skill 保持可见，证据状态降为 `refresh-due`，不静默宣称 current。

## 4. 生成 Skill 矩阵

不要给每个框架只生成一个巨型 skill。按开发者能直接提出的任务拆分：

### A. 栈基础 Skills

围绕真实编码动作，例如：

- `write-react-function-component`
- `place-react-code`
- `manage-react-state`
- `build-mantine-form`
- `implement-nestjs-endpoint`
- `authorize-nestjs-request`
- `implement-drizzle-repository`
- `change-postgres-schema`
- `implement-socketio-business-events`

### B. 横切质量 Skills

覆盖多个栈但仍有明确任务边界，例如：

- `review-module-boundaries`：评审低耦合、高内聚和单一职责；
- `design-idempotent-command`：设计幂等命令、并发控制与 outbox；
- `secure-high-risk-interface`：保护高风险接口、防篡改与防重放；
- `design-error-observability`：设计错误语义、日志/审计和测试矩阵；
- `evaluate-infrastructure-need`：判断何时引入缓存、队列、抽象或新服务，避免过度设计。

重要接口先按调用方分类，再生成写法，不能套同一种安全模板：

至少把下列操作列为高风险候选并进行威胁分级：权限提升或角色变更、一次性授权、secret/token 签发、跨租户写入、关键状态迁移、不可逆外部副作用、支付/资金、管理面操作和 provider webhook。项目可以基于证据增加或降级，但必须记录理由。

| 调用方 | 防篡改/防重放基线 | 必须分开的责任 |
| --- | --- | --- |
| Browser/mobile user | TLS、认证会话、短期一次性 transaction/intent、服务端绑定 actor/resource/action/expiry、原子消费 | CSRF/Origin、授权、幂等与重放防护分别验证；客户端不能保管服务端共享密钥 |
| Server-to-server / webhook | raw-body 签名、key id/rotation、timestamp window、nonce/event id 原子去重、恒定时间比较 | 先验签再解析；验签不替代授权，nonce 不替代业务幂等 |
| Internal worker/event | authenticated channel、message identity、consumer inbox/dedup、业务状态前置条件 | 至少一次投递、重复/乱序与业务事务分别处理 |

安全 skill 必须记录威胁、调用方、签名覆盖的规范字节、时间窗、nonce 存储与原子性、失败语义、审计字段和并发测试；不能只写“加 HMAC”或“使用幂等键”。

### C. 业务写法 Skills

先枚举高频用例和高后果边界，再生成以业务动词命名的 skill，例如：

- `create-workspace-member`
- `send-channel-message`
- `confirm-meeting-schedule`
- `issue-livekit-room-token`
- `process-provider-webhook`

业务 skill 不复制全部框架规则，而是组合项目不变量：

```text
actor → workspace/resource authorization → state/revision
→ application transaction → business write + outbox
→ commit → async provider/realtime hint
→ idempotent retry/recovery
```

只有用户需求、领域文档、代码或测试能证明该用例时才生成；未知字段和角色写成开放问题，不补想象。

## 5. 单个 Skill 的质量契约

每个生成的 `SKILL.md` 必须包含：

1. 可区分的 `name` 与 `description`：说明何时触发，以及相邻任务何时不触发。
2. **加载条件**：所属 profile、项目规则、其他必要 skills。
3. **决策边界**：开始编码前必须固定的 actor、owner、输入、状态、事务、副作用或 UI state。
4. **项目标准写法**：目录/依赖方向、控制流或数据流，使用项目真实术语。
5. **窄代码形状**：足够说明接口和责任，不复制整篇官方教程，不制造不可运行的完整应用。
6. **禁止与例外**：只禁止有具体风险的模式；例外说明证据和复核点。
7. **验证矩阵**：使用项目真实命令；命令不存在时标 `not yet verified`。
8. **来源与适用版本**：链接 `stack-sources.json` 或列出少量直接官方依据。
9. **证据边界**：区分 `industry-standard`、`project-decision`、`business-invariant` 与 `unverified`。

一个 skill 应解决一个可识别任务或一组不可分割的决策。若 description 需要连续列举很多互不相关的“以及”，继续拆分；若两个 skills 总是同时加载且不能独立验收，应合并。

## 6. 生成项目覆盖清单

完整/标准档必须生成 `docs/ai/stack-skill-map.json`，至少记录：

```json
{
  "selected_stack": [
    {
      "id": "bullmq",
      "version": "unknown",
      "evidence_status": "user-confirmed",
      "adoption": "conditional",
      "activation_threshold": "Introduce when durable background retries or measured queue load require it.",
      "decision_source": "docs/DECISIONS.md"
    }
  ],
  "quality_principles": [],
  "capabilities": [
    {
      "id": "backend-http-endpoint",
      "technology": "NestJS + Fastify",
      "skill": "docs/ai/skills/implement-nestjs-endpoint/SKILL.md",
      "profiles": ["backend-development"],
      "source_ids": ["src-nest-controller", "src-nest-validation", "src-fastify-errors"],
      "adoption": "required"
    }
  ],
  "business_capabilities": [
    {
      "id": "meeting-confirmation",
      "owner": "meetings-module",
      "evidence_ids": ["biz-meeting-confirmation"],
      "skill": "docs/ai/skills/confirm-meeting-schedule/SKILL.md",
      "profiles": ["calendar-meetings"],
      "status": "adopted"
    }
  ]
}
```

这里的 `required` 表示治理能力必须存在且从声明 profile 可达，不表示每个任务无条件加载。`conditional` / `deferred` 组件必须保留引入阈值和决策来源，但在激活前不强制生成实现 skill；一旦状态升为 `required`，覆盖门禁立即生效。业务 capability 的 `owner`、`evidence_ids` 与 `status` 都是机器必填字段。

## 7. 路由与验证

交付前必须证明：

- 每个采用状态为 `required` 的技术组件至少映射到一个实现 skill；`conditional` / `deferred` 组件有阈值和决策来源；高频编码决策有细粒度 skills，而不是全部塞进 umbrella。
- 每个业务 skill 有真实业务证据和 owner；不存在“看技术名猜业务”的 skill。
- 所有 skills 在能力目录可发现，并从至少一个 profile 的 required/optional 到达。
- 设计质量策略从所有会产出代码的 profile 必达。
- routing examples 覆盖栈名称、用户常用中文/英文短语、重要组合和相邻任务排除。
- 负向探针删除一个来源、capability、profile 引用或业务 evidence 时，真实 gate 非零；恢复后同一入口通过。
- 新增/更新的 skill 通过 skill validator，并用至少一个现实请求做独立 forward-test。

推荐条件探针：

| ID | 负向场景 | 证明 |
| --- | --- | --- |
| `stack-standard-source-coverage` | 删除某个已采用标准的来源/版本信息 | 技术规范不是无来源记忆 |
| `stack-skill-coverage` | 删除一个已选技术的 required capability | 栈不只是被识别，而是有编码能力 |
| `business-pattern-routing` | 移除业务 skill 的证据或路由样例 | 业务写法有来源且真实可达 |

结构门禁只能证明存在、来源和可达性；具体生成代码仍要靠产品 lint/typecheck/test/integration/build 和真实任务 forward-test。没有产品代码时必须保持 `unverified`。

## 8. 刷新与退休

- 框架大版本、核心库大版本、安全公告或项目架构决定变化时触发刷新。
- 周期健康检查复核来源 URL、目标版本、被弃用 API 和 routing coverage。
- Skill 被更强工具/框架约束取代、长期不再路由或对应业务能力删除时退休。
- 更新来源不自动改写产品代码；先报告差异，再按用户批准的迁移范围修改。

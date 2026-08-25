# L6 知识记忆层、会话留痕、代码溯源

三件相关但不同的事：
- **知识层**（进 git，团队产物）：模块行为的**当前事实**，让下一个会话能直接信任。
- **会话留痕**（本机，gitignored）：对话与决策的可恢复记录，让跨会话、跨工具接续不丢信息。
- **代码溯源**：AI 生成/修改的代码可追溯到哪台机器产出。

---

## 第一部分：知识层

### 它存在的唯一理由

代码能自己说清"怎么做的"，但说不清：为什么是这个取舍、哪些不变量必须成立、稳定字段级的对外契约、副作用与作业、坑在哪。**知识层只装代码无法自述的那部分。** 装别的东西 = 制造第二份需要维持为真的事实。

### 结构

```text
docs/memory/
  README.md                     # 这套知识层怎么读、怎么写
  SCHEMA.md                     # 页面契约（必需章节、front matter、机器断言）
  INDEX.md                      # 页面 → 数据路径索引；每个生成物都要有 owner
  log.md                        # 可选：知识层自身的重大结构变更
  <module>/
    README.md                   # 该模块当前状态（主页）
    <细分>/<topic>.md            # 某个流程逻辑非显然时的专页
  sources/
    YYYY-MM-DD-<slug>.md        # 影响了知识层的需求 / 会议 / 审计 / 评审原文
```

### 模块主页的必需章节

```markdown
# <Module> Memory

## Module Summary        业务目的与所有权边界
## Capability Map        拥有的行为与主要代码归属
## API Surface Summary   对外接口族与生成文档链接
## Core Business Logic   校验、权限门、状态机、公式、副作用、作业、数据生命周期
## Data Sources          数据模型、集合/表、仓储层、重要查询语义
## Related Modules       上下游依赖
## Owning Code Paths     归属代码路径
## Verification Notes    测试、漂移检查、该去读哪些源文件
```

固定章节的价值不在整洁，在**可比对**：助手能逐节核对，reviewer 能一眼看出哪节空着。

### 写作规则

- **写当前状态，不写变更日志**（P11）。git log 已经记录了历史。
- **语言一致**：整层用同一种语言写（多数团队选英文），并写进规则；混写会让 grep 与断言失效。
- 优先当前代码、测试、生成文档，而不是历史笔记。
- **保留既有页面，更新它**，不要创建平行的重复页。
- **把未解决的不确定留可见**：`Known gap` / `Needs verification`。删掉或含糊化不确定，等于制造假事实。
- 只在澄清本侧契约时才提及消费方。
- 二者冲突时以代码与测试为准（P3）。

### 不要写进知识层

- 实现如何一步步演进的变更日志。
- 内部计划里的决策编号（"C1-A"、"I3"）——它们属于会话留痕，不属于知识层。
- 作者感想、状态汇报、"TODO 未来工作"。知识层记录**现在为真的东西**。
- 原始敏感数据（见下面的敏感数据处理）。

### 收尾前的逐项一致性核对（强制）

必须**逐项**验证，不是整体感觉一致：

| 核对项 | 怎么核对 |
| --- | --- |
| 描述的每个行为仍存在 | grep 函数名、路由路径、错误码/文案 key、常量 |
| 字段名与真实响应形状一致 | 读实现里的返回构造块，**不是**读注释 |
| 列出的错误码与抛错语句一致 | grep 抛错处 |
| 列出的索引与数据模型声明一致 | 读 schema/migration 声明 |

发现漂移**在同一次改动里修掉**，不要留到下次。漂移正是这一层存在要防的失败模式。

### 机器可校验断言

散文无法被检查，但**具体断言可以**。让页面在提到具体接口或方法时，附一个受检的代码块：

````markdown
```memory-check
endpoints:
  - method: GET
    path: /api/v1/example/:id
    router: src/routes/example.ts
    service: src/services/exampleService.ts
    service_method: getExample
    memory_owner: example
services:
  - file: src/services/exampleService.ts
    method: getExample
    memory_owner: example
```
````

检查器对每条断言验证：文件存在 → 路由在该文件里看起来确实注册了（匹配 HTTP 方法 + 路径静态段）→ 方法名在该文件里存在。

这不是类型级证明，是**廉价的存在性证明**——而存在性正好覆盖了最高频的漂移（接口被删、方法被改名、文件被移动）。

配套检查（同一个检查器里顺手做）：
- 本地 markdown 链接可解析。
- 反引号里的仓库路径存在。
- `sources/` 的 front matter 完整且取值在枚举内。
- 生成文档在 `INDEX.md` 里有 owner，且能被解析。
- 目录名没有不可见字符 / 近似重复（`user-resource` 与 `user_resource` 并存是真实事故）。

### 来源记录的 front matter

```yaml
---
id: YYYY-MM-DD-short-slug
date: YYYY-MM-DD
scope: <service | web | shared>
source_type: requirement | meeting-transcript | conversation | code-audit | review | implementation-plan
related_memory:
  - docs/memory/<module>/README.md
verified_from:
  - src/routes/example.ts
sensitivity: public | internal | sensitive
---
```

三个字段是关键：`source_type`（这条知识的证据强度）、`verified_from`（它是对着哪些代码验证的）、`sensitivity`（决定能不能被复制到别处）。

### 生成式文档：唯一生成器，永不手改产物

契约类文档（OpenAPI 之类）如果同时能手改和生成，就会有两个源。规则：**代码注解是源，产物由命令生成，任何人不得手改产物。** 并且：
- 生成命令进门禁链，产物与源不一致即失败。
- 产物文件顶部写一行"本文件由 `<command>` 生成，不要手改"。
- 知识层链接产物，不复制产物内容。

### 漂移门禁：核心代码改了但知识层没改

最有效的一条机器检查：

```text
若 本次改动集合 ∩ 核心层目录 ≠ ∅
  且 本次改动集合 ∩ docs/memory/ = ∅
  且 没有有效 ack
则 失败，并列出最多 8 个核心文件 + 修复动作 + ack 命令
```

要点：
- 「核心层」是一个**具体目录列表**，不是"重要的代码"。
- 无法解析改动集合时（不在 checkout 里、git 报错）→ 警告并跳过（P9）。
- 逃生舱：`<pkg> run gate:ack -- "<理由>"`，被审计（P8）。
- 这条判定与 `stop` 钩子**共用同一个函数**，否则 CLI 与钩子会静默地不一致。二者只在提问范围上不同：钩子问"**本次会话**是否留下了没有知识同步的核心改动"，CLI 问"**这个工作树**是否可交付"。

---

## 第二部分：会话留痕

### 分级（哪种任务需要留痕）

| 任务级别 | 留痕 | 知识同步 | 计划 | 例子 |
| --- | --- | --- | --- | --- |
| 小 | 不需要 | 除非行为变更，否则不需要 | 不需要 | 只读回答、错别字、单个显然的文档清理 |
| 中 | 仅当跨会话、实质改动代码、或需要交接时 | 行为或接口语义变更时需要 | 多文件/多层需要协调时需要 | 一条行为路径 |
| 大 | 需要 | 需要 | 需要 | 跨模块特性、迁移、数据/权限模型 |
| 敏感 | **只写脱敏摘要**，不存原始载荷 | 只写脱敏事实 | 只写脱敏事实 | 生产记录、客户数据、令牌、私有数据导出 |

一个任务同时符合多级时：**取更严的隐私/留痕规则 + 取最轻但仍保证可恢复与可审计的流程**（P12）。

### 位置与命名

```text
docs/ai/long-running/state/<task-slug>/conversation/YYYYMMdd-HHmm-<short-topic>.md
```

- `<task-slug>` 与任务运行时用的是同一个 slug（见 [harness.md](harness.md)）。
- 时间是**会话开始**的本地时间；`<short-topic>` 是 3–6 个 kebab-case 词。
- **整个 `state/` 目录 gitignored**，只跟踪一个 `.gitkeep` 让目录在新 clone 上存在。

### 必需内容（按顺序）

1. **front matter**：`task` / `topic` / `started_at` / `tool` / `model` / `machine_name` / `participants`。
2. **Goal** — 1–3 句，用户想从这次会话得到什么。
3. **Decisions log** — 每条一个持久决定 + 理由，随会话推进追加。
4. **Open questions** — 未回答的点；被回答后立刻移出（答案进 Decisions log）。
5. **逐轮问答** — `## Turn <n> — <时间>` + `### User` / `### Assistant`，**原文**。重要的工具结果内联；巨大输出可截断并标注。
6. **Closing summary**（仅会话结束时）— 代码/文档改了什么、还剩什么、下个会话从哪继续。
7. **AI Code Provenance**（改了受版本控制的代码时必需）— 见第三部分。

### 何时写

- **会话开始**：建文件，写 front matter + Goal。
- **写 front matter 之前**：取当前机器名填 `machine_name`；取不到就写 `unknown` 并在 Closing summary 里说明这个 gap。
- **会话进行中**：在回应下一条用户消息**之前**追加上一轮。当作预写日志——不跳轮、不改写、不压缩过去的轮次。
- **在向用户提澄清问题之前**：先把待落盘的轮次刷掉。
- **会话结束或上下文被压缩时**：写 Closing summary。
- **跨工具交接**：下一个助手（不同工具/新会话）**必须**先按时间倒序读完该 slug 下的全部留痕，再回答。

### 不要记录什么

- 密钥、令牌、API key、用户误贴的个人信息——**当场**替换为 `<REDACTED>`。
- 二进制、截图——只记路径引用。
- 客户可识别数据、生产导出、私有数据库记录、以及对恢复任务并非必要的原始请求/响应载荷。用决策摘要或本地文件路径代替。
- 需要具体例子且例子含敏感数据时，用稳定占位符（`<USER_EMAIL>`、`<PROJECT_ID>`、`<CLIENT_TEXT_REDACTED>`）。

### 隐私、保留、退出

- 留痕是本机且 gitignored 的，但仍按敏感运营记录对待。
- 只保留恢复任务所需的最小上下文。
- 用户可以对某次会话说"不要记录这次"：此时只建一个带 `persisted: false` 的存根文件，让下个会话知道这里存在一个缺口。
- 不再需要时删除或轮转旧留痕目录。**不要**把留痕内容复制进提交、PR、工单或共享文档，除非用户明确要求且内容已脱敏审查。

### 为什么必须本机 + gitignored

- 有些对话包含不该出现在 git 历史/PR 评审里的过程性设计理由。
- 留痕又大又噪；塞进仓库对谁都没好处。
- 用户仍然可以在本机 grep 到它来恢复上下文。

---

## 第三部分：代码溯源

**目的**：让 AI 生成/修改的代码可追溯到产出它的机器，且**不往业务代码里加噪音**。

写在留痕的 Closing summary 里：

```markdown
## AI Code Provenance

- last_updated_by_machine: <与 front matter 的 machine_name 相同>
- changed_code:
  - file: src/services/exampleService.ts
    symbols: [ExampleService.exampleMethod]
  - file: src/repositories/exampleRepo.ts
    symbols: []
```

**什么算代码**：源码、数据模型、路由、服务、仓储、工具、测试、脚本、模板、配置——只要 AI 改了行为或可执行逻辑。纯文档编辑不需要 `changed_code`，但 front matter 仍要有 `machine_name`。

**不要做的事**：
- 不要给每个方法/文件加"最后修改人"注释，除非该文件本来就有这种本地约定。
- 不要为了 AI 归属往业务数据里加字段。
- 不要用个人邮箱、API 令牌或系统用户名做溯源标识——**只用机器名**。
- 不要猜符号名。不确定就只写文件，`symbols: []`。

**账本从哪来**：不要靠回忆。让 `post-tool-use` 钩子把被编辑的路径追加到会话账本，那个账本就是 `changed_code` 的权威来源（见 [gates-and-hooks.md](gates-and-hooks.md)）。

---

## 敏感数据策略（贯穿三部分）

值得单独一个 `policies/sensitive-data.md`，被多个档案引用：

- 生产数据调查**默认只读**；写操作需要用户显式授权。
- 密钥走密钥管理，不从环境变量原样读、更不进日志。
- 输出不泄漏堆栈细节给外部消费方。
- 留痕、知识层、评审报告里一律脱敏；用稳定占位符而不是删除（删除会让例子失去可读性）。
- 生产排障的收尾必须**分开呈现**四件事：代码行为 / 真实数据观察 / 推断 / 残留不确定。混在一起的排障结论会被当作已证实的事实继续传播。

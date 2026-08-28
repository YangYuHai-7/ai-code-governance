# L8 检查器 与 L10 运行时钩子

这两层是整套框架里**唯一真正的强制力**。其余各层是内容；这两层决定内容是否活着。

---

## 第一部分：检查器（L8）

### 设计目标

一条命令，跑完给出「通过 / 失败 + 精确到文件的原因 + 修复动作」。它必须**快到不会被跳过**（目标 < 5 秒；实测并写进文档），并且**必须失败过**——从未失败过的检查器等于未知是否可用。

### 门禁链的形状

```jsonc
// package.json（或 Makefile 等价物）
{
  "scripts": {
    "gate":            "node docs/ai/tools/check-framework.js && node docs/ai/tools/check-drift.js",
    "framework:check": "node docs/ai/tools/check-framework.js",
    "drift:check":     "node docs/ai/tools/check-drift.js",
    "gate:ack":        "node docs/ai/tools/hooks/ack.js",
    "hooks:probe":     "node docs/ai/tools/hooks/probe.js"
  }
}
```

**串联顺序有讲究**：便宜、覆盖面广的检查放前面。而**会因为工作树状态而失败**的检查（例如"改了核心代码但没改知识页"）要么放最后，要么在被 ack 时降级为警告——否则它会挡住排在它后面的其他检查（一次真实教训：hard fail 放在 `&&` 链中段，导致后面两个检查在整个迁移期从未运行过）。

### 可被机器检查的清单

按「值得先做」排序。前六项适用于任何仓库、任何深度档：

| # | 检查 | 为什么它会真的抓到东西 |
| --- | --- | --- |
| 1 | **必需文件存在** | 有人重命名了入口文件，其他文件的指针全部悬空 |
| 2 | **上下文映射引用完整性**：`required` / `optional` / `verify` / `paths` 里的每个路径都存在 | 这是最容易腐烂的一层；文件改名后档案静默失效 |
| 3 | **适配器符号链接指向正确正典路径**（不只是存在） | 有人把符号链接替换成真文件，两个源开始分叉 |
| 4 | **客户端选择—引导平价性**：用户确认的每个客户端都有原生入口并拿到常驻规则；未选客户端不被声称支持 | 否则检测到的当前客户端会被误当成团队范围，或某个已选客户端每次少拿上下文 |
| 5 | **skill / command front matter 完整**（`name` + `description`） | 缺 `description` 的 skill 是**静默不可发现**，不是报错 |
| 6 | **本地 markdown 链接与反引号路径可解析** | 文档里的路径引用是 AI 最信任、也最容易过期的东西 |
| 7 | **规则 front matter 可解析**，且 `profiles` 里的档案名在 context map 里存在 | 规则声明了一个不存在的档案 = 永不被加载 |
| 8 | **清单完整性**：用途说明文档里列出的 skills/commands 与目录实际内容一致 | 新增了 skill 但没人知道它存在 |
| 9 | **陈旧措辞**：已废弃的目录名/命令名不再出现在文档里 | 迁移做了一半是常态 |
| 10 | **钩子配置存在**：客户端配置里的钩子命令与 handler 文件都在 | 钩子一消失，所有客户端静默退回建议模式 |
| 11 | **知识层断言对代码成立**（见 [memory-layer.md](memory-layer.md)） | 直接对抗 P3 的失败模式 |
| 12 | **改动集合与文档同步的比例关系** | 见下面「比例化门禁」 |
| 13 | **capability harvest freshness**：行为 change set 有当前 fingerprint 的评估 receipt | 成功实现否则不会进入 Skill，后续助手继续重新实现 |
| 14 | **实现—Skill 漂移与正典能力旁路** | 统一 Client、权限 service 或 adapter 已存在时，拦住旧 Skill 和新 raw implementation |
| 15 | 垃圾文件（`.DS_Store` 之类）未被提交 | 廉价，且脏目录会让符号链接检查产生噪音 |

### fail 还是 warn：先区分入口，再判断依赖

| 场景 | 结果 | 原因 |
| --- | --- | --- |
| 显式 delivery gate / pre-commit / CI 的 checker 内部异常、必需输入不可读、受管 schema 错误 | **fail** | 跳过检查后仍 exit 0 会制造虚假完成证据 |
| ambient 客户端 hook 自身异常 | warn + exit 0 + 对应声明降为 `unverified` | 后台守卫不能让客户端或仓库不可工作 |
| 未跟踪本地产物、gitignored 目录、兄弟仓库、明确可选且只在部分机器存在的工具缺失 | warn | 每个新 clone 都 hard fail 会摧毁采用 |
| 被声明为 required / enforced 的工具或输入缺失 | **fail** | 既然是完成条件，就不能同时被当作可选环境差异 |

每个 warning 都必须命名**跳过了哪一项断言**、为什么只能 warn，以及该声明当前只能是
`stated` / `unverified`。这个判断要作为注释写进实现，不能只在 README 里解释。

### 不能被机器检查的部分，要说出来

检查器覆盖不了：改动范围是否恰当、评审是否充分、抽象是否合理、方案是否与讨论一致。这些**明确标为助手责任**，写在检查器顶部注释与完成门禁文档里。理由是 P5：一个看起来全覆盖的门禁会让人以为剩下的部分也被管住了。

### 检查器自身的质量要求

- **每条失败信息包含修复动作**，不只是诊断。`"docs/ai/context-map.yaml 引用了不存在的文件 X；更新引用或恢复该文件"`。
- **一次跑完报告所有失败**，不要第一条就退出。收集到数组里最后统一打印——助手会一次修完全部。
- **失败信息里的路径可点击**（仓库相对路径）。
- 单一实现：同一条判定被 CLI 与钩子两处消费时，逻辑写在共享库里的一个函数（P8）。
- **先验证 schema，再迭代语义**。合法 JSON/YAML 但数组写成 object、profile registry 为 null/空、
  必需文件被同名目录替代都必须产生普通 failure，不能靠顶层 catch 变成 warning。
- delivery 入口顶层 catch 必须把异常加入 failures 并非零退出；只有 ambient hook dispatch 可以
  catch 后 warning + exit 0。

### 声明—证据矩阵（交付必需）

不要把“有文件”压扁成“已治理”。每个重要声明按下列维度分别记录：

| 声明 | present | reachable | enforced | real-client-verified | 检查器入口 | 精确失败条件 | 正向证据 | 负向证据 | 剩余边界 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `<声明>` | pass/fail | pass/fail/n-a | pass/fail/n-a | pass/fail/n-a | `<命令>` | `<什么输入必须非零退出>` | `<日期 + 输出摘要>` | `<注入了什么 + 失败摘要>` | `<warn-only / OS / 客户端缺口>` |

判定规则：

- `present` 只证明产物存在且引用能解析。
- `reachable` 要证明默认入口、context map、能力目录或客户端原生加载机制给出了**具体加载路径**；单纯列在 inventory 里不算。
- `enforced` 要同时有非零退出的检查器路径与本次跑过的定向负向探针。默认 warn-only、只打印错误、或只有可选严格环境变量才失败的命令只能标 `stated` / `unverified`。
- `real-client-verified` 必须回放客户端配置中的真实命令或由真实客户端事件触发；直接调用 handler 的合成载荷只证明 handler 存在。

条件探针以 [`assets/acceptance-contract.json`](../assets/acceptance-contract.json) 为最小契约。凡目标仓库使用相应特性，都必须覆盖，而不是只跑“断链 + 缺文件”两个结构探针。契约同时要求负向退出与恢复后通过；只证明“会挡住”却没有正常成功路径，也不能算闭环。

目标仓库先把契约作为版本化快照放在 `docs/ai/acceptance-contract.json`，再保存机器可读的
`docs/ai/acceptance-results.json`（正典目录不同则等价放置），并让 delivery checker 对照项目内快照校验：
契约 schema 合法、每个 probe ID 恰好一条、状态只允许 `pass` / `fail` /
`not-applicable` / `unverified`、适用项不能伪装成 `not-applicable`，且 `pass` 必须同时给出真实入口、
负向证据和恢复证据。`not-applicable` 要给适用性理由；缺真实客户端证据时用 `unverified`。这样报告中
“已跑 pre-commit/Stop 探针”不再是无法核对的散文声明。

---

## 第二部分：运行时钩子（L10）

### 五条设计约束

1. **不重复内容。** 钩子只打印**指针和实时状态**，永不打印规则正文。每项检查都委托给已有的检查器或 CLI，这样一条规则变更只需要改正典目录里的一个文件。
2. **每个客户端一处接线。** 客户端只调用一个命令：`node docs/ai/tools/hooks/dispatch.js <event>`。加一个客户端 = 加一个适配器文件，永不重写逻辑。
3. **根路径无关。** dispatch 同时探测 `docs/ai/...` 与 `<subdir>/docs/ai/...`，这样同一份配置在打开仓库根或打开子目录时都工作（monorepo / 仓库族必需）。
4. **批量，绝不逐文件。** 写入事件只**记录路径**；lint、语法、文档检查在结束事件里跑一次（P6）。
5. **ambient fail open，delivery fail closed。** dispatch/handler 自身异常可打印警告并 `exit 0`，同时把
   对应能力降为 `unverified`；handler 调用的显式 gate 仍按 delivery checker 规则非零。不要让一个
   宽泛 catch 把 checker 的失败重写成成功。

### 四个事件

| 事件 | 对抗的失败模式 | 做什么 |
| --- | --- | --- |
| `session-start` | 框架入口从未被加载 | 注入阅读顺序、已挂载的能力面、当前未完成任务、门禁指针。**压缩之后**还要重新注入本次会话的改动账本与未完成义务 |
| `post-tool-use` | 改动清单未知，溯源只能靠猜 | 静默把被编辑的仓库路径追加到会话账本 |
| `pre-compact` | 上下文压缩时留痕丢失 | 标记压缩点，要求在细节还在时把留痕落盘 |
| `stop` | 未做文档同步/知识同步/留痕就宣布完成 | 完成门禁：以非零退出阻塞，给编号修复清单 |

### `post-tool-use`：先识别工具语义，再解析载荷

账本是门禁的输入，所以**漏报是绕过，误报会让正常使用者关闭门禁**。不能因为 payload 里有
`file_path` 就认定发生了写入：Read、View、Search 也可能带路径。先按真实客户端的 tool name / event
type 区分 read 与 write，再用该工具的 schema 提取路径；freeform patch 需要解析 patch header，无法可靠
解析时记录**不透明写入标记**。shell 只有命令字符串，同样匹配已知写入形态（原地 `sed`、打补丁、
输出重定向、生成脚本）后记录 opaque marker。

这个边界之所以重要：账本是完成门禁读取的东西。一个**只通过 shell 编辑**的会话会呈现空账本、被归类为"什么都没改"、于是**整个门禁被跳过**。标记的作用是让门禁把账本当作**下界**并去交叉核对版本控制（见下）——这同时覆盖了所有还没人想到的写入路径。

每个已支持客户端都要有载荷 fixture matrix，至少覆盖：path-bearing Read 不记写；精确文件写记录路径；
freeform ApplyPatch/patch 工具记录所有目标或 opaque；shell 写记录 opaque；只读 shell 不记录。未知客户端
schema 只能记为 `unverified`，不能从另一个客户端的字段名外推。

### `stop`：比例化门禁

要求的强度取决于**这次会话改了什么**（P6）：

| 会话改了什么 | 门禁链 | 知识层同步 | capability harvest | 会话留痕 |
| --- | --- | --- | --- | --- |
| 什么都没改，或只改文档 | – | – | `not-applicable` | – |
| 非核心代码（配置、工具链、测试、框架自身工具） | 必需 | – | 行为未变可 `no-skill-with-reason` | – |
| 核心层（一个**具体的目录列表**：业务逻辑、接口、数据访问、中间件、任务） | 必需 | 必需 | 必需，绑定当前 fingerprint | 必需 |

核心层之所以是知识同步与留痕的触发条件：**那正是行为与接口语义所在**，也正是知识层所记录的东西。框架自身的工具在正典目录里自我文档化，且门禁链已经在校验它。

### Stop 必须有正常成功闭环

账本只说明“发生过写入”，不能说明义务已经履行。Stop 第一次阻断后，运行门禁与同步知识页必须能让
第二次 Stop **不依赖 ack/kill switch** 正常放行。为此需要一个 verification receipt：

- 绑定当前会话的 write/implementation generation 或稳定 change fingerprint；
- 记录实际 gate entrypoint、exit code、时间与证据摘要；
- 核心 owner 的 memory 同步也绑定同一 generation/fingerprint；
- 行为变化对应的 capability harvest 结论与 Skill 同步义务绑定同一 generation/fingerprint；
- 任何新的写入都会使旧 receipt 失效；
- Stop 只接受覆盖当前全部义务的 receipt。

receipt 只能由**成功的真实 gate 入口**生成，不能由用户或 Stop handler 自行补写。生成入口必须：先取
当前 generation/fingerprint，运行精确义务对应的门禁，再取一次 fingerprint；任一门禁非零或前后指纹
不同都不得落 receipt。成功时用原子写入记录入口、义务、时间、证据摘要和当前 fingerprint。新的写入
提升 generation 或改变 fingerprint，自然使旧 receipt 失效。

强制探针必须完整回放：`write → Stop exit non-zero → gate/memory → receipt → Stop exit 0`。如果第二次仍阻断，
或只能用 ack/off 结束，L10 不能标 `enforced`。

**改动集合怎么解析**（顺序重要）：

1. 以账本为**下界**。
2. 账本里出现过不透明写入标记时，交叉核对版本控制：已跟踪文件的内容变更 + 未跟踪的新文件。
3. 把结果收窄到**修改时间落在本次会话内**的文件。

这个拆分是刻意的：**版本控制回答"内容是否真的变了"**（`touch` 或 checkout 伪造不了），**修改时间回答"是否发生在本次会话"**。留痕文件是例外，只用修改时间——因为留痕目录是 gitignored，版本控制结构性地看不见它。

**版本控制自身无法回答时**（不在 checkout 里、git 报错）：警告而不是阻塞（P9），但**要说出来**，并要求助手自己确认它改的东西对应的门禁——不要静默退出。

因此，当版本控制不可用时，可以保持 fail-open，但该 Stop hook 对“不透明写入后的范围判定”必须标成 `unverified`，不能继续声称 `enforced`。探针至少要在一个临时 Git fixture 里证明：账本只有不透明标记时，真实改动路径仍会进入比例化门禁。

### `stop` 只是机械门禁的后备

它判断不了改动范围是否恰当、评审是否充分、以及按任务类型定义的那些门禁——那些仍然是助手的责任。文档里要写清这一点。

同时接受一个刻意的**更严**设定：机器判断不了"这次核心改动是否真的很小"，所以宁可偶尔过度触发，配下面的审计式 ack。

### 逃生舱

| 需求 | 动作 |
| --- | --- |
| 确实是小改动，门禁误判 | `<pkg> run gate:ack -- "<理由>"`（被审计、限时、单次消费） |
| 只关完成门禁 | `<PREFIX>_AI_GATE=off` |
| 关掉所有钩子 | `<PREFIX>_AI_HOOKS=off` |

要点：
- ack 是**带理由**的，理由会被打印出来（不是静默通过）。
- ack **限时**（例如 15 分钟）、绑定 enforcement entrypoint + change fingerprint，并由拥有它的入口
  **原子单次消费**。第一次读取即清除；第二次调用必须阻断。
- Stop、pre-commit、CI/CLI 若都支持 ack，使用独立 scope 或单一明确 consumer。不得共享一个
  “CLI 只读不清、期待未来 Stop 清理”的文件——没有真实 Stop 接线时它会在 TTL 内被重复使用。
- kill switch 是运维退路，不是验收成功路径；启用时必须打印并让该次 enforcement 状态变成 unverified。

### 验证钩子真的工作

写一个探针命令：`<pkg> run hooks:probe`。它用**已声明客户端的真实 payload schema**驱动每个事件，
并回放客户端配置里的真实命令。它至少覆盖工具分类矩阵、Stop 完整成功闭环和 ack 双次消费；只用一个
无 `tool_name` 的 `file_path` 合成对象不足以证明 post-tool-use。

每个事件也要能单独驱动以便调试：

```bash
echo '{"session_id":"probe","source":"startup"}' | node docs/ai/tools/hooks/dispatch.js session-start
echo '{"session_id":"probe-read","tool_name":"Read","tool_input":{"file_path":"src/example.ts"}}' | node docs/ai/tools/hooks/dispatch.js post-tool-use
echo '{"session_id":"probe-write","tool_name":"Write","tool_input":{"file_path":"src/example.ts"}}' | node docs/ai/tools/hooks/dispatch.js post-tool-use
echo '{"session_id":"probe-patch","tool_name":"ApplyPatch","tool_input":{"patch":"*** Update File: src/example.ts"}}' | node docs/ai/tools/hooks/dispatch.js post-tool-use
echo '{"session_id":"probe","trigger":"auto"}' | node docs/ai/tools/hooks/dispatch.js pre-compact
echo '{"session_id":"probe"}' | node docs/ai/tools/hooks/dispatch.js stop; echo "exit=$?"
```

上面的 tool name/字段只是示例；交付时必须替换成目标客户端官方或真实事件观测到的 schema，并保留
一条 path-bearing Read 反例。

会话临时状态放一个 gitignored 目录（例如 `.ai-runtime/`）。

**探针跑不通就按 P5 记进 README**：这一层标为「未验证」，不要让它长得像治理。

---

## 客户端接线现状表（模板）

每个仓库都要有这张表，因为各客户端能力不同，**不均匀是常态，隐瞒不均匀才是问题**：

| 客户端 | 适配器 | 状态 |
| --- | --- | --- |
| 有生命周期钩子 API 的客户端 | 设置文件 + 适配器目录 + 入口文件导入 | 已接线（四个事件） |
| 只有规则目录的客户端 | 规则目录符号链接 | 仅规则；今天没有生命周期钩子 API |
| 只有技能/命令目录的客户端 | 相应目录符号链接 | 规则与技能；无钩子 |
| 通用 CLI | 直接读正典目录 | 靠散文约定 |

配套两条现实处理：
- 只有一份客户端设置文件；其他根路径用符号链接指向它，且 dispatch 探测多个根（约束 3）。
- **本地符号链接不可提交**（跨仓库、或该目录未被跟踪）时：提供 `<pkg> run hooks:link` 一键修复，并让检查器对它**警告而非失败**（P9）——hard fail 会让每次新 clone 都失败。

---

## git hook：非 Claude 客户端的等价物

`Stop` 钩子只绑定支持它的客户端。其他客户端（以及人类）靠 git hook：

- 用**幂等安装脚本**（`<pkg> run hooks:install`），不要手改 `.git/hooks`；仓库里有 `core.hooksPath` 约定时沿用它。
- `pre-commit` 跑同一条门禁链，**不要另写一份逻辑**。
- 提供 `--no-verify` 之外的可审计路径（同一个 ack 机制），否则人会用 `--no-verify` 并且不留理由。
- **只在 B4 允许时安装**；否则只打印安装说明。
- `installed`、`entrypoint replayed`、`change-sync enforced` 分开报告。临时 Git fixture 必须实际执行
  tracked pre-commit shim：故障条件下非零，恢复后为零；只调用它下面的 gate 不算 hook 入口证据。
- pre-commit 自己原子消费其 scope 的 ack，或使用绑定本次 index/change fingerprint 的独立 receipt；
  不得依赖一个尚未接线的客户端 Stop 在未来清理。

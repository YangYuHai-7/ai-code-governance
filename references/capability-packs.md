# 技术栈能力包协议

机器可读注册表在 [../assets/capability-pack-registry.json](../assets/capability-pack-registry.json)。能力包回答“该如何侦察和继续提问”，不回答“目标项目必须采用什么架构”。

## 选择优先级

发生冲突时按以下顺序：

1. 目标仓库当前代码、构建文件和测试；
2. 用户明确确认的决策；
3. 目标仓库自己的架构文档和事故记录；
4. 已选能力包的候选与提问；
5. 通用适配器。

能力包永远不能覆盖前三项。文档与代码冲突时先报告，再以代码为当前事实。

## 证据等级不是版本号

| 字段 | 说明 |
| --- | --- |
| `release` | 计划在哪条产品线提供能力 |
| `lifecycle` | `active` / `planned` / `roadmap` / `deprecated` |
| `evidence` | `certified` / `supported` / `unverified` / `unsupported` |

v3.1 不自动比 v3.0 更可靠；`active` 也不等于 `certified`。当前 v3.0 包是团队内部 `supported` 起点，仍需要真实项目与三系统矩阵才能晋级为产品 C 的 `certified`。

## v3/v4 矩阵

| 版本 | 能力包 | 初始状态 |
| --- | --- | --- |
| v3.0 | React、Vue、Angular、Node.js、Java | `active` + `supported` |
| v3.1 | Svelte、Python、Go、PHP | `planned` + `unverified` |
| v4 | .NET/C#、Android、iOS、混合 App、桌面、C/C++/嵌入式 | `roadmap` + `unverified` |
| 通用 | 注册表未知的语言/框架 | `active` + `unverified` |

注册表是状态正典；表格只是阅读索引。状态变化时先改注册表，再同步本页。

## 侦察流程

1. 扫描构建描述、依赖清单、工作区配置和入口文件。
2. 对照每个包的 `manifest_any` 与 `dependency_any`，收集候选，不做单选假设。
3. 给每个候选记录证据路径与置信度。
4. 识别元框架、服务框架和 UI 库，它们可能与基础框架组合。
5. monorepo 按 package/module 分别识别，再判断根层是否只负责路由。
6. 检测不到专属包时选择 `generic-unknown`，邀请用户指定领域专家。

仅出现 `package.json` 不能证明项目是 Node.js 后端；仅出现 Java 文件也不能证明使用 Spring。必须满足更具体的依赖或结构证据，或者让用户确认。

## 新项目

新项目没有代码证据。先收集：

- 产品形态与部署目标；
- 团队已有经验和维护年限；
- 性能、合规、离线、实时和可观测性要求；
- macOS、Windows、Linux 开发/运行支持；
- 组织已有平台、设计系统和许可证政策。

然后提出 2–3 个**组合方案**，而不是分散问“前端选什么、后端选什么”。每个方案写：匹配约束、主要代价、能力包证据等级、OS 验证边界和需要用户确认的假设。

## 遗留项目

默认选中侦察发现的包并保持原栈：

1. 展示检测结果、来源和冲突；
2. 询问遗漏或不一致，不询问是否想追热门框架；
3. 从现有命令、邻近实现和真实失败提取治理；
4. 把现代化建议放入独立 `modernization-assessment`，不进入当前实施计划。

## 组合规则

- 一个项目可以选多个包，例如 `frontend-react + backend-java`。
- 同一 monorepo 可以在不同 package 使用不同前端包。
- 共享治理内核只保留真正跨包的约束；栈规则通过 context profile 路由。
- UI 选择是前端包的后续决策，不是基础包的一部分。
- 平台家族包可以组合，例如混合 App 同时需要 Web 前端包和 Android/iOS 壳层专家。

## 验证命令发现

注册表只保存**命令来源**，不保存假定命令。Agent 必须从目标项目读取并实际执行：

- Node/Web：`package.json`、workspace runner、测试配置；
- Java/Android：Maven/Gradle wrapper 与 task 列表；
- Python：`pyproject.toml`、tox/nox、测试配置；
- Go：package、Makefile 或项目 task runner；
- PHP：Composer scripts 与框架测试配置；
- .NET：solution/project、MSBuild target、`dotnet` 工具清单；
- Apple：scheme、workspace、Swift Package；
- C/C++：CMake/Meson/Make/平台工具链。

没有运行成功的命令只能标 `not yet verified`。不要从另一个同栈项目复制命令。

## 通用适配流程

未知栈不阻止治理，但要降低声明等级：

1. 识别构建描述、测试入口、模块边界和文档；
2. 请求用户指定一名栈专家或权威来源；
3. 只生成技术栈无关的 L0/L1/L8 最小层；
4. 栈相关规则保留为候选，不机器强制；
5. 在两个真实项目重复验证后，才提议建立新能力包。

## 能力包晋级

`unverified -> supported`：

- 注册表字段完整；
- 至少有一个可复现样例；
- 侦察信号有正例和反例；
- 目标项目能发现并运行至少一个窄验证；
- 已知限制可见。

`supported -> certified`：

- 至少两个结构不同的真实项目；
- 一次新项目或遗留项目试运行，未覆盖模式明确；
- 正向门禁和负向探针；
- 声明支持的 macOS、Windows、Linux 组合分别验证；
- 栈 Owner 与独立评测 Owner 签署。

## 不允许的做法

- 看到技术名就生成一套“最佳实践规则”。
- 把 README 的示例命令当成已验证门禁。
- 让前端包决定后端所有权，或反过来。
- 把 WSL 结果当作原生 Windows 结果。
- 因为用户选择了“其他”就悄悄套用最接近的官方包。
- 把能力包的 `supported` 写成目标项目已经 `certified`。

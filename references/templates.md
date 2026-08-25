# 可复制骨架

阶段 1–4 落文件时用。全部**技术栈无关**：占位符用 `<>` 包起来，替换成目标仓库的真实名字。

## 占位符约定

| 占位符 | 含义 | 例 |
| --- | --- | --- |
| `<PROJECT>` | 仓库/服务名 | `payments-api` |
| `<PREFIX>` | 环境变量前缀（大写） | `PAY` |
| `<pkg>` | 包管理器运行命令 | `npm run` / `pnpm` / `make` |
| `<CANON>` | 正典目录 | `docs/ai` |
| `<MEM>` | 知识层目录 | `docs/memory` |
| `<core-dirs>` | 核心层目录列表 | `src/services, src/routes, src/repositories` |

## 已经在别处给全的骨架（不在这里重复 —— P1）

| 骨架 | 在哪 |
| --- | --- |
| `context-map.yaml`、`verification-profiles.yaml`、L3 规则编号方案、L5 分阶段角色表 | [layers.md](layers.md) |
| 门禁链 `package.json`、可检查清单、四个钩子事件、探针命令、客户端接线表、git hook | [gates-and-hooks.md](gates-and-hooks.md) |
| 知识层目录结构、模块页必需章节、`memory-check` 块、来源 front matter、溯源块 | [memory-layer.md](memory-layer.md) |
| `runtime.yaml`、`task.yaml`、状态机、fallback 表、harness CLI | [harness.md](harness.md) |

---

## L0 `AGENTS.md`（仓库根，工具无关入口）

```markdown
# <PROJECT> — AI 工作约定

本文件是工具无关的入口。所有客户端（Claude Code / Cursor / Codex / 通用 CLI）
读同一份正典：`<CANON>/`。客户端目录只是适配器，不含内容。

## 布局

| 位置 | 是什么 | 谁维护 |
| --- | --- | --- |
| `<CANON>/` | 正典：规则、上下文映射、技能、命令、角色、工具 | 本仓库 |
| `<MEM>/` | 模块当前行为的事实 | 本仓库 |
| `.claude/`、`.cursor/`、… | 指向 `<CANON>/` 的符号链接适配器 | 不要在此写内容 |

## 阅读顺序（每次任务）

1. 本文件
2. `<CANON>/context-map.yaml` —— 选中匹配的档案，只加载它 `required` 的东西
3. `<CANON>/rules/00_always.mdc`
4. 档案指定的规则与知识页
5. 相关代码与测试（它们优先于文档）

## 不可协商

1. 代码与测试胜过文档。冲突时按代码办，并在同一次改动里修文档。
2. 只做被要求的改动。发现范围外的问题 → 单独报告，不搭车修。
3. 完成由门禁判定，不由自述判定：`<pkg> gate`。
4. 核心层（`<core-dirs>`）的行为变更必须在同一次改动里更新 `<MEM>/`。
5. 逐仓库/逐侧报告验证结果，并说明**你没有验证哪一侧**。
6. 不要为了通过门禁而修改门禁定义。
7. 不确定就问，不要猜一个解读默默做完。

## 完成的定义

| 改动 | 要求 |
| --- | --- |
| 只读回答 / 错别字 | 无 |
| 非核心代码 | `<pkg> gate` |
| 核心层代码 | `<pkg> gate` + `<MEM>/` 同步 + 留痕 |

## 逃生舱

- `<pkg> gate:ack -- "<理由>"` —— 限时、单次、被审计
- `<PREFIX>_AI_GATE=off` / `<PREFIX>_AI_HOOKS=off`
```

---

## L1 客户端引导

**支持规则目录的客户端**：只建符号链接，不写内容。

```bash
mkdir -p .cursor && ln -s ../<CANON>/rules .cursor/rules
mkdir -p .claude && ln -s ../<CANON>/skills   .claude/skills \
                 && ln -s ../<CANON>/commands .claude/commands \
                 && ln -s ../<CANON>/agents   .claude/agents
```

**Claude Code 没有 `.claude/rules` 约定**，所以常驻规则靠 `CLAUDE.md` 的 `@` 导入拿到（这就是「引导平价性」，L8 第 4 条检查它）：

```markdown
# Repo Guardrails

正典规则在 [AGENTS.md](./AGENTS.md) 与 [<CANON>/](./<CANON>/README.md)。
本文件的存在只是让寻找 `CLAUDE.md` 的工具加载到与其他客户端相同的框架，
它自身不新增任何规则。

常驻规则在下面导入，因此从第 0 轮起就在上下文里：

@<CANON>/rules/00_always.mdc

## 改动既有代码之前

按顺序加载 —— 机器可读版本是 [<CANON>/context-map.yaml](./<CANON>/context-map.yaml)：

1. [AGENTS.md](./AGENTS.md)
2. `<CANON>/context-map.yaml` —— 选中匹配档案，只加载它要求的
3. `<CANON>/rules/00_always.mdc`（已在上面导入）
4. [<MEM>/INDEX.md](./<MEM>/INDEX.md)

## 宣布完成之前

- `<pkg> gate` 必须通过，**在任务结束时批量跑一次**（绝不逐文件跑）。
- 核心层行为变更必须同步 `<MEM>/`。
- 逐侧报告验证结果，并说明你没有验证哪一侧。
```

---

## `<CANON>/README.md`（正典索引）

```markdown
# <PROJECT> AI 正典

本目录是唯一源。客户端目录是符号链接适配器；**不要在适配器里放内容。**

| 路径 | 是什么 |
| --- | --- |
| `context-map.yaml` | 请求 → 该加载什么（档案路由） |
| `rules/` | 常驻规则与档案触发规则 |
| `anti-patterns.md` | 本仓库真实犯过的错：Wrong / Right / Why wrong |
| `verification-profiles.yaml` | 改动路径 → 该跑哪些命令 |
| `skills/`、`commands/`、`agents/` | 能力层 |
| `tools/` | 检查器与钩子（唯一的强制力） |
| `long-running/` | 任务运行时状态（可选层） |

## 强制力台账（诚实优先于好看）

| 项 | 状态 |
| --- | --- |
| 结构与引用完整性 | **enforced** —— `<pkg> framework:check` |
| 知识层与代码一致 | **enforced** —— `<pkg> drift:check` |
| 改动范围是否恰当 | **stated** —— 助手责任，机器判定不了 |
| <某层> | **unverified** —— 探针未跑通，见 `<issue>` |
```

---

## `<CANON>/USAGE.md`（能力清单）

```markdown
# 用什么

## 规则
| 文件 | 何时生效 |
| --- | --- |
| `rules/00_always.mdc` | 始终 |
| `rules/<NN>_<concern>.mdc` | 档案 `<profile>` 命中时 |

## 技能（模型自动触发）
| 技能 | 什么时候它会被选中 |
| --- | --- |

## 命令（人显式调用）
| 命令 | 做什么 | 参数 |
| --- | --- | --- |

## 角色（子代理）
| 角色 | 阶段 | 只读？ |
| --- | --- | --- |

## 场景速查
| 我要做… | 用 |
| --- | --- |
| 加一个接口 | 命令 `add-api` → 档案 `<backend>` |
| 排查线上问题 | 档案 `<investigation>` + 敏感数据策略 |
| 做代码评审 | 命令 `review` → 档案 `review` |
```

---

## L3 `rules/00_always.mdc`（常驻规则，保持小）

```markdown
---
description: 始终生效的仓库约定
alwaysApply: true
---

# 始终生效

## 目的
本文件只装**每类任务都成立**的东西。只在某类工作里成立的 → 档案触发规则。

## 不可协商
1. 仓库代码与测试的权威高于文档。冲突以代码为准，并在同一次改动里修文档。
2. 只做被要求的改动；范围外问题单独报告。
3. 不要过度设计：不要为想象中的需求加抽象层、配置项、通用化。
4. 沿用既有模式；引入新模式要说明为什么既有模式不够。
5. 完成由 `<pkg> gate` 判定。
6. 核心层（`<core-dirs>`）行为变更 → 同一次改动更新 `<MEM>/`。
7. 报告验证结果时说明**你没有验证哪一侧**。
8. 不确定就问。

## 加载流程
1. `AGENTS.md`
2. `<CANON>/context-map.yaml` → 选档案
3. 本文件
4. 档案的 `required`
5. 代码与测试

## 完成
见 `AGENTS.md` 的完成定义表。不要在这里复制一份（P1）。
```

---

## L3 档案触发规则 `rules/<NN>_<concern>.mdc`

```markdown
---
description: <一句话：这条规则管什么>
alwaysApply: false
profiles: [<profile-a>, <profile-b>]
---

# <关注点>

## 何时适用
<具体条件；读完能判断"这次算不算">

## 要求
1. <可判定的指令>
2. <可判定的指令>

## 禁止
- <禁令> —— 因为 <后果>

## 怎么验证
- `<命令>`
- 手动：<具体核对动作>

## 相关
- 反模式：`anti-patterns.md#<锚点>`
- 知识页：`<MEM>/<module>/README.md`
```

---

## L4 `anti-patterns.md`（文件头 + 一条完整条目）

````markdown
# 反模式

本文件只记录**在本仓库真实发生过**的错误。想象出来的错误不要写。
每条固定四块，缺一块说明这条还没想清楚。

## 维护此文件
- 新条目的触发条件：同一个错误第二次出现。
- 能被机器检查的 → 同一次改动里加进 `tools/`，本条留作解释。
- 失败模式已不可能发生 → 删掉（删除是维护动作）。

---

## 1. <一句话命名这个错误>

**Wrong**
```<lang>
<最小可辨识的错误写法>
```

**Right**
```<lang>
<最小正确写法>
```

**Why wrong**
<后果，具体到会发生什么：数据错、契约破、性能塌、审计断>

**Exception**
<如果确有例外，写清判定条件；没有例外就写"无">

**判定方法**
<怎么判断某段代码属于这个反模式：grep 什么、看哪个特征>
````

---

## L5 `skills/<name>/SKILL.md`

```markdown
---
name: <kebab-case-name>
description: <这是唯一的选中机制。写清"什么时候用"，包含用户会用的真实措辞
  与同义词（必要时中英双语）。不要只写"帮助处理 X"。>
---

# <标题>

## 什么时候用这个技能
<触发场景，具体>

## 什么时候不用
<边界；指向更合适的技能/命令>

## 步骤
1. <动作，含要读的具体文件>
2. …

## 验证
- `<命令>`
- 手动：<核对动作>

## 深入
| 文件 | 何时读 |
| --- | --- |
| `references/<x>.md` | <条件> |
```

> `description` 写不好，技能就是**静默不可发现**——不是报错，是永远不被选中。

## L5 `commands/<name>.md`

```markdown
---
description: <一句话>
argument-hint: <可选参数提示>
---

# <命令名>

## 前置
- 读 `<CANON>/context-map.yaml` 的 `<profile>` 档案

## 步骤
1. …
2. …

## 完成前
- 跑 `<命令>`
- 更新 `<MEM>/<module>/README.md`（若行为变更）

## 用户补充
$ARGUMENTS
```

## L5 `agents/<role>.md`

```markdown
---
name: <role>
description: <什么时候派这个角色>
tools: <只读角色只给读/搜索工具>
---

# <角色>

## 职责
<单一阶段的单一职责>

## 不做什么
<明确排除下游阶段的工作；例如 explorer 不出方案，auditor 不改代码>

## 输出格式
<结构化，让下一个阶段能直接消费>
```

---

## L6 `<MEM>/INDEX.md` 与 `SCHEMA.md`

```markdown
<!-- INDEX.md -->
# 知识层索引

| 页面 | 覆盖的代码路径 | 生成文档 owner |
| --- | --- | --- |
| `<module>/README.md` | `src/<module>/**` | `docs/api/<module>.yaml` |

## 覆盖缺口
- `src/<x>/**` —— 暂无页面（`Known gap`）
```

```markdown
<!-- SCHEMA.md -->
# 页面契约

## 模块主页必需章节
<见 memory-layer.md，不在此重复>

## front matter（来源记录）
<见 memory-layer.md>

## 机器断言块
<见 memory-layer.md>

## 写作规则
1. 写当前状态，不写变更日志。
2. 全层同一种语言。
3. 不确定要可见（`Known gap` / `Needs verification`）。
4. 保留既有页面并更新，不建平行重复页。
```

---

## L8 检查器骨架

```javascript
#!/usr/bin/env node
/**
 * <PROJECT> 框架结构检查器。
 *
 * 设计约束：
 * - 收集所有失败后统一打印；不要第一条就退出（助手要一次修完）。
 * - 每条失败都带修复动作，不只是诊断。
 * - 目标 < 5 秒；慢到会被跳过的门禁等于没有门禁。
 * - warn vs fail：依赖未跟踪的本地产物（本机符号链接、gitignored 目录、
 *   兄弟仓库、只在部分开发机存在的工具）只能 warn。hard fail 会让每次
 *   新 clone 都失败，那会让人对整套框架失去信任。不要"顺手改严一点"。
 */
const fs = require('fs');
const path = require('path');

const ROOT = findRepoRoot(__dirname);   // 根路径无关：向上探测标志文件
const failures = [];
const warnings = [];

const fail = (what, fix) => failures.push({ what, fix });
const warn = (what, fix) => warnings.push({ what, fix });

function checkRequiredFiles() {
  for (const rel of ['AGENTS.md', '<CANON>/context-map.yaml', '<CANON>/rules/00_always.mdc']) {
    if (!fs.existsSync(path.join(ROOT, rel))) {
      fail(`缺少必需文件 ${rel}`, `恢复该文件，或更新指向它的引用`);
    }
  }
}

function checkContextMapReferences() {
  // required / optional / verify / paths 里的每个路径都必须存在
}

function checkAdapterSymlinks() {
  // 不只检查存在，还要检查它是符号链接且指向正典路径。
  // 被替换成真文件 = 两个源开始分叉。跨仓库/未跟踪场景只能 warn。
}

function checkBootstrapParity() {
  // 不支持规则目录的客户端，必须通过它自己的机制拿到常驻规则
  // （例如 CLAUDE.md 里存在 `@<CANON>/rules/00_always.mdc` 这一行）
}

function checkFrontMatter() {
  // 技能/命令：name + description 齐全（缺 description = 静默不可发现）
  // 规则：profiles 里的档案名必须在 context-map.yaml 里存在
}

function checkLinksAndPaths() {
  // 本地 markdown 链接可解析；反引号里的仓库路径存在
}

function checkStaleWording() {
  // 已废弃的目录名/命令名不再出现在文档里
}

[checkRequiredFiles, checkContextMapReferences, checkAdapterSymlinks,
 checkBootstrapParity, checkFrontMatter, checkLinksAndPaths, checkStaleWording]
  .forEach((fn) => { try { fn(); } catch (e) { warn(`检查 ${fn.name} 自身报错: ${e.message}`, '修复检查器'); } });

report();   // 单一共享的裁决函数：CLI 与钩子都用它，避免两处逻辑分叉

function report() {
  for (const w of warnings) console.warn(`WARN  ${w.what}\n      → ${w.fix}`);
  for (const f of failures) console.error(`FAIL  ${f.what}\n      → ${f.fix}`);
  if (failures.length) {
    console.error(`\n${failures.length} 项失败。逃生舱：<pkg> gate:ack -- "<理由>"`);
    process.exit(1);
  }
  console.log(`OK  ${warnings.length} 警告，0 失败`);
}
```

> 非 Node 仓库：等价物是一个 `make gate` 目标 + 任意脚本语言，约束不变。

---

## L10 钩子骨架

```javascript
// <CANON>/tools/hooks/dispatch.js —— 每个客户端只接线到这一个命令
const EVENT = process.argv[2];                        // session-start | post-tool-use | pre-compact | stop
const OFF = process.env['<PREFIX>_AI_HOOKS'] === 'off';

(async () => {
  if (OFF) process.exit(0);
  let payload = {};
  try { payload = JSON.parse(await readStdin()); } catch { /* 空载荷也要能跑 */ }
  try {
    // 根路径无关：同时探测 <CANON>/... 与 <subdir>/<CANON>/...
    const handler = require(`./handlers/${EVENT}.js`);
    await handler(payload);
  } catch (e) {
    console.warn(`[hooks] ${EVENT} 失败（fail open）: ${e.message}`);
    process.exit(0);                                  // 坏掉的守卫绝不能让仓库不可用
  }
})();
```

```javascript
// handlers/post-tool-use.js —— 只记录，绝不逐文件校验（批量原则）
module.exports = (p) => {
  const file = p?.tool_input?.file_path;
  if (file) return appendLedger(relativeToRoot(file));
  const cmd = p?.tool_input?.command;
  // shell 载荷里没有路径。匹配已知写入形态（原地 sed、打补丁、输出重定向、
  // 生成脚本）时记一个**不透明写入标记**，让完成门禁把账本当作下界并去交叉
  // 核对版本控制。只读命令（列目录/搜索/查状态/跑测试）不匹配。
  if (looksLikeWrite(cmd)) return appendLedger('<opaque-write>');
};
```

```javascript
// handlers/stop.js —— 比例化完成门禁；唯一会以非零退出阻塞的 handler
module.exports = async () => {
  if (process.env['<PREFIX>_AI_GATE'] === 'off') return;

  const changed = await resolveChangeSet();   // 1) 账本为下界 2) 见到不透明标记则交叉核对
                                              //    版本控制 3) 收窄到本次会话的 mtime
  if (changed.unresolvable) {
    console.warn('[gate] 无法解析改动集合；请自行确认对应门禁');   // 警告不阻塞
    return;
  }
  const need = requirementsFor(changed);      // 与 CLI 共用同一个函数
  if (!need.length) return;

  const ack = consumeAck();                   // 限时 + 单次消费；生命周期由钩子拥有
  if (ack) { console.log(`[gate] 已 ack：${ack.reason}`); return; }

  console.error(formatNumberedFixList(need)); // 编号清单，每条带命令
  process.exit(2);
};
```

```javascript
// ack.js —— 被审计的逃生舱
const reason = process.argv.slice(2).join(' ').replace(/^--\s*/, '');
if (!reason) { console.error('用法：<pkg> gate:ack -- "<理由>"'); process.exit(1); }
writeAck({ reason, at: nowIso(), ttlMinutes: 15, singleUse: true });
console.log(`已记录 ack（15 分钟内有效，单次消费）：${reason}`);
// CLI 侧的同名门禁只读不清 —— 单次生命周期由钩子拥有。
```

---

## `.gitignore` 片段

```gitignore
# AI 运行时本机状态（绝不入库）
<CANON>/long-running/state/*
!<CANON>/long-running/state/.gitkeep
.ai-runtime/
```

---

## 收尾报告模板（交付时给用户）

```markdown
## 已落地
| 层 | 文件 | 状态 |
| --- | --- | --- |
| L0 入口 | `AGENTS.md` | enforced（存在性受检） |
| … | | |

## 强制力台账
- **enforced**：<列出被检查器真正挡住的项>
- **stated**：<只写在散文里、靠助手自觉的项>
- **unverified**：<建了但没验证过的项 + 为什么>

## 检查器已被证明会失败
<粘上故意破坏后的失败输出摘要>

## 我没有验证的部分
<明确列出>

## 下一步（按性价比）
1. …
```

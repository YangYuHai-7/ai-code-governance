# macOS、Windows、Linux 跨平台协议

跨平台是 v3 的横切要求，不是 v4 才处理的平台能力。skill 自身和它生成的治理框架都必须区分：**当前执行环境**、**团队需要支持的环境**、**实际验证过的环境**。三者不能混写成“跨平台”。

## 先记录平台事实

侦察阶段记录：

```yaml
platform:
  current_os: macos
  supported_os: [macos, windows, linux]
  verified_os: [macos]
  current_shell: zsh
  required_shells: [posix-sh, powershell]
  path_case_sensitive: false
  adapter_mode: generated-files
  hook_mode: git-shim
```

`verified_os` 只能写本次或已有证据实际跑过的系统。当前在 macOS 上完成检查，只能证明 macOS；Windows 与 Linux 必须标记 `not-yet-verified`，直到对应环境的检查通过。

## 可移植实现原则

1. **仓库内使用相对路径**。文档、清单和检查器不写开发者绝对路径。
2. **使用结构化路径 API**。Node.js 用 `node:path`，Python 用 `pathlib`，Java 用 `Path`；不要靠字符串拼 `/` 或 `\\`。
3. **公共逻辑只实现一次**。优先用目标项目已有的跨平台运行时；`.sh`、`.ps1` 只做薄启动器。
4. **不依赖 shell 特性表达核心逻辑**。禁止把 `sed -i`、`readlink -f`、`mktemp`、`chmod`、`which`、`realpath` 或 zsh 扩展当作所有平台都有。
5. **路径必须能容纳空格、Unicode、盘符和 UNC**。命令中的路径始终引用；检查器不得假设路径以 `/` 开头。
6. **不要依赖目录大小写行为**。检查重复文件时做规范化，同时报告仅大小写不同的冲突。
7. **换行与可执行位显式处理**。shell 启动器使用 LF；Windows 启动器不得依赖 POSIX executable bit。
8. **平台缺口可见**。某一平台不能安装 hook 或加载适配器时，标记 `unverified` 或 `unsupported`，不能静默跳过。

## 正典与适配器

“唯一正典源”要求只有一个地方可以被人工编辑。跨平台实现固定使用以下顺序：

1. **客户端原生入口/导入**：Codex 与 Cursor 读取 `AGENTS.md`；Claude Code 的普通 `CLAUDE.md` 使用
   `@AGENTS.md` 导入。
2. **manifest 管理的普通文件**：客户端必须使用专属 rule/skill 目录时，由 `aicg init/sync` 生成；文件
   标记 generated，manifest 保存正典来源、所有权和 SHA-256。

不创建 symlink、junction 或其他链接，不依赖管理员权限、Developer Mode 或 Git 链接配置。禁止人工维护
两套内容；适配器变化时 `aicg check` 必须失败并给出 `aicg sync` 修复动作。

旧项目发现链接时默认停止。只有 `--migrate-links` 或交互确认后才能 unlink 已知适配器链接本身，再创建
普通文件；不得递归删除或修改链接目标。未知链接保持不动并报告。

## 脚本与命令

### 首选结构

```text
scripts/
  governance-gate.<portable-runtime-extension>  # 核心逻辑
  governance-gate.sh                            # POSIX 薄启动器
  governance-gate.ps1                           # PowerShell 薄启动器
```

`aicg` 管理工具本身需要 Node.js 22+；这是执行初始化、同步和检查的显式工具依赖。生成到目标项目里的项目门禁则优先复用项目已有运行时：不要因为项目用 `aicg` 初始化，就让纯 Java 项目的日常构建额外依赖 Node.js，也不要给纯 Node.js 项目强制安装 Python。

### 包管理器入口

若项目已有统一任务入口，所有系统都调用同一个逻辑名称，例如：

```text
npm run gate
./gradlew governanceCheck
gradlew.bat governanceCheck
dotnet tool run governance-check
```

文档分别列出实际验证过的调用方式。不要把 macOS 上执行成功的 `./gradlew` 原样作为 Windows 命令。

### PowerShell

- 生成脚本优先兼容 PowerShell 7；如果团队要求 Windows PowerShell 5.1，单独记录并测试。
- 使用 `Join-Path` 和 `Resolve-Path`，不要手拼反斜杠。
- 外部命令失败后检查 `$LASTEXITCODE`；不要只依赖 `$?`。
- 安装脚本不得假设管理员权限或 Developer Mode 已开启。

### POSIX shell

- 需要跨 macOS/Linux 时以 POSIX `sh` 为基线，只有明确要求 Bash 时才使用 Bash 特性。
- macOS 自带 BSD 工具与 GNU 工具参数并不完全相同；核心逻辑不要依赖二者差异。
- 不把用户当前的 zsh alias、function 或环境变量当作项目能力。

## Git hooks

1. 先检查 `git config --get core.hooksPath`，不要覆盖已有的公司安全扫描器。
2. 安装必须幂等，并提供卸载/恢复路径。
3. Git for Windows 通常能执行 `#!/bin/sh` hook，但这不等于普通 PowerShell 会话拥有同样工具；探针要从 Git 实际调用链运行。
4. hook 只调用可移植核心门禁，不在 hook 文件里复制业务逻辑。
5. 无法证明 hook 被 Git 调用时，状态是 `installed-unverified`，不是 `enforced`。

## 检查器必须覆盖

- 路径中包含空格；
- `/` 与 `\\` 输入的规范化；
- Windows 盘符与 UNC 路径（即使在非 Windows 上可用纯函数测试）；
- 大小写冲突；
- LF/CRLF 读取；
- 普通文件、遗留链接和 generated manifest 的状态识别；
- 缺少 executable bit 时的 Windows 调用；
- 已存在 `core.hooksPath` 时不覆盖；
- 当前运行时或命令缺失时给出可执行 fallback。

## 认证矩阵

每个可分发能力包至少记录：

| OS | Shell/入口 | 适配器模式 | Gate | Hook probe | 状态 |
| --- | --- | --- | --- | --- | --- |
| macOS | Node.js CLI、zsh/POSIX 启动 | native/generated-files | pass/fail | pass/fail | verified/unverified |
| Windows | Node.js CLI、PowerShell/Git hook | native/generated-files | pass/fail | pass/fail | verified/unverified |
| Linux | Node.js CLI、POSIX `sh`/Bash | native/generated-files | pass/fail | pass/fail | verified/unverified |

产品 C 只有在三个系统的声明组合都通过正向检查和至少一个负向探针后，才能标记 `cross-platform-certified`。在此之前使用更精确的表述，例如“macOS verified；Windows/Linux designed but not yet verified”。

## 交付报告

按系统分别报告：

```text
macOS: CLI/gate verified; generated adapter verified; hook probe <status>
Windows: CLI/gate <status>; generated adapter <status>; hook probe <status>
Linux: CLI/gate <status>; generated adapter <status>; hook probe <status>
```

“代码看起来可移植”不是验证证据。平台未运行不代表失败，但必须保持可见。

本工具仓库自身的 CLI CI 证据与未验证边界记录在 `assets/capability-pack-registry.json`；该证据不能自动
提升任意目标项目、真实 Agent 或 hook 的状态。

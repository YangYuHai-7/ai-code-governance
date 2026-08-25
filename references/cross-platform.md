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
  adapter_mode: symlink
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

“唯一正典源”要求只有一个地方可以被人工编辑，不等于所有系统都必须以同一种文件系统机制暴露它。

按优先级选择：

1. **相对符号链接**：macOS/Linux 默认；Windows 开启 Developer Mode 且 Git 正确保留 symlink 时可用。
2. **目录 junction**：Windows 本地安装可选，但必须证明客户端能读取，且安装/卸载脚本幂等。
3. **生成式镜像**：由正典生成，只允许工具写入；文件头标记 generated，清单保存源路径与内容哈希，门禁检查零漂移。
4. **客户端原生指针/导入**：客户端支持时优先于复制。

禁止人工维护两套内容。使用生成式镜像时，README 必须写明它是适配器，不是第二正典；检查器要在内容变化时失败并给出重新生成命令。

Git 在 Windows 上可能把 symlink 检出为包含目标路径的普通文本文件。检查器必须识别这种状态并给出明确修复方案；不能把“文本内容看起来像目标路径”当作客户端已经能够加载的证据。

## 脚本与命令

### 首选结构

```text
scripts/
  governance-gate.<portable-runtime-extension>  # 核心逻辑
  governance-gate.sh                            # POSIX 薄启动器
  governance-gate.ps1                           # PowerShell 薄启动器
```

只有目标项目已经具备对应运行时时才选择 Node.js、Python、JVM 或 .NET。不要为了治理框架给一个纯 Java 项目强制安装 Node.js，也不要给纯 Node.js 项目强制安装 Python。

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
- symlink、junction、生成式镜像的状态识别；
- 缺少 executable bit 时的 Windows 调用；
- 已存在 `core.hooksPath` 时不覆盖；
- 当前运行时或命令缺失时给出可执行 fallback。

## 认证矩阵

每个可分发能力包至少记录：

| OS | Shell/入口 | 适配器模式 | Gate | Hook probe | 状态 |
| --- | --- | --- | --- | --- | --- |
| macOS | zsh 启动、POSIX `sh` 脚本 | symlink | pass/fail | pass/fail | verified/unverified |
| Windows | PowerShell 7、Git hook | symlink/junction/generated | pass/fail | pass/fail | verified/unverified |
| Linux | POSIX `sh`/Bash | symlink | pass/fail | pass/fail | verified/unverified |

产品 C 只有在三个系统的声明组合都通过正向检查和至少一个负向探针后，才能标记 `cross-platform-certified`。在此之前使用更精确的表述，例如“macOS verified；Windows/Linux designed but not yet verified”。

## 交付报告

按系统分别报告：

```text
macOS: gate verified; hook probe verified; symlink adapter verified
Windows: design covered; execution not yet verified
Linux: design covered; execution not yet verified
```

“代码看起来可移植”不是验证证据。平台未运行不代表失败，但必须保持可见。

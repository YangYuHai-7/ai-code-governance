# 文档发布一致性设计

## 目标

AICG 必须保证自身文档集中存放、中英文成对维护、发布内容完整，并与其描述的产品能力建立机器可校验的关联。必需文档缺失、位置错误、关联产品能力变化后未复核、语言版本不一致或未进入 npm 包时，发布必须在上传前失败。

本设计只治理 AICG npm 包仓库本身，不改变 AICG 在目标项目中生成的 `docs/ai` 文档结构。

## 成功标准

1. 面向人的文档统一归入 `docs/` 正典目录树。
2. 英文和简体中文公共文档作为对等版本统一放在 `docs/public/` 下。
3. 根目录 `README.md` 是自动生成的 npm/GitHub 入口适配文件，不再独立维护正文。
4. 根目录 `SKILL.md` 继续作为 Agent Skill 必需入口，与普通文档分开管理。
5. 仓库中的每个 Markdown 文档都必须登记在统一文档清单中，或被明确声明为平台必需入口。
6. 中英文公共文档的共享结构、命令、机器标识和发布版本必须同步。
7. 影响公共文档的产品能力必须映射到负责解释它们的文档。
8. 关联产品能力发生变化但没有完成文档变更声明和一致性基线刷新时，拒绝发布。
9. npm 压缩包必须包含所有标记为发布必需的文档，且不得包含未登记的面向人类文档。
10. 检查必须确定、离线，并能被定向测试、校验、包 smoke 和 `prepublishOnly` 共同调用。

## 非目标

- 不声称机器可以证明自然语言文档在专业性或语义上完全正确。
- 不自动翻译任意说明文字。
- 不迁移 AICG 在目标项目中生成的 `docs/ai` 治理产物。
- 不要求所有内部设计和历史评测都进入 npm 包。
- 不使用符号链接或其他文件链接实现文档别名。
- 不让普通只读 AICG 命令重复执行完整发布门禁。

## 正典目录结构

```text
docs/
├── documentation-manifest.json
├── public/
│   ├── en/
│   │   └── README.md
│   └── zh-CN/
│       └── README.md
└── internal/
    ├── reference/
    ├── reviews/
    ├── specs/
    └── validation/

README.md
SKILL.md
```

英文和中文项目主页的正典分别为 `docs/public/en/README.md` 与 `docs/public/zh-CN/README.md`。根目录 `README.md` 由英文正典确定生成，只允许执行必要的相对路径转换。npm 和 GitHub 会把根 README 作为包首页，因此仍保留该适配文件。

`SKILL.md` 因 Agent Skill 发现机制要求而保留在包根目录。它会登记为平台入口，继续校验链接和产品版本声明，但不受“普通人类文档必须放在 `docs/` 下”的限制。

目前直接放在 `docs/` 下的产品评测和优化方案迁移到 `docs/internal/reviews/`。现有参考资料和验证资料保留在各自子目录中。迁移完成后，`docs/` 根目录不得再直接存放普通 Markdown 文件。

## 文档清单

`docs/documentation-manifest.json` 是唯一机器可读文档清单，使用稳定路径，包含：

- `schemaVersion`：清单契约版本。
- `packageVersion`：必须与 `package.json` 完全一致的版本。
- `entrypoints`：`README.md`、`SKILL.md` 等必需根入口。
- `documents`：每个正典文档及其受众、语言、发布状态和配对关系。
- `surfaceMappings`：产品源码范围与负责说明该能力的文档之间的映射。
- `integrityBaseline`：当前发布候选中各产品能力组及其关联文档的摘要绑定。

每条文档记录形状如下：

```json
{
  "path": "docs/public/en/README.md",
  "kind": "public-home",
  "audience": "user",
  "locale": "en",
  "peer": "docs/public/zh-CN/README.md",
  "releaseRequired": true
}
```

内部文档如果属于实现证据而非本地化用户说明，可以不声明 `locale` 和 `peer`，但仍必须登记并位于允许的内部目录中。

## 公共文档同步

中英文公共文档沿用稳定同步标记，例如 `<!-- sync:quick-start -->`。每个同步章节必须在两个语言版本中各出现一次，且顺序一致。校验器比较成对章节中的机器敏感内容：

- 围栏命令块；
- 行内命令与路径；
- 由稳定同步标识代表的章节；
- 包版本声明；
- 支持的 Agent ID、配置值和 schema 字段。

不同语言的自然文字可以不同。机器敏感内容不得被翻译或改变顺序，除非清单中为具体同步章节声明了带原因的语言例外；不接受整文件通配例外。

根 README 渲染器只负责把英文正典中的相对链接转换为根目录可用的路径，其他内容保持一致。校验时在内存中重新生成预期根 README，并进行逐字节比较。发布流程不会静默重写文件；开发者必须在提交前显式执行文档同步命令。

## 产品能力映射与新鲜度

文档清单按职责划分产品能力，而不是为每个源码文件单独建立映射。首批能力组包括：

- CLI 命令和帮助；
- 配置与引导初始化；
- 生成产物与项目目录；
- 专业测试流程；
- 发布与部署行为；
- 支持的 Agent、技术栈和注册表。

每个能力组声明源码 glob 和至少一个负责说明它的公共文档章节。一致性基线记录：

- 匹配源码路径及其内容的确定性摘要；
- 负责文档的确定性摘要；
- 完成本次配对复核时的包版本。

源码摘要变化后，校验结果必须列出对应文档，并阻止发布，直到负责人复核文档并刷新基线。基线刷新是显式命令，必须同时记录产品能力组和负责文档的摘要。该动作只证明负责人复核了当前映射，不声称文档语义已经被机器证明正确。

如果源码变化确实不影响文档，可以在对应能力组记录 `noDocumentationChangeReason`。该理由必须是有长度限制的非空说明，保存在清单中以供评审，并在该能力组下一次变化时失效。这样既防止静默修改摘要，也允许不改变用户行为的内部重构。

## 命令与接口

一个职责单一的模块负责文档清单读取、校验、适配器渲染、基线刷新和 npm 包检查。首批开发者接口使用 npm scripts，不新增面向普通用户的 AICG CLI 命令：

```text
npm run docs:check
npm run docs:sync
npm run docs:baseline -- --surface <surface-id> [--no-doc-change-reason <reason>]
```

- `docs:check`：只读检查目录、清单、语言配对、根入口、版本、链接、能力新鲜度和发布必需路径。
- `docs:sync`：只写入根 `README.md` 等确定性适配文件；不翻译正文，也不刷新一致性基线。
- `docs:baseline`：文档复核后刷新指定能力组的绑定；拒绝未知能力组、缺失文档、脏文件、链接输入和无边界理由。

`validate:skill` 调用只读文档检查。`smoke:package` 使用同一份清单检查打包归档。这样 `prepublishOnly` 会在上传前同时阻止仓库文档和 npm 包内容不符合契约的发布。

## 发布流程

```text
产品或文档发生变化
        |
        v
更新 docs/ 下的正典文档
        |
        v
docs:sync -> 生成确定性的根 README 适配文件
        |
        v
docs:baseline -> 记录产品能力与文档的显式复核
        |
        v
docs:check -> 校验仓库文档一致性
        |
        v
test:full + validate + smoke + smoke:package
        |
        v
prepublish-check -> 校验干净 Git 候选和实际 npm 包形状
        |
        v
npm publish
```

任何发布步骤都不得静默修复文档。生成入口未同步或基线过期时，必须失败并给出精确修复命令。

## 失败行为

所有文档错误必须指出违反的规则、对应文档或产品能力、期望的正典位置或语言配对，以及安全的确定性修复命令（如果存在）。典型错误包括：

- `unregistered document: docs/new-guide.md`；
- `public document outside docs/public: GUIDE.md`；
- `missing locale peer for docs/public/en/README.md`；
- `root README differs from docs/public/en/README.md; run npm run docs:sync`；
- `release surface cli-commands changed; update its owning documentation and refresh the baseline`；
- `release-required document missing from npm package: docs/public/zh-CN/README.md`。

仓库校验必须拒绝符号链接、链接祖先、重复文档记录、不安全路径、缺失文件和包根目录以外的路径。

## 迁移步骤

迁移通过一个可评审变更完成：

1. 创建文档清单和校验模块，先针对当前散落结构编写失败测试。
2. 把英文和中文公共主页移动到 `docs/public/en/` 与 `docs/public/zh-CN/`。
3. 把 `docs/` 根目录的评测与优化方案移动到 `docs/internal/reviews/`。
4. 更新内部链接和测试。
5. 从英文正典生成根 README 适配文件。
6. 创建首批产品能力映射和一致性基线。
7. 让仓库校验和包 smoke 共同使用该清单。
8. 修复现有中英文文档中“三条路径/两条路径”的表述不一致。

Git 历史提供文件移动追踪，不创建兼容符号链接。发布文档中的链接必须从其最终 npm 包路径正确解析。

## 测试策略

实现严格遵循测试驱动开发。定向测试覆盖：

- 拒绝位于未登记正典位置之外的 Markdown；
- 只允许两个必需根平台入口；
- 语言配对章节的顺序和机器标识漂移；
- 根 README 的确定性生成与链接转换；
- 包版本漂移；
- 源码变化并同步更新文档的场景；
- 源码变化但提交有边界的无需更新文档理由；
- 过期或伪造的基线更新；
- 符号链接、重复记录、不安全路径和缺失文件；
- npm 包包含所有发布必需文档；
- npm 包不包含未登记的人类文档。

迁移完成后依次执行定向文档测试、`test:fast`、`test:full`、`validate`、`smoke`、`smoke:package`、`node scripts/prepublish-check.mjs` 和 `npm pack --dry-run --ignore-scripts --json`。

## 证据边界

检查通过只能证明文档已集中登记、语言结构配对、机器敏感内容同步、产品能力映射经过显式复核，并实际进入 npm 包。它不能证明翻译质量、事实完整性、专业人员评审或所有语义变化都被正确分类。这些仍属于人工评审职责，不能被描述为机器已验证事实。

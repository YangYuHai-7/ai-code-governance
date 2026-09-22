import { governanceBootstrapCommand } from '../generator.mjs';

// The recommended entry point for new and brownfield repositories is `aicg config open`, which
// opens the visual editor at 127.0.0.1, lets the owner walk through every decision, and on save
// invokes the same `aicg init` flow that an experienced user would drive by hand. The remaining
// commands below are the small daily surface: configuration, apply, sync, verify, complete, and
// diagnostics, plus the agent-runtime helpers (`request`, `route`, `work-unit`, `test-case`,
// `hook`, `release-check`). Commands previously named `assess`, `architecture`, `enrich`,
// `evidence`, `standards`, `team`, `harvest`, and `promote` were thin wrappers and have been
// folded into `doctor` + `check` + `sync`; if a script still calls them, the CLI exits with a
// usage error pointing at the replacement.
export const HELP = `AI Code Governance CLI

Usage:
  aicg            Start guided setup for the current project in the detected terminal language.
  aicg config open [path]   Open the visual editor at 127.0.0.1; on save, the same exact-planHash approval applies the governance framework.
  aicg config <init|validate|launcher> [path] [--output aicg.config.json] [--config aicg.config.json] [--yes] [--json]
  aicg init [path] [--guided | --config answers.json | --clients all|client,...] [--locale zh-CN|en]
                  [--yes] [--approve planHash] [--dry-run] [--family|--no-family] [--no-assist]
                  [--assist codex|claude-code|cursor] [--review] [--migrate-links] [--force] [--adopt-foreign-governance]
  aicg check [path] [--json] [--enforce]
  aicg sync [path] [--dry-run] [--force] [--migrate-links] [--prune] [--approve planHash]
  aicg doctor [path] [--locale zh-CN|en] [--json] [--enforce]
  aicg route [path] --text <task> [--paths <relative-path,...>] [--json]
  aicg work-unit <plan|status> [path] --work-unit <relative-json> [--json] [--enforce]
  aicg test-case <init|validate|select|record> [path] [--manifest <relative-json>] [--scope <id>] [--output <relative-path>]
  aicg complete [path] [--task-level L0|L1|L2|L3] [--review-mode <mode>] [--approval-evidence <relative-json>] [--work-unit <relative-json>] [--approve <planHash>] [--verify <discovered-command>] [--json] [--enforce]
  aicg hook <install|status> [path] [--yes] [--json]
  aicg release-check [path] --type <bugfix|feature|major> [--evidence <repository-relative-json>] [--replay --approve planHash] [--json] [--enforce]
  aicg request [path] --text <exact-supported-request> [--config answers.json] [--clients all|client,...] [--locale zh-CN|en] [--dry-run] [--approve planHash] [--json]
  aicg --version

Commands:
  config  Create, validate, or open the visual editor. The editor is the recommended entry point:
          open the page, walk through every owner decision, preview the exact plan, save to apply.
          Validation writes a local report. config launcher --yes installs a desktop folder-drop entry.
  init    Inspect a repository and initialize tailored AI governance.
          --family prepares one exact plan for the orchestrator and every detected member repository; preview with --dry-run, then approve the combined planHash. All repositories roll back if any apply or check fails.
          Existing executable governance under the canonical roots stops the run before any write; re-run with --adopt-foreign-governance to keep and register those files as user-owned, or run without it to cancel.
  check   Validate configuration, managed files, drift, and reachability. Findings are written to reports/aicg/latest-check.json.
  sync    Regenerate managed adapters from canonical governance sources; --prune removes obsolete managed files when paired with --approve.
  doctor  Inspect the local environment and report; also covers the read-only classifications that used to live in assess / architecture / standards / team.
  route   Plan task depth and recommend approved project Agent roles without launching an Agent or editing code.
  work-unit  Preview or validate one bounded vertical feature document. Writes a local report and never launches Agents.
  test-case  Create and validate schema-v2 cases, emit minimal AI packets, and record evidence-bound results.
  complete  Report completion findings; a selected project verification command is explicit and never inferred.
            Review modes: single, quick-review, independent-pk, high-consequence-pk. Production changes require a declared level and bound approval references.
            Approval JSON: schemaVersion:1, planHash, reviewEvidence:{}, professionalBoundaries:[], approvals:[{id,reference,sha256,source:"operator-declared",participantId}].
            Prepare reference digests and evidence with a placeholder planHash, then inspect taskApproval.plan and approve its exact hash. changeDigest binds HEAD, index and final file content; only the evidence planHash field is excluded to avoid self-reference. Do not copy diff/plan bodies into evidence.
            The installed hook reads only AICG_TASK_LEVEL, AICG_REVIEW_MODE, AICG_APPROVAL_EVIDENCE (repository-relative JSON), and AICG_APPROVE (planHash). Stage evidence and references, preview with --from-git-hook, then export those values before git commit; missing or stale approval is reported by default. Manual completion ignores these variables.
            PK proposals and referee need distinct reference files and digests. Professional identity and review quality remain operator-declared, never machine-verified.
            L2/L3 production delivery requires one work unit with canonical Memory coverage and per-case AICG_QA_RESULT markers from one --verify run. Write returned workUnit.recordedEvidence into verification.evidence and recordedResults into qa.results to reuse that run. Hook input AICG_WORK_UNIT points to the staged JSON; recorded evidence is structurally checked and operator-declared, not authenticated execution.
            Approved professional roles in managed docs/ai/agent-team.json require explicit activation.signals (owner-confirmed risk IDs) and activation.paths (repository-relative globs). Relevant missing mappings are reported; unrelated documentation or mapped out-of-scope tasks do not acquire professional risk.
  hook  Install or inspect the managed Git pre-commit completion gate. Installation requires --yes.
  release-check  Apply the risk-tiered acceptance policy; replay requires approval of the exact command plan hash.
  request Route an exact Chinese or English governance request through a safe plan and verification workflow.

All AICG checks write a JSON report and return exit code 0 by default, including failed findings. Pass --enforce to a check command to return exit code 1 for failed findings. Initialization transactions still reject invalid writes.

Novice quick start:
  npm install --global ai-code-governance
  aicg
  # or, with the visual editor:
  aicg config open

Chat start:
  Ask a shell-capable coding Agent to use the installed aicg CLI for the current project.
  The Agent should scan first, ask only owner decisions, preview writes, and then request approval.

Bootstrap help (package resolution only at setup):
  ${governanceBootstrapCommand({})}
Daily commands require an installed project-local or global AICG. If unavailable, stop and explicitly install it. Pinned bootstrap does not install a persistent CLI.

--guided asks for AI coding tools first, governance artifact language second, and test-case format/location third, followed by project stage, technology stack confirmation or selection, governance depth, and future AICG command style. It requires an interactive terminal and never turns --yes into implicit answers.

--locale controls interaction language only. Governance artifacts default to English; choose config.artifactLanguage or answer the separate guided question to change them. Existing bilingual artifact configurations remain supported but are not offered for new guided choices.
`;

export const HELP_ZH = `AI 代码治理 CLI

用法：
  aicg            使用自动识别的终端语言，为当前项目启动引导式设置。
  aicg config open [路径]   打开可视化配置页（127.0.0.1）；保存后立即以相同的精确 planHash 批准并应用治理框架。
  aicg config <init|validate|launcher> [路径] [--output aicg.config.json] [--config aicg.config.json] [--yes] [--json]
  aicg init [路径] [--guided | --config answers.json | --clients all|客户端,...] [--locale zh-CN|en]
                  [--yes] [--approve planHash] [--dry-run] [--family|--no-family] [--no-assist] [--review] [--adopt-foreign-governance]
  aicg check [路径] [--json] [--enforce]
  aicg sync [路径] [--dry-run] [--prune] [--approve planHash]
  aicg doctor [路径] [--locale zh-CN|en] [--json] [--enforce]
  aicg route [路径] --text <任务> [--paths <相对路径,...>] [--json]
  aicg work-unit <plan|status> [路径] --work-unit <相对路径.json> [--json] [--enforce]
  aicg test-case <init|validate|select|record> [路径] [--manifest <相对路径.json>] [--scope <标识>] [--output <相对路径>]
  aicg complete [路径] --work-unit <相对路径.json> --task-level L2 --approval-evidence <相对路径.json> --approve <planHash> [--verify <已发现命令>] [--json] [--enforce]
  aicg --version

关键流程：
  config        生成或校验项目配置；open 打开可视化配置页（推荐入口）；launcher --yes 创建桌面文件夹拖拽入口。
  init          扫描仓库并初始化治理；客户端支持范围必须显式选择。--family 为编排仓及所有成员仓生成一个精确计划，全部成功才提交，任一失败则全部回滚。
                docs/ai 下已有外部可执行治理时会在写入前停止；用 --adopt-foreign-governance 保留并登记为 user-owned，或不加该参数取消。
  check         检查配置、受管文件、漂移和入口可达性，并写入 reports/aicg/latest-check.json。
  sync          从治理正典重新生成客户端适配器；--prune 与 --approve 配合可清掉过期受管文件。
  doctor        检查本地环境并输出报告；同时覆盖原 assess / architecture / standards / team 的只读分类。
  route         按任务证据规划流程并建议已审批的项目 Agent 角色，不启动 Agent 或修改代码。
  work-unit     预览或校验一个垂直功能工作单元，只写本地报告，不启动 Agent。
  test-case     创建和校验 schema v2 测试用例、生成最小 AI 执行包，并记录证据绑定结果。
  complete      报告交付收尾；所选项目验证命令必须显式给出，工具不会自动推断。
  hook          安装或检查受管的 Git pre-commit 收尾门；安装必须带 --yes。
  release-check 应用分级发布验收策略；replay 需要对精确命令 planHash 批准。
  request       把一句中英文治理请求路由到安全的计划与验证流程。

所有 AICG 检查默认写入 JSON 报告并以退出码 0 提醒问题。显式传入 --enforce 才在发现失败时返回退出码 1；初始化事务仍会拒绝无效写入。

新手快速开始：
  npm install --global ai-code-governance
  aicg
  # 或打开可视化配置页：
  aicg config open

聊天开始：
  直接让能够操作终端的编码 Agent 使用已安装的 aicg 处理当前项目。
  Agent 应先扫描，只询问负责人必须决定的事项，预览写入内容，再请求批准。

高级设置：
  固定版本启动帮助（仅在设置阶段解析包）：${governanceBootstrapCommand({})}
  日常命令要求已安装项目本地或全局 AICG；缺少时停止并显式安装。固定版本启动不会安装持久 CLI。
  中文交互可使用 aicg init . --guided --locale zh-CN

--guided 会先收集 AI 编码工具，再单独询问治理产物语言和测试用例格式/位置，然后确认项目阶段、检测到的技术栈或目标技术栈、治理强度和以后的 AICG 运行方式；必须在交互终端中使用，--yes 不会代替你作出选择。

--locale 只控制交互语言。治理产物默认使用英语；如需更改，请设置 config.artifactLanguage 或回答独立的引导问题。已有 bilingual 配置继续兼容，但新的引导选项不再推荐它。
`;

export function helpFor(locale = 'zh-CN') {
  return locale === 'zh-CN' ? HELP_ZH : HELP;
}

export const HELP = `AI Code Governance CLI

Usage:
  aicg init [path] [--guided | --config answers.json | --clients all|client,...] [--locale zh-CN|en]
                  [--yes] [--approve planHash] [--dry-run] [--no-assist]
                  [--assist codex|claude-code|cursor] [--migrate-links] [--force]
  aicg check [path] [--json]
  aicg sync [path] [--dry-run] [--force] [--migrate-links]
  aicg doctor [path] [--locale zh-CN|en] [--json]
  aicg assess [path] [--locale zh-CN|en] [--json]
  aicg architecture [path] [--locale zh-CN|en] [--json]
  aicg enrich [path] --config answers.json [--json]
  aicg evidence <record|status|export> [path] [--config receipt.json] [--yes] [--json]
  aicg standards [path] [--json]
  aicg team [path] [--config team-context.json] [--json]
  aicg harvest [path] [--dry-run] [--yes] [--force] [--json]
  aicg promote [path] --id <capabilityId> --entrypoint <path> --verify <discovered-command> [--consumer <path>] [--dry-run] [--yes] [--json]
  aicg complete [path] [--verify <discovered-command>] [--json]
  aicg hook <install|status> [path] [--yes] [--json]
  aicg release-check [path] --type <bugfix|feature|major> [--evidence <repository-relative-json>] [--replay --approve planHash] [--json]
  aicg request [path] --text <exact-supported-request> [--config answers.json] [--clients all|client,...] [--locale zh-CN|en] [--dry-run] [--approve planHash] [--json]
  aicg --version

Commands:
  init    Inspect a repository and initialize tailored AI governance.
  check   Validate configuration, managed files, drift, and reachability.
  sync    Regenerate managed adapters from canonical governance sources.
  doctor  Inspect the local environment without changing the repository.
  assess  Classify the project and report its decision ledger without changing the repository.
  architecture  Assess source structure and present bounded migration choices without changing the repository.
  enrich  Build a read-only, exact initialization plan for a brownfield repository; writing remains a separate approved init.
  evidence  Record or summarize anonymized pilot/real-project receipts; it never certifies automatically.
  standards  Preview the selected technical-standard Skills and their audited source snapshot without changing the repository.
  team  Recommend human delivery and governance responsibility coverage without creating people, agents, tasks, or files.
  harvest  Detect reusable project capabilities and generate candidate Skills only after confirmation.
  promote  Run a discovered verification command and adopt one confirmed capability after confirmation.
  complete  Manually run the completion gate; a selected project verification command is explicit and never inferred.
  hook  Install or inspect the managed Git pre-commit completion gate. Installation requires --yes.
  release-check  Apply the risk-tiered acceptance policy; replay requires approval of the exact command plan hash.
  request Route an exact Chinese or English governance request through a safe plan and verification workflow.

Novice quick start:
  aicg doctor . --locale en
  aicg init . --guided --locale en

--guided asks for the client, project stage, governance depth, language, and future AICG command style. It requires an interactive terminal and never turns --yes into implicit answers.
`;

export const HELP_ZH = `AI 代码治理 CLI

用法：
  aicg init [路径] [--guided | --config answers.json | --clients all|客户端,...] [--locale zh-CN|en]
                  [--yes] [--approve planHash] [--dry-run] [--no-assist]
  aicg check [路径] [--json]
  aicg sync [路径] [--dry-run]
  aicg doctor [路径] [--locale zh-CN|en] [--json]
  aicg assess [路径] [--locale zh-CN|en] [--json]
  aicg architecture [路径] [--locale zh-CN|en] [--json]
  aicg enrich [路径] --config answers.json [--json]
  aicg evidence <record|status|export> [路径] [--config receipt.json] [--yes] [--json]
  aicg standards [路径] [--json]
  aicg --version

关键流程：
  init          扫描仓库并初始化治理；客户端支持范围必须显式选择。
  architecture  只读评估架构并输出稳定的采用计划 ID 和哈希，不迁移业务代码。
  enrich        为现有项目生成只读、可精确批准的治理补全计划，不写入文件。
  evidence      记录或汇总匿名试点/真实项目证据；不会自动认证。
  check         检查配置、受管文件、漂移和入口可达性。
  sync          从治理正典重新生成客户端适配器。

新手快速开始：
  aicg doctor . --locale zh-CN
  aicg init . --guided --locale zh-CN

--guided 会通过选项收集编码工具、项目阶段、治理强度、语言和以后的 AICG 运行方式；必须在交互终端中使用，--yes 不会代替你作出选择。

交互语言由 --locale 或 config.interactionLanguage 控制；治理产物语言由 config.artifactLanguage 单独控制。
`;

export function helpFor(locale = 'en') {
  return locale === 'zh-CN' ? HELP_ZH : HELP;
}

import { readBoundedRepositoryFile } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/index.mjs';

export const MEMORY_INDEX = 'docs/memory/INDEX.json';
export const MEMORY_LIMIT = 2 * 1024 * 1024;
export const MEMORY_COLLECTIONS = ['modules', 'pages', 'apis', 'methods', 'dataSources', 'callSites', 'sources', 'tests', 'gaps'];
export function safeMemoryPath(value) {
  return typeof value === 'string' && isSafeRelative(value) && normalizeRelative(value) === value
    && !value.split('/').some((part) => part.toLowerCase() === '.git');
}
export function readMemoryFile(root, relative, limit = MEMORY_LIMIT) {
  if (!safeMemoryPath(relative)) throw new Error(`unsafe memory/evidence path: ${relative}`);
  const { bytes } = readBoundedRepositoryFile(root, relative, limit);
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) throw new Error(`memory evidence must be UTF-8: ${relative}`);
  return content;
}
export function emptyMemory() {
  return { schemaVersion: 1, ...Object.fromEntries(MEMORY_COLLECTIONS.map((key) => [key, []])) };
}
export function validateMemoryShape(index) {
  if (!index || index.schemaVersion !== 1 || MEMORY_COLLECTIONS.some((key) => !Array.isArray(index[key]) || index[key].length > 4000)) throw new Error('Invalid bounded project memory schema');
  for (const key of MEMORY_COLLECTIONS.filter((key) => key !== 'tests')) if (index[key].some((entry) => !entry || typeof entry !== 'object' || Array.isArray(entry))) throw new Error(`Invalid memory ${key} entries`);
  for (const module of index.modules) for (const field of ['owns', 'codeGlobs', 'verifiedFrom', 'pageIds', 'apiIds', 'methodIds', 'dataSourceIds', 'callSiteIds']) {
    if (!Array.isArray(module[field]) || module[field].length > 4000 || module[field].some((entry) => typeof entry !== 'string')) throw new Error(`Invalid memory module ${field}`);
  }
  return index;
}

// The <reference-project>-style business memory contract. A module page explains business behavior, not just
// which files it owns, and every named endpoint or method can be drift-checked against code.
export const MEMORY_SECTIONS = [
  'Module Summary',
  'Capability Map',
  'API Surface Summary',
  'Core Business Logic',
  'Data Sources',
  'Related Modules',
  'Owning Code Paths',
  'Verification Notes',
];

export const MEMORY_PAGE_PATTERN = /^docs\/memory\/[a-z0-9][a-z0-9-]*\/README\.md$/;

// Pages written by the earlier module-<hash>.md template remain valid. They are seeds in an
// existing repository, so an ordinary sync never rewrites them; a new page uses the
// business-readable directory and the eight-section contract instead.
export const LEGACY_MEMORY_PAGE_PATTERN = /^docs\/memory\/modules\/module-[a-f0-9]{16}\.md$/;
export const LEGACY_MEMORY_SECTIONS = ['Purpose', 'Invariants', 'Structure', 'Evidence', 'Gaps'];

export function memorySchema(config) {
  const zh = config.artifactLanguage === 'zh-CN';
  const sections = MEMORY_SECTIONS.map((section) => '- ' + section).join('\n');
  return zh
    ? `# 项目记忆契约

INDEX.json 是唯一所有权和双向查找索引。schemaVersion 为 1；modules、pages、apis、methods、dataSources、callSites、sources、tests、gaps 均为数组。结构事实为 stated；业务摘要由 Agent 编写，必须提供 verifiedFrom 仓库证据，保持 unverified。

每个 module 包含 id、memoryPage、owns 精确路径、codeGlobs、summary。每个 API 使用 method/path 配对，pageIds 与 callSiteIds 必须双向一致。sources 包含 path 与 sha256；摘要不会自动提升为已验证。机器 digest 不落 docs 树。

模块页使用业务可读目录（\`docs/memory/<module>/README.md\`），必须包含以下章节：

${sections}

在具体接口或方法所在页面用 fenced \`memory-check\` 块登记端点与方法，漂移由检查器报告。行为修改必须更新所属模块页与 INDEX.json。测试、格式和无行为修改无需记忆变动。语法不支持时记录 gaps。仅按任务命中加载正文。
`
    : `# Project memory contract

INDEX.json is the sole ownership and reciprocal lookup map. schemaVersion is 1; modules, pages, apis, methods, dataSources, callSites, sources, tests and gaps are bounded arrays. Structural facts are stated; Agent-authored business summaries require verifiedFrom repository evidence and remain unverified.

Each module has id, memoryPage, exact owns paths, codeGlobs and summary. APIs require method/path pairs; pageIds and callSiteIds are reciprocal. Sources bind path and sha256; summaries never auto-promote. Machine digests never enter the docs tree.

Module pages use a business-readable directory (\`docs/memory/<module>/README.md\`) and must contain:

${sections}

Register endpoints and methods in a fenced \`memory-check\` block on the owning page; the checker reports drift. Behavior changes update the owning module page and INDEX.json. Test-only, formatting-only and non-behavior changes need no memory churn. Unsupported syntax remains a gap. Load bodies only after a task match.
`;
}

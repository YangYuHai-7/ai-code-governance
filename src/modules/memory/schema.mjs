import fs from 'node:fs';
import path from 'node:path';
import { assertNoLinkAncestor } from '../../adapters/filesystem/index.mjs';
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
  assertNoLinkAncestor(root, relative);
  const absolute = path.join(root, relative);
  const stat = fs.lstatSync(absolute);
  if (!stat.isFile() || stat.size > limit) throw new Error(`memory evidence must be a bounded regular file: ${relative}`);
  const fd = fs.openSync(absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0) | (fs.constants.O_NONBLOCK ?? 0));
  try {
    const current = fs.fstatSync(fd);
    if (!current.isFile() || current.dev !== stat.dev || current.ino !== stat.ino || current.size > limit) throw new Error(`memory evidence changed while reading: ${relative}`);
    const bytes = Buffer.alloc(limit + 1);
    let size = 0;
    while (size < bytes.length) {
      const count = fs.readSync(fd, bytes, size, bytes.length - size, null);
      if (!count) break;
      size += count;
    }
    const after = fs.fstatSync(fd);
    if (size > limit || after.size !== current.size || after.mtimeMs !== current.mtimeMs) throw new Error(`memory evidence changed or exceeds budget: ${relative}`);
    const content = bytes.subarray(0, size).toString('utf8');
    if (!Buffer.from(content, 'utf8').equals(bytes.subarray(0, size))) throw new Error(`memory evidence must be UTF-8: ${relative}`);
    return content;
  } finally { fs.closeSync(fd); }
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

export function memorySchema(config) {
  const zh = config.artifactLanguage === 'zh-CN';
  return zh
    ? '# 项目记忆契约\n\nINDEX.json 是唯一所有权和双向查找索引。schemaVersion 为 1；modules、pages、apis、methods、dataSources、callSites、sources、tests、gaps 均为数组。结构事实为 stated；业务摘要由 Agent 编写，必须提供 verifiedFrom 仓库证据，保持 unverified。\n\n每个 module 包含 id、memoryPage、owns 精确路径、codeGlobs、summary。每个 API 使用 method/path 配对，pageIds 与 callSiteIds 必须双向一致。sources 包含 path、record、sha256；摘要不会自动提升为已验证。\n\n模块页面必须包含 Purpose、Invariants、Structure、Evidence、Gaps 标题。行为修改必须更新所属模块页面、INDEX.json 和来源摘要。测试、格式和无行为修改无需记忆变动。语法不支持时记录 gaps。仅按任务命中加载正文。\n'
    : '# Project memory contract\n\nINDEX.json is the sole ownership and reciprocal lookup map. schemaVersion is 1; modules, pages, apis, methods, dataSources, callSites, sources, tests and gaps are bounded arrays. Structural facts are stated; Agent-authored business summaries require verifiedFrom repository evidence and remain unverified.\n\nEach module has id, memoryPage, exact owns paths, codeGlobs and summary. APIs require method/path pairs; pageIds and callSiteIds are reciprocal. Sources bind path, record and sha256; summaries never auto-promote.\n\nModule pages require Purpose, Invariants, Structure, Evidence and Gaps headings. Behavior changes update the owning module page, INDEX.json and source digests. Test-only, formatting-only and non-behavior changes need no memory churn. Unsupported syntax remains a gap. Load bodies only after a task match.\n';
}

import { stableJson } from '../../shared/index.mjs';
import { emptyMemory, MEMORY_INDEX, memorySchema, readMemoryFile, validateMemoryShape } from './schema.mjs';
import { scanProjectMemoryFacts } from './scanner.mjs';

export function loadProjectMemory(root) {
  try { return validateMemoryShape(JSON.parse(readMemoryFile(root, MEMORY_INDEX))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Produce artifacts only. The existing transaction owns every filesystem write. */
export function buildMemoryArtifacts(config, scan, facts) {
  const memory = validateMemoryShape(facts ?? loadProjectMemory(scan.root)
    ?? (config.initialization?.lifecycle === 'greenfield' ? emptyMemory() : scanProjectMemoryFacts(scan)));
  const zh = config.artifactLanguage === 'zh-CN';
  const artifact = (path, content, kind = 'project-memory', ownership = 'seed') => ({ path, content, ownership, kind, source: 'project-memory-evidence' });
  const artifacts = [
    artifact('docs/memory/README.md', zh
      ? '# 项目记忆\n\n记录有证据支持的模块事实。先按任务从 INDEX.json 查找唯一维护页面与双向 API 关系，再读取 SCHEMA.md 和命中的模块；不要全量加载。结构事实为 stated；Purpose 与 Invariants 由 Agent 结合 verifiedFrom 编写，未核验前保持 unverified。源码变更后同步所属页面、索引和来源记录。\n'
      : '# Project memory\n\nUse INDEX.json for the sole ownership map and reciprocal page/API lookup. Read SCHEMA.md and only the matching module pages. Structural facts are stated. Agents author Purpose and Invariants with verifiedFrom evidence; semantics remain unverified until checked. Update the owning page, index and source record after a behavior change.\n'),
    artifact('docs/memory/SCHEMA.md', memorySchema(config), 'project-memory-schema', 'full'),
    artifact(MEMORY_INDEX, stableJson(memory)),
  ];
  for (const module of memory.modules) {
    artifacts.push(artifact(module.memoryPage, `# ${module.path}\n\n## Purpose\n\n${zh ? '尚未验证；Agent 应提供 verifiedFrom 证据。' : 'Unverified; Agent-authored summary must cite verifiedFrom evidence.'}\n\n## Invariants\n\n${zh ? '尚未验证；不推断业务规则。' : 'Unverified; no business rules inferred.'}\n\n## Structure\n\n${module.owns.map((relative) => `- ${relative}`).join('\n')}\n\n## Evidence\n\n${module.verifiedFrom.map((relative) => `- ${relative}: ${memory.sources.find((source) => source.path === relative)?.sha256 ?? 'unverified'}`).join('\n')}\n\n## Gaps\n\n${memory.gaps.filter((gap) => module.owns.includes(gap.path)).map((gap) => `- ${gap.path}: ${gap.reason}`).join('\n') || (zh ? '业务语义尚未验证。' : 'Business semantics remain unverified.')}\n`));
  }
  for (const source of memory.sources) artifacts.push(artifact(source.record, stableJson(source)));
  return { memory, artifacts };
}

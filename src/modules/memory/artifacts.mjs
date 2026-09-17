import { stableJson } from '../../shared/index.mjs';
import { emptyMemory, MEMORY_INDEX, memorySchema, readMemoryFile, validateMemoryShape } from './schema.mjs';
import { scanProjectMemoryFacts } from './scanner.mjs';

export function loadProjectMemory(root) {
  try { return validateMemoryShape(JSON.parse(readMemoryFile(root, MEMORY_INDEX))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/** Produce artifacts only. The existing transaction owns every filesystem write. */
export function buildMemoryArtifacts(config, scan, facts) {
  const existing = loadProjectMemory(scan.root);
  // Initialization creates a truthful foundation, not a file-system encyclopedia.
  // Full structural facts remain available to explicit memory authoring and Skill
  // discovery, but are not promoted to human memory without owner-reviewed meaning.
  const discovered = facts ?? scanProjectMemoryFacts(scan);
  const memory = validateMemoryShape(facts ?? existing ?? emptyMemory());
  const zh = config.artifactLanguage === 'zh-CN';
  const artifact = (path, content, kind = 'project-memory', ownership = 'seed') => ({ path, content, ownership, kind, source: 'project-memory-evidence' });
  const artifacts = [
    artifact('docs/memory/README.md', zh
      ? '# 项目记忆\n\n本目录只记录经负责人确认、且有代码、测试、需求、ADR 或事故证据支持的业务事实。初始化仅创建空索引，不把目录树、文件清单或推测语义自动写成记忆。新增事实时，为其建立唯一维护页面，在 INDEX.json 中登记精确源码证据，并保持双向关系。行为变更后同步所属页面、索引和来源记录；无法确认时记录为 gap。\n'
      : '# Project memory\n\nThis directory records owner-confirmed business facts backed by code, tests, requirements, ADRs, or incidents. Initialization creates an empty index; it never turns the directory tree, a file inventory, or inferred semantics into memory. When adding a fact, create one owning page, register exact source evidence in INDEX.json, and keep reciprocal relations consistent. After a behavior change, update the owning page, index, and source records; record uncertainty as a gap.\n'),
    artifact('docs/memory/SCHEMA.md', memorySchema(config), 'project-memory-schema', 'full'),
    artifact(MEMORY_INDEX, stableJson(memory)),
  ];
  for (const module of memory.modules) {
    artifacts.push(artifact(module.memoryPage, `# ${module.path}\n\n## Purpose\n\n${zh ? '尚未验证；Agent 应提供 verifiedFrom 证据。' : 'Unverified; Agent-authored summary must cite verifiedFrom evidence.'}\n\n## Invariants\n\n${zh ? '尚未验证；不推断业务规则。' : 'Unverified; no business rules inferred.'}\n\n## Structure\n\n${module.owns.map((relative) => `- ${relative}`).join('\n')}\n\n## Evidence\n\n${module.verifiedFrom.map((relative) => `- ${relative}: ${memory.sources.find((source) => source.path === relative)?.sha256 ?? 'unverified'}`).join('\n')}\n\n## Gaps\n\n${memory.gaps.filter((gap) => module.owns.includes(gap.path)).map((gap) => `- ${gap.path}: ${gap.reason}`).join('\n') || (zh ? '业务语义尚未验证。' : 'Business semantics remain unverified.')}\n`));
  }
  for (const source of memory.sources) artifacts.push(artifact(source.record, stableJson(source)));
  return { memory, discoveryFacts: discovered, artifacts };
}

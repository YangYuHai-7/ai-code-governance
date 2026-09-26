import { stableJson } from '../../shared/index.mjs';
import { emptyMemory, MEMORY_INDEX, memorySchema, readMemoryFile, validateMemoryShape } from './schema.mjs';
import { scanProjectMemoryFacts } from './scanner.mjs';

const NL = String.fromCharCode(10);

export function loadProjectMemory(root) {
  try { return validateMemoryShape(JSON.parse(readMemoryFile(root, MEMORY_INDEX))); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}

/**
 * A module page explains business behavior rather than restating the file list. The eight
 * sections form the business memory contract; an agent or human fills them, and the
 * tool only guarantees the structure exists and that nothing claims verified business meaning
 * before the owner confirms it.
 */
function renderModulePage(module, memory, zh) {
  const owns = module.owns.map((relative) => '- ' + relative).join(NL) || (zh ? '- 无' : '- none');
  const digests = module.verifiedFrom
    .map((relative) => '- ' + relative + ': ' + (memory.sources.find((source) => source.path === relative)?.sha256 ?? 'unverified'))
    .join(NL) || (zh ? '- 无' : '- none');
  const gaps = memory.gaps.filter((gap) => module.owns.includes(gap.path)).map((gap) => '- ' + gap.path + ': ' + gap.reason).join(NL)
    || (zh ? '- 业务语义尚未验证。' : '- Business semantics remain unverified.');
  return [
    '# ' + module.path,
    '',
    '## Module Summary', '',
    zh ? '尚未验证；Agent 应提供 verifiedFrom 证据。' : 'Unverified; an Agent-authored summary must cite verifiedFrom evidence.',
    '',
    '## Capability Map', '',
    zh ? '尚未验证；不推断业务规则。' : 'Unverified; no business rules inferred.',
    '',
    '## API Surface Summary', '',
    zh ? '尚未验证；登记具体端点与方法后用 memory-check 块校验。' : 'Unverified; register concrete endpoints and methods in a memory-check block.',
    '',
    '## Core Business Logic', '',
    zh ? '尚未验证；只在负责人确认后写入。' : 'Unverified; record only after owner confirmation.',
    '',
    '## Data Sources', '',
    owns,
    '',
    '## Related Modules', '',
    zh ? '尚未验证。' : 'Unverified.',
    '',
    '## Owning Code Paths', '',
    owns,
    '',
    '## Verification Notes', '',
    digests,
    gaps,
    '',
  ].join(NL);
}

/** Produce artifacts only. The existing transaction owns every filesystem write. */
export function buildMemoryArtifacts(config, scan, facts) {
  const existing = loadProjectMemory(scan.root);
  const discovered = facts ?? scanProjectMemoryFacts(scan);
  const memory = validateMemoryShape(facts ?? existing ?? emptyMemory());
  const zh = config.artifactLanguage === 'zh-CN';
  const artifact = (path, content, kind = 'project-memory', ownership = 'seed') => ({ path, content, ownership, kind, source: 'project-memory-evidence' });
  const artifacts = [
    artifact('docs/memory/README.md', zh ? [
      '# 项目记忆',
      '',
      '本目录只记录经负责人确认、且有代码、测试、需求、ADR 或事故证据支持的业务事实。',
      '每个模块使用业务可读目录（docs/memory/<module>/README.md），包含八个章节：Module Summary、Capability Map、API Surface Summary、Core Business Logic、Data Sources、Related Modules、Owning Code Paths、Verification Notes。',
      '具体接口或方法用 fenced memory-check 块登记，由检查器对代码核对漂移。',
      '初始化只创建空索引与结构基线；机器 digest 保存在 .ai-governance/state，不进入 docs 树。',
      '行为变更后同步所属页面与 INDEX.json；无法确认的内容记录为 gap。',
      '',
    ].join(NL) : [
      '# Project memory',
      '',
      'This directory records owner-confirmed business facts backed by code, tests, requirements, ADRs, or incidents.',
      'Each module uses a business-readable directory (docs/memory/<module>/README.md) with eight sections: Module Summary, Capability Map, API Surface Summary, Core Business Logic, Data Sources, Related Modules, Owning Code Paths, Verification Notes.',
      'Register concrete endpoints or methods in a fenced memory-check block; the checker reports drift against code.',
      'Initialization creates only the empty index and the structural baseline; machine digests live under .ai-governance/state and never enter the docs tree.',
      'After a behavior change, update the owning page and INDEX.json; record uncertainty as a gap.',
      '',
    ].join(NL)),
    artifact('docs/memory/SCHEMA.md', memorySchema(config), 'project-memory-schema', 'full'),
    artifact(MEMORY_INDEX, stableJson(memory)),
  ];
  for (const module of memory.modules) artifacts.push(artifact(module.memoryPage, renderModulePage(module, memory, zh)));
  return { memory, discoveryFacts: discovered, artifacts };
}

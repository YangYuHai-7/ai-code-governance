import { GENERATED_MARKER } from '../../constants.mjs';
import { assertSkillQuality } from '../standards/index.mjs';

export const BROWNFIELD_ENRICHMENT_SKILL = 'docs/ai/skills/brownfield-enrichment/SKILL.md';
export const BROWNFIELD_ENRICHMENT_KIND = 'brownfield-enrichment-skill';

function enrichmentBody(config, zh) {
  const t = (zhText, enText) => (zh ? zhText : enText);
  const bullet = (items) => items.map((item) => '- ' + item).join('\n');
  const numbered = (items) => items.map((item, index) => (index + 1) + '. ' + item).join('\n');
  const state = config.features?.brownfieldEnrichment ?? 'ask';
  const use = [
    t('仓库已有代码，且仍有未归属业务文件或未补全的开发文档时。', 'When an existing repository still has unowned business files or incomplete development documents.'),
    t('需要把现有代码的业务行为整理进 Memory 与开发规范时。', 'When existing business behavior must be recorded into Memory and development specs.'),
  ];
  const notUse = [
    t('全新仓库没有既有业务可整理时。', 'A greenfield repository has no existing business behavior to record.'),
    t('features.brownfieldEnrichment 为 off 时，不要再次询问。', 'When features.brownfieldEnrichment is off, never ask again.'),
  ];
  const invariants = [
    t('只询问一次；brownfieldEnrichmentDecision 已存在即不再询问，也不因偏好变化而重复打扰。', 'Ask exactly once; a present brownfieldEnrichmentDecision stops further asking, independent of later preference edits.'),
    t('每条业务行为必须绑定源文件与测试证据；无法证明的保持 unverified。', 'Every business behavior binds source and test evidence; anything unproven stays unverified.'),
    t('不推断业务规则；不确定项记为 gap，不得编造。', 'Never infer business rules; record unknowns as gaps instead of inventing them.'),
  ];
  const flow = [
    t('本项目当前的丰富化策略：' + state + '（ask/on/off）。', 'The enrichment policy recorded for this project is ' + state + ' (ask/on/off).'),
    t('明确的“更新治理框架”请求已包含范围内、可由源码证明的开发文档和 Skill 更新；不要为同一范围重复询问。', 'An explicit governance update request already includes in-scope, code-backed development docs and Skills; do not ask again for that scope.'),
    t('若为 ask 且 brownfieldEnrichmentDecision 为空，只在需要额外把现有业务行为整理进 Memory 时询问一次；不要把常规代码规范更新变成这个问题的前置条件。', 'When ask and brownfieldEnrichmentDecision is empty, ask once only if recording existing business behavior into Memory is additional scope; do not block routine coding-guidance updates on that question.'),
    t('把答复写入 brownfieldEnrichmentDecision（status/decidedBy/decidedAt/evidenceHash），此后不再询问。', 'Write the answer into brownfieldEnrichmentDecision (status/decidedBy/decidedAt/evidenceHash) and never ask again.'),
    t('若为 on：运行 aicg enrich <path>，按开发单元补全业务 Memory 与开发文档。', 'When on: run aicg enrich <path> to complete business Memory and development documentation per unit.'),
    t('若为 off：报告 gap 并继续，不生成业务内容。', 'When off: report the gap and continue without generating business content.'),
  ];
  const escalation = [
    t('单元数量大或来源不可读时分批处理，并在进度账本记录实际进度，不要伪造内容。', 'Too many units or unreadable sources: batch the work, record real progress in the ledger, and never fabricate content.'),
    t('需要专业判断时标记 gap 并升级给负责人。', 'When professional judgement is required, mark a gap and escalate to the owner.'),
  ];
  const boundary = t('生成的业务内容在人工复核前保持 unverified；工具只保证结构、证据绑定与可追溯，不保证业务语义正确。', 'Generated business content stays unverified until human review; the tool guarantees structure, evidence binding and traceability, never business-semantic correctness.');
  const sources = ['`docs/ai/development/index.json`', '`docs/memory/INDEX.json`'];
  const matrix = [
    '| ' + t('场景', 'Scenario') + ' | ' + t('期望结果', 'Expected result') + ' | ' + t('命令', 'Command') + ' |',
    '| --- | --- | --- |',
    '| ' + t('业务 Memory 尚未决策', 'No business Memory decision yet') + ' | ' + t('仅对额外的业务整理询问一次并把答复写回配置', 'Ask once only for additional business extraction and write the answer back') + ' | `aicg enrich <path>` |',
    '| ' + t('已批准', 'Approved') + ' | ' + t('逐单元补全 Memory 与开发文档', 'Complete Memory and development docs per unit') + ' | `aicg enrich <path> --json` |',
    '| ' + t('仍存在未归属业务文件', 'Unowned business files remain') + ' | ' + t('报 warning，不阻断', 'Report a warning without blocking') + ' | `aicg check .` |',
  ].join('\n');
  return ['## When to use', '', bullet(use), '', '## When not to use', '', bullet(notUse), '', '## Required invariants', '', bullet(invariants), '', '## Decision flow', '', numbered(flow), '', '## Exceptions and escalation', '', bullet(escalation), '', '## Verification matrix', '', matrix, '', '## Project evidence boundary', '', boundary, '', '## Sources', '', bullet(sources)].join('\n');
}

export function brownfieldEnrichmentSkill(config) {
  const zh = config.artifactLanguage === 'zh-CN';
  const description = zh
    ? '当既有仓库仍缺少业务 Memory 或代码级开发规范时使用；首次只询问一次是否由 AI 整理现有业务。'
    : 'Use when an existing repository still lacks business Memory or code-backed development specs; ask once whether AI should record the existing business.';
  const content = `---
name: brownfield-enrichment
description: ${description}
---

<!-- ${GENERATED_MARKER} -->

# Brownfield enrichment

${enrichmentBody(config, zh)}
`;
  assertSkillQuality(content, { profile: 'workflow', id: 'brownfield-enrichment' });
  return content;
}

export function buildBrownfieldEnrichmentArtifacts(config) {
  const state = config.features?.brownfieldEnrichment ?? 'ask';
  const existing = config.initialization?.lifecycle === 'existing'
    || ['brownfield', 'monorepo', 'repository-family'].includes(config.projectMode);
  if (state === 'off' || !existing) return { artifacts: [] };
  return { artifacts: [{
    path: BROWNFIELD_ENRICHMENT_SKILL,
    content: brownfieldEnrichmentSkill(config),
    ownership: 'full',
    kind: BROWNFIELD_ENRICHMENT_KIND,
    source: 'brownfield-enrichment-decision',
  }] };
}

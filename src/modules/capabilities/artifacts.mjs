import path from 'node:path';
import { GENERATED_MARKER } from '../../constants.mjs';
import { normalizeRelative, stableJson, unique } from '../../shared/index.mjs';

function candidateSkill(capability, config) {
  if (config.artifactLanguage === 'zh-CN') return `---
name: ${path.basename(path.dirname(capability.skill))}
description: 检查当前实现与验证证据后，${capability.status === 'candidate' ? '评审发现的候选' : '复用已采纳的'}项目能力 ${capability.id}。
---

# ${capability.title}

<!-- ${GENERATED_MARKER} -->

## 能力记录

- 稳定 ID：\`${capability.id}\`
- 状态：\`${capability.status}\`
- 负责人：\`${capability.owner}\`
- 能力版本：\`${capability.capabilityVersion}\`
- 当前实现指纹：\`${capability.implementationFingerprint}\`
- 评审：\`${capability.review.status}\`；${capability.status === 'candidate' ? `截止日期：\`${capability.review.dueDate}\`` : `评审日期：\`${capability.review.reviewedAt}\``}

## 适用条件

- 任务需要此项目能力所代表的职责。
- 新实现可能重复当前能力边界。

## 当前实现证据

${capability.implementationPaths.map((entry) => `- \`${entry}\``).join('\n')}

## 已确认的公共入口

${capability.publicEntrypoints.length > 0 ? capability.publicEntrypoints.map((entry) => `- \`${entry}\``).join('\n') : '- 尚未确认公共入口。'}

## 必需工作方法

1. 调用或修改前，读取当前实现、导出类型和相邻测试。
2. ${capability.status === 'candidate' ? '不得将候选视为已批准的公共 API，或据此阻止并行实现；先确认并提升。' : '契约适用时复用已确认的公共入口，不创建重复的封装、策略或客户端。'}
3. 保留负责人已确定的授权、重试、错误、生命周期和配置决策。
4. 公共契约或实现指纹变化时，更新此能力记录。

## 验证

${capability.verification.length > 0 ? capability.verification.map((entry) => `- \`${entry}\``).join('\n') : '- 未发现已验证的项目命令；提升能力前先补齐。'}

${capability.status === 'adopted' ? `## 提升证据\n\n- 操作人员确认：\`${capability.promotion.basis}\`\n- 验证日期：\`${capability.promotion.verifiedAt}\`\n- 命令：\`${capability.promotion.command}\`\n${capability.consumerEvidence?.paths?.length > 0 ? `- 消费方路径状态为 \`${capability.consumerEvidence.status}\`：${capability.consumerEvidence.paths.map((entry) => `\`${entry}\``).join(', ')}\n` : ''}` : ''}

## 能力边界

${capability.status === 'candidate' ? '- 这是自动发现的候选，尚未采纳，也不是机器强制策略。提升前，确认负责人、公共入口、消费方范围及真实验证。' : '- 仅当能力目录包含提升证据和当前验证时，此记录才属于已采纳能力。'}
`;
  const adoptionInstruction = capability.status === 'candidate'
    ? 'Do not treat this candidate as an approved public API or block a parallel implementation. Confirm and promote it first.'
    : 'Reuse the confirmed public entrypoint when its contract fits; do not create a parallel wrapper, policy, or client.';
  const entrypoints = capability.publicEntrypoints.length > 0
    ? capability.publicEntrypoints.map((entry) => `- \`${entry}\``).join('\n')
    : '- No public entrypoint is confirmed yet.';
  return `---
name: ${path.basename(path.dirname(capability.skill))}
description: ${capability.status === 'candidate' ? 'Review the discovered' : 'Reuse the adopted'} ${capability.title} boundary after checking its current implementation and verification evidence.
---

# ${capability.title}

<!-- ${GENERATED_MARKER} -->

## Capability record

- Stable ID: \`${capability.id}\`
- Status: \`${capability.status}\`
- Owner: \`${capability.owner}\`
- Capability version: \`${capability.capabilityVersion}\`
- Current implementation fingerprint: \`${capability.implementationFingerprint}\`
- Review: \`${capability.review.status}\`${capability.status === 'candidate' ? ` by \`${capability.review.dueDate}\`` : ` on \`${capability.review.reviewedAt}\``}

## Use this boundary when

- The task needs the concern represented by this project capability.
- A new implementation might otherwise duplicate its current boundary.

## Current implementation evidence

${capability.implementationPaths.map((entry) => `- \`${entry}\``).join('\n')}

## Confirmed public entrypoints

${entrypoints}

## Required working method

1. Read the current implementation, exported types, and neighboring tests before calling or changing it.
2. ${adoptionInstruction}
3. Preserve authorization, retry, error, lifecycle, and configuration decisions already encoded by the owner.
4. Update this capability record when its public contract or implementation fingerprint changes.

## Verification

${capability.verification.length > 0 ? capability.verification.map((entry) => `- \`${entry}\``).join('\n') : '- No verified project command was discovered. Add one before promoting this capability.'}

${capability.status === 'adopted' ? `## Promotion evidence

- Operator confirmation: \`${capability.promotion.basis}\`
- Verified on: \`${capability.promotion.verifiedAt}\`
- Command: \`${capability.promotion.command}\`
${capability.consumerEvidence?.paths?.length > 0 ? `- Consumer paths are \`${capability.consumerEvidence.status}\`: ${capability.consumerEvidence.paths.map((entry) => `\`${entry}\``).join(', ')}\n` : ''}
` : ''}

## Capability boundary

${capability.status === 'candidate'
    ? '- This is an automatically discovered candidate, not an adopted or machine-enforced policy. Confirm owner, public entrypoint, consumer scope, and real verification before promotion.'
    : '- This record is adopted only when its promotion evidence and current verification are present in the capability catalog.'}
`;
}

export function renderCapabilityArtifacts(config, capabilities, lastHarvest) {
  const catalog = {
    schemaVersion: 1,
    lastHarvest,
    capabilities: capabilities.map((capability) => ({
      ...capability,
      implementationPaths: capability.implementationPaths.map(normalizeRelative),
    })),
  };
  const artifacts = [{
    path: 'docs/ai/capability-evolution.json',
    content: stableJson(catalog),
    ownership: 'full',
    kind: 'capability-evolution-catalog',
    source: 'project-capability-harvest',
  }];
  for (const capability of capabilities.filter((entry) => ['candidate', 'adopted'].includes(entry.status))) {
    const content = candidateSkill(capability, config);
    artifacts.push({
      path: capability.skill,
      content,
      ownership: 'full',
      kind: 'project-capability-skill',
      source: 'project-capability-harvest',
    });
    const adapters = [];
    if (config.clients.some((agent) => ['codex', 'cursor', 'generic'].includes(agent))) adapters.push(`.agents/skills/project/${path.basename(path.dirname(capability.skill))}/SKILL.md`);
    if (config.clients.includes('claude-code')) adapters.push(`.claude/skills/project/${path.basename(path.dirname(capability.skill))}/SKILL.md`);
    for (const adapterPath of unique(adapters)) artifacts.push({
      path: adapterPath,
      content,
      ownership: 'full',
      kind: 'project-capability-adapter-skill',
      source: capability.skill,
    });
  }
  return { catalog, artifacts };
}

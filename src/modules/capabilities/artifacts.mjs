import path from 'node:path';
import { GENERATED_MARKER } from '../../constants.mjs';
import { normalizeRelative, stableJson, unique } from '../../utils.mjs';

function candidateSkill(capability) {
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
    const content = candidateSkill(capability);
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

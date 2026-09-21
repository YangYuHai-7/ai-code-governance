import { sha256, stableJson } from '../../shared/index.mjs';
import { readMemoryFile, scanProjectMemoryFacts } from '../memory/index.mjs';
import { adaptiveDecisionEvidenceHash } from '../skills/index.mjs';
import { assertSkillQuality } from './skill-quality.mjs';

const LAYOUT_GROUPS = [
  { id: 'http-entrypoints', label: 'HTTP entrypoints', match: /(^|\/)(?:controller|controllers|routes?)\// },
  { id: 'services', label: 'service layer', match: /(^|\/)(?:service|services)(?:\/|$)/ },
  { id: 'persistence', label: 'persistence layer', match: /(^|\/)(?:mapper|mappers|repository|repositories|dao)(?:\/|$)/ },
  { id: 'data-contracts', label: 'data contracts', match: /(^|\/)(?:dto|dtos|vo|vos|req|request|requests|entity|entities|model|models)(?:\/|$)/ },
  { id: 'client-api', label: 'client API modules', match: /(^|\/)src\/(?:[^/]+\/)*(?:api|apis)(?:\/|$)/ },
  { id: 'state', label: 'state modules', match: /(^|\/)src\/(?:[^/]+\/)*(?:store|stores|state)(?:\/|$)/ },
  { id: 'screens', label: 'pages or views', match: /(^|\/)src\/(?:[^/]+\/)*(?:pages|views)(?:\/|$)/ },
  { id: 'components', label: 'shared components', match: /(^|\/)src\/(?:[^/]+\/)*components(?:\/|$)/ },
  { id: 'tests', label: 'tests', match: /(^|\/)(?:test|tests|__tests__)(?:\/|$)|\.(?:test|spec)\.[^/]+$/ },
];

function slug(value) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48) || 'repository';
}

function verificationCommandEvidence(scan, command) {
  const source = command.verification.source;
  let sourceSha256 = source.sha256 ?? null;
  if (!sourceSha256) try {
    sourceSha256 = sha256(readMemoryFile(scan.root, source.path, 256 * 1024));
  } catch {
    // An unavailable source remains explicitly unbound instead of inheriting trust.
  }
  return {
    command: command.command,
    cwd: command.verification.cwd,
    argv: command.verification.argv,
    source: { ...source, sha256: sourceSha256 },
    trust: command.verification.trust,
  };
}

function projectLayoutCandidate(scan) {
  const sourceFiles = scan.files
    .filter((file) => file.type === 'file' && file.contentScannable !== false)
    .map((file) => file.relative)
    .filter((relative) => /\.(?:java|kt|js|jsx|mjs|cjs|ts|tsx|vue|svelte|py|go|rs|cs|php|rb|swift|dart)$/.test(relative))
    .sort();
  const observations = LAYOUT_GROUPS.map((group) => {
    const paths = sourceFiles.filter((relative) => group.match.test(relative));
    return { id: group.id, label: group.label, count: paths.length, examples: paths.slice(0, 3) };
  }).filter((entry) => entry.count > 0);
  const evidencePaths = [...new Set(observations.flatMap((entry) => entry.examples))].slice(0, 24);
  if (observations.length < 2 || evidencePaths.length < 3 || !observations.some((entry) => entry.count >= 3)) return null;
  try {
    const sourceDigests = Object.fromEntries(evidencePaths.map((relative) => [relative, sha256(readMemoryFile(scan.root, relative, 128 * 1024))]));
    const repository = slug(scan.projectName);
    return {
      id: `project-layout-${repository}-${sha256(scan.projectName).slice(0, 8)}`,
      status: 'candidate',
      kind: 'project-layout',
      skill: `docs/ai/skills/project-conventions/${repository}-layout/SKILL.md`,
      trigger: `Use when adding or moving production code in ${scan.projectName}.`,
      scope: ['.'],
      purpose: 'Preserve the project-local source layout after owner review.',
      why: `${observations.length} recurring source roles are visible in the current repository tree; these are observations, not inferred business rules.`,
      observations,
      counterEvidence: [],
      evidencePaths,
      sourceDigests,
      verificationCommands: scan.commands
        .filter((command) => command.verification?.purpose?.includes('verification'))
        .map((command) => verificationCommandEvidence(scan, command))
        .slice(0, 12),
      verificationBoundary: 'No project command was executed. Only structurally trusted commands are eligible for later explicit verification.',
      staleOnChange: 'Any source digest or command-source change invalidates the add/defer/reject receipt; request a fresh evidence-bound decision.',
    };
  } catch (error) {
    return { gap: { id: 'project-layout', reason: error.message, evidencePaths } };
  }
}

function projectSurfaceCandidates(scan, layout) {
  if (!layout || layout.gap) return [];
  return layout.observations
    .filter((observation) => observation.count >= 2 && observation.examples.length >= 2)
    .slice(0, 8)
    .map((observation) => {
      const evidencePaths = observation.examples;
      const sourceDigests = Object.fromEntries(evidencePaths.map((relative) => [relative, sha256(readMemoryFile(scan.root, relative, 128 * 1024))]));
      const repository = slug(scan.projectName);
      return {
        id: `project-surface-${repository}-${observation.id}`,
        status: 'candidate',
        kind: 'project-surface',
        surface: observation.id,
        label: observation.label,
        skill: `docs/ai/skills/project-conventions/${repository}-${observation.id}/SKILL.md`,
        trigger: `Use when changing ${observation.label} in ${scan.projectName}.`,
        scope: evidencePaths,
        purpose: `Preserve the observed ${observation.label} placement and neighboring implementation shape after owner review.`,
        why: `${observation.count} files match this source role; only the listed examples are evidence, and no business semantics are inferred.`,
        evidencePaths,
        sourceDigests,
        verificationCommands: layout.verificationCommands,
        verificationBoundary: layout.verificationBoundary,
        staleOnChange: layout.staleOnChange,
      };
    });
}

/** Repeated literal HTTP client calls are an observation, never an adopted rule. */
export function discoverProjectConventionCandidates(scan, memory) {
  const candidates = [];
  const gaps = [];
  const layout = projectLayoutCandidate(scan);
  if (layout?.gap) gaps.push(layout.gap);
  else if (layout) candidates.push(layout, ...projectSurfaceCandidates(scan, layout));
  const calls = memory.callSites ?? [];
  const styles = new Set(calls.map((entry) => entry.clientStyle));
  if (styles.size > 1) gaps.push({ id: 'project-api-client', reason: 'conflicting API client styles; owner review required', evidencePaths: [...new Set(calls.map((entry) => entry.path))] });
  else if (calls.length >= 2) {
    const evidencePaths = [...new Set(calls.map((entry) => entry.path))].sort();
    try {
      const sourceDigests = Object.fromEntries(evidencePaths.map((relative) => [relative, sha256(readMemoryFile(scan.root, relative, 128 * 1024))]));
      if (evidencePaths.some((relative) => memory.sources?.find((source) => source.path === relative)?.sha256 !== sourceDigests[relative])) throw new Error('stale memory source; rescan before proposing project conventions');
      candidates.push({ id: 'project-api-client', status: 'candidate', skill: 'docs/ai/skills/project-conventions/project-api-client/SKILL.md',
        trigger: `Use when changing HTTP client calls in ${evidencePaths.join(', ')}.`, scope: evidencePaths,
        purpose: 'Keep neighboring API call syntax consistent after review.',
        why: `At least two project call sites use ${calls[0].clientStyle}; this is repeated structural evidence, not a business or correctness claim.`,
        example: calls[0].example, counterExample: null, evidencePaths, sourceDigests,
        verificationBoundary: 'Unverified: inspect current source and neighboring tests; no project command was executed.',
        staleOnChange: 'Any source digest change invalidates the add/defer/reject receipt; request a fresh evidence-bound decision.',
      });
    } catch (error) { gaps.push({ id: 'project-api-client', reason: error.message, evidencePaths }); }
  }
  return { schemaVersion: 1, candidates, gaps };
}

export function projectConventionIssues(root, scan = null) {
  let catalog;
  try { catalog = JSON.parse(readMemoryFile(root, 'docs/ai/project-conventions.json')); }
  catch (error) { return error.code === 'ENOENT' ? [] : [{ status: 'invalid', reason: error.message }]; }
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.candidates) || catalog.candidates.length > 32) return [{ status: 'invalid', reason: 'Invalid project convention catalog' }];
  const issues = [];
  const current = scan ? discoverProjectConventionCandidates(scan, scanProjectMemoryFacts(scan)) : null;
  for (const candidate of catalog.candidates) {
    if (!candidate || !Array.isArray(candidate.evidencePaths) || candidate.evidencePaths.length > 160 || !candidate.sourceDigests || typeof candidate.sourceDigests !== 'object') { issues.push({ status: 'invalid', reason: 'Invalid project convention evidence' }); continue; }
    for (const relative of candidate.evidencePaths) {
      try {
        if (sha256(readMemoryFile(root, relative, 128 * 1024)) !== candidate.sourceDigests[relative]) issues.push({ status: 'stale', reason: `${candidate.id}: stale source ${relative}; fresh evidence-bound add/defer/reject decision required` });
      } catch (error) { issues.push({ status: 'invalid', reason: error.message }); }
    }
    if (current) {
      const refreshed = current.candidates.find((entry) => entry.id === candidate.id);
      if (!refreshed || adaptiveDecisionEvidenceHash(refreshed) !== adaptiveDecisionEvidenceHash(candidate)) {
        issues.push({ status: 'stale', reason: `${candidate.id}: observed project convention evidence changed; fresh evidence-bound add/defer/reject decision required` });
      }
    }
    if (typeof candidate.skill === 'string') try {
      const body = readMemoryFile(root, candidate.skill, 128 * 1024);
      if (/^(?:Current decision|当前决策):\s*(?:add|defer|reject)\s*$/im.test(body)) issues.push({ status: 'warning', reason: `${candidate.id}: embedded decision text is non-authoritative; use the evidence-bound adaptiveDecisions.skills receipt` });
    } catch (error) {
      if (error.code !== 'ENOENT') issues.push({ status: 'invalid', reason: error.message });
    }
  }
  return issues;
}

export function buildProjectConventionArtifacts(config, scan, memory) {
  const discovery = discoverProjectConventionCandidates(scan, memory);
  const artifacts = discovery.candidates.map((candidate) => {
    const zh = config.artifactLanguage === 'zh-CN';
    const receipt = config.adaptiveDecisions?.skills?.find((entry) => entry.id === candidate.id && entry.evidenceHash === adaptiveDecisionEvidenceHash(candidate));
    const adopted = receipt?.action === 'add';
    if (candidate.kind === 'project-surface') {
      const commandRows = candidate.verificationCommands.length
        ? candidate.verificationCommands.map((entry) => `| \`${entry.command}\` | ${zh ? '受影响行为和失败路径通过' : 'Affected behavior and failure paths pass'} | ${entry.trust.level === 'structurally-trusted' ? `\`${entry.cwd}\`` : (zh ? `尚未验证；${entry.trust.level}` : `not yet verified; ${entry.trust.level}`)} |`).join('\n')
        : `| ${zh ? '相邻行为测试' : 'Neighboring behavior test'} | ${zh ? '主要与失败路径通过' : 'Primary and failure paths pass'} | ${zh ? '尚未验证；未发现命令' : 'not yet verified; no command discovered'} |`;
      const content = `---
name: ${candidate.id}
description: ${zh ? `修改 ${scan.projectName} 的${candidate.label}时，评审并应用这个证据绑定的项目表面约定。` : candidate.trigger}
---

# ${scan.projectName}: ${candidate.label}

Status: ${adopted ? 'owner-approved for new code' : 'evidence-backed candidate, not adopted'}.

## When to use

- ${zh ? `新增、移动或评审${candidate.label}。` : candidate.trigger}
- ${zh ? '变更路径与下方证据位于同一项目表面。' : 'The changed path belongs to the same project surface as the evidence below.'}

## When not to use

- ${zh ? '不要把目录重复当成业务规则或跨仓库架构决定。' : 'Do not treat repeated directories as business rules or a cross-repository architecture decision.'}
- ${zh ? '没有当前证据的模块不自动继承本候选。' : 'A module without current evidence does not inherit this candidate automatically.'}

## Required invariants

- ${zh ? '新代码优先沿用最近的已验证同类实现；存在冲突时先请求负责人决定。' : 'Prefer the nearest verified implementation of the same role; request an owner decision when evidence conflicts.'}
- ${zh ? '传输、策略、持久化和界面职责不得因为目录相邻而混合。' : 'Transport, policy, persistence, and UI responsibilities do not merge merely because directories are adjacent.'}
- ${zh ? '不得借采纳本候选迁移既有代码。' : 'Adopting this candidate never authorizes an existing-code migration.'}

## Decision flow

1. ${zh ? '确认变更文件属于本表面并读取全部证据示例。' : 'Confirm the changed file belongs to this surface and read every evidence example.'}
2. ${zh ? '比较命名、输入输出、依赖方向、错误处理和测试形状；只保留一致模式。' : 'Compare naming, inputs/outputs, dependency direction, error handling, and test shape; retain only consistent patterns.'}
3. ${zh ? '发现反例或业务差异时记录 gap，不自动统一。' : 'Record a gap instead of normalizing automatically when counter-evidence or business differences exist.'}
4. ${zh ? '获得与当前 evidenceHash 绑定的 add 回执后，才把候选用于新代码。' : 'Apply the candidate to new code only after an add receipt is bound to the current evidenceHash.'}

## Exceptions and escalation

- ${zh ? '新边界、跨仓库契约或业务不变量需要单独的架构或业务决定。' : 'A new boundary, cross-repository contract, or business invariant needs a separate architecture or business decision.'}
- ${zh ? '证据文件改变后，旧回执失效并重新预览。' : 'A source change invalidates the old receipt and requires a fresh preview.'}

## Verification matrix

| ${zh ? '场景' : 'Scenario'} | ${zh ? '期望结果' : 'Expected result'} | ${zh ? '命令或证据状态' : 'Command or evidence status'} |
| --- | --- | --- |
${commandRows}

## Project evidence boundary

- ${zh ? '先读取以下相邻实现再写新代码；命名、分层与依赖方向与它们保持一致。' : 'Read these neighboring implementations before writing new code; keep naming, layering, and dependency direction consistent with them.'}
${candidate.evidencePaths.map((relative) => `- \`${relative}\``).join('\n')}
- ${zh ? '上述路径只证明结构重复，不证明运行时正确或业务含义；内容摘要保存在 docs/ai/project-conventions.json，漂移由 aicg check 报告。' : 'These paths prove structural repetition, not runtime correctness or business meaning; content digests live in docs/ai/project-conventions.json and drift is reported by aicg check.'}

## Sources

- \`docs/ai/project-conventions.json\` — ${zh ? '候选目录与证据摘要' : 'candidate catalog and evidence digests'}.
- \`.ai-governance/config.json\` — ${zh ? '证据绑定的负责人决定' : 'evidence-bound owner decision'}.

<!-- evidenceHash: ${adaptiveDecisionEvidenceHash(candidate)} -->
`;
      assertSkillQuality(content, { profile: 'workflow', id: candidate.id });
      return { path: candidate.skill, ownership: adopted ? 'full' : 'seed', kind: adopted ? 'project-convention-skill' : 'project-convention-candidate', source: 'project-convention-evidence', adopted, content };
    }
    if (candidate.kind === 'project-layout') {
      const verificationRows = candidate.verificationCommands.length
        ? candidate.verificationCommands.map((entry) => `| \`${entry.command}\` | \`${entry.cwd}\` | ${entry.trust.level} | ${entry.trust.reasons.map((reason) => reason.code).join(', ') || '-'} |`).join('\n')
        : `| - | - | unverified | ${zh ? '未发现验证入口' : 'no verification entrypoint discovered'} |`;
      const content = `---
name: ${candidate.id}
description: ${zh ? `修改 ${scan.projectName} 的源码布局、分层或模块边界时使用。` : candidate.trigger}
---

# ${zh ? `${scan.projectName} 项目约定` : `${scan.projectName} project conventions`}

${zh ? `状态：${adopted ? '所有者已批准为新代码标准' : '基于证据的候选，尚未采纳'}。权威决定保存在 .ai-governance/config.json 的 adaptiveDecisions.skills 中。本 Skill 不推断业务规则。` : `Status: ${adopted ? 'owner-approved for new code' : 'evidence-backed candidate, not adopted'}. The authoritative decision is stored in adaptiveDecisions.skills in .ai-governance/config.json. This Skill does not infer business rules.`}

## ${zh ? '何时使用' : 'When to use'}

${zh ? `在 ${scan.projectName} 中新增、移动或评审生产代码时使用。` : candidate.trigger}

## ${zh ? '何时不使用' : 'When not to use'}

${zh ? '不要把本 Skill 当作业务需求、跨仓库架构授权或既有代码迁移许可。' : 'Do not use this Skill as a business requirement, cross-repository architecture decision, or authorization to migrate existing code.'}

## ${zh ? '当前观察到的模式' : 'Observed current patterns'}

${candidate.observations.map((entry) => `- ${entry.label}: ${entry.count} ${zh ? '个文件；示例' : 'files; examples'} ${entry.examples.map((relative) => `\`${relative}\``).join(', ')}`).join('\n')}

## ${zh ? '已批准的新代码决定' : 'Approved new-code decisions'}

${adopted
    ? (zh ? '- 新代码优先沿用上述相邻目录角色；出现反例或需要新边界时先重新评审，不强制迁移既有代码。' : '- New code should follow the neighboring observed directory roles. Re-review counter-evidence or a new boundary; do not migrate existing code implicitly.')
    : (zh ? '- 无。需要在精确预览中对当前证据执行 add 决策。' : '- None. An exact preview must record an add decision for the current evidence.')}

## ${zh ? '已确认业务不变量' : 'Confirmed business invariants'}

- ${zh ? '无；路径重复不能证明业务语义。' : 'None; repeated paths do not prove business semantics.'}

## ${zh ? '冲突与未验证缺口' : 'Conflicts and unverified gaps'}

- ${candidate.counterEvidence.length ? candidate.counterEvidence.join('\n- ') : (zh ? '未运行项目测试，也未验证运行时行为。' : 'Project tests were not run and runtime behavior was not verified.')}

## ${zh ? '验证矩阵' : 'Verification matrix'}

| Command | cwd | Trust | Reasons |
| --- | --- | --- | --- |
${verificationRows}

## ${zh ? '证据目录' : 'Evidence catalog'}

- ${zh ? '变更落点与下列示例同层时，先比对最近的同类实现再动手。' : 'When a change lands on the same layer as the examples below, compare the nearest implementation of the same role before writing.'}
${candidate.evidencePaths.map((relative) => `- \`${relative}\``).join('\n')}
- ${zh ? '内容摘要不在本文件维护；保存在 docs/ai/project-conventions.json，aicg check 在证据漂移时报告。' : 'Content digests are not maintained in this file; they live in docs/ai/project-conventions.json, and aicg check reports evidence drift.'}

${zh ? '证据或命令来源变化后，当前决定立即失效，必须重新预览。' : candidate.staleOnChange}

<!-- evidenceHash: ${adaptiveDecisionEvidenceHash(candidate)} -->
`;
      return { path: candidate.skill, ownership: adopted ? 'full' : 'seed', kind: adopted ? 'project-convention-skill' : 'project-convention-candidate', source: 'project-convention-evidence', adopted, content };
    }
    const prose = zh ? {
      trigger: `仅在修改这些路径中的 HTTP 客户端调用时评审：${candidate.evidencePaths.join(', ')}。`,
      purpose: '经评审确认后，保持相邻 API 调用语法一致。',
      why: '至少两个项目调用点使用相同风格；这是重复的结构证据，不代表业务语义或正确性已经验证。',
      verificationBoundary: '尚未验证：检查当前源码及相邻测试；生成器没有执行项目命令。',
      staleOnChange: '任一来源摘要变化都会使 add/defer/reject 回执失效；必须根据新证据重新决策。',
    } : candidate;
    return { path: candidate.skill, ownership: adopted ? 'full' : 'seed', kind: adopted ? 'project-convention-skill' : 'project-convention-candidate', source: 'project-convention-evidence', adopted,
      content: `---\nname: ${candidate.id}\ndescription: ${zh ? '仅在修改证据路径中的 HTTP 客户端调用且审批有效时，评审此项目约定候选。' : candidate.trigger}\n---\n\n# ${zh ? '项目约定候选' : 'Project convention candidate'}\n\n${zh
        ? `状态：${adopted ? '所有者已批准为新代码标准' : '候选，尚未采纳'}。add/defer/reject 决策必须绑定证据；不得自动执行或提升。`
        : `Status: ${adopted ? 'owner-approved for new code' : 'candidate, not adopted'}. Bind add/defer/reject decisions to evidence; never execute or promote automatically.`}\n\n${zh ? '决策来源：以 .ai-governance/config.json 中证据绑定的 adaptiveDecisions.skills 回执为准；此 seed 不缓存可变动作。' : 'Decision source: the evidence-bound adaptiveDecisions.skills receipt in .ai-governance/config.json is authoritative; this seed does not cache a mutable action.'}\n\n## Trigger / Scope\n\n${prose.trigger}\n\n## Purpose\n\n${prose.purpose}\n\n## Why\n\n${prose.why}\n\n## Project-local example\n\n\`\`\`javascript\n${candidate.example}\n\`\`\`\n\n## Approved new-code decisions\n\n${adopted ? (zh ? '- 新代码应优先沿用上述相邻调用风格；不得据此迁移既有代码或推断业务语义。' : '- New code should prefer the neighboring observed call style; this does not authorize existing-code migration or imply business semantics.') : (zh ? '- 无；当前证据尚未获得 add 回执。' : '- None; the current evidence has no add receipt.')}\n\n## Evidence\n\n- ${zh ? '修改下列文件中的调用前，先确认相邻调用仍使用同一风格。' : 'Before changing a call in the files below, confirm the neighboring calls still use the same style.'}\n${candidate.evidencePaths.map((relative) => `- ${relative}`).join('\n')}\n- ${zh ? '内容摘要保存在 docs/ai/project-conventions.json；aicg check 报告证据漂移。' : 'Content digests live in docs/ai/project-conventions.json; aicg check reports evidence drift.'}\n\n## Verification\n\n${prose.verificationBoundary}\n\n## Freshness\n\n${prose.staleOnChange}\n\n<!-- evidenceHash: ${adaptiveDecisionEvidenceHash(candidate)} -->\n` };
  });
  if (discovery.candidates.length || discovery.gaps.length) artifacts.unshift({ path: 'docs/ai/project-conventions.json', content: stableJson(discovery), ownership: 'seed', kind: 'project-convention-index', source: 'project-convention-evidence', adopted: false });
  if (artifacts.some((artifact) => artifact.adopted === true)) {
    const adoptedIds = new Set(discovery.candidates
      .filter((candidate) => config.adaptiveDecisions?.skills?.some((entry) => entry.id === candidate.id && entry.action === 'add' && entry.evidenceHash === adaptiveDecisionEvidenceHash(candidate)))
      .map((candidate) => candidate.id));
    const seedConfig = {
      ...config,
      adaptiveDecisions: {
        ...(config.adaptiveDecisions ?? { schemaVersion: 1, roles: [] }),
        skills: (config.adaptiveDecisions?.skills ?? []).filter((entry) => !adoptedIds.has(entry.id)),
      },
    };
    const seedByPath = new Map(buildProjectConventionArtifacts(seedConfig, scan, memory).artifacts.map((artifact) => [artifact.path, artifact]));
    for (const artifact of artifacts.filter((entry) => entry.adopted === true)) artifact.promotionSourceSha256 = sha256(seedByPath.get(artifact.path)?.content ?? '');
  }
  return { ...discovery, artifacts };
}

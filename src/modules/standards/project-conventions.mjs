import { sha256, stableJson } from '../../shared/index.mjs';
import { readMemoryFile } from '../memory/index.mjs';
import { adaptiveDecisionEvidenceHash } from '../skills/index.mjs';

/** Repeated literal HTTP client calls are an observation, never an adopted rule. */
export function discoverProjectConventionCandidates(scan, memory) {
  const candidates = [];
  const gaps = [];
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

export function projectConventionIssues(root) {
  let catalog;
  try { catalog = JSON.parse(readMemoryFile(root, 'docs/ai/project-conventions.json')); }
  catch (error) { return error.code === 'ENOENT' ? [] : [{ status: 'invalid', reason: error.message }]; }
  if (catalog?.schemaVersion !== 1 || !Array.isArray(catalog.candidates) || catalog.candidates.length > 32) return [{ status: 'invalid', reason: 'Invalid project convention catalog' }];
  const issues = [];
  for (const candidate of catalog.candidates) {
    if (!candidate || !Array.isArray(candidate.evidencePaths) || candidate.evidencePaths.length > 160 || !candidate.sourceDigests || typeof candidate.sourceDigests !== 'object') { issues.push({ status: 'invalid', reason: 'Invalid project convention evidence' }); continue; }
    for (const relative of candidate.evidencePaths) {
      try {
        if (sha256(readMemoryFile(root, relative, 128 * 1024)) !== candidate.sourceDigests[relative]) issues.push({ status: 'stale', reason: `${candidate.id}: stale source ${relative}; fresh evidence-bound add/defer/reject decision required` });
      } catch (error) { issues.push({ status: 'invalid', reason: error.message }); }
    }
  }
  return issues;
}

export function buildProjectConventionArtifacts(config, scan, memory) {
  const discovery = discoverProjectConventionCandidates(scan, memory);
  const artifacts = discovery.candidates.map((candidate) => {
    const receipt = config.adaptiveDecisions?.skills?.find((entry) => entry.id === candidate.id && entry.evidenceHash === adaptiveDecisionEvidenceHash(candidate));
    const zh = config.artifactLanguage === 'zh-CN';
    const prose = zh ? {
      trigger: `仅在修改这些路径中的 HTTP 客户端调用时评审：${candidate.evidencePaths.join(', ')}。`,
      purpose: '经评审确认后，保持相邻 API 调用语法一致。',
      why: '至少两个项目调用点使用相同风格；这是重复的结构证据，不代表业务语义或正确性已经验证。',
      verificationBoundary: '尚未验证：检查当前源码及相邻测试；生成器没有执行项目命令。',
      staleOnChange: '任一来源摘要变化都会使 add/defer/reject 回执失效；必须根据新证据重新决策。',
    } : candidate;
    return { path: candidate.skill, ownership: 'seed', kind: 'project-convention-candidate', source: 'project-convention-evidence',
      content: `---\nname: ${candidate.id}\ndescription: ${zh ? '仅在修改证据路径中的 HTTP 客户端调用且审批有效时，评审此项目约定候选。' : candidate.trigger}\n---\n\n# ${zh ? '项目约定候选' : 'Project convention candidate'}\n\n${zh ? '状态：候选，尚未采纳。add/defer/reject 决策必须绑定证据；不得自动执行或提升。' : 'Status: candidate, not adopted. Bind add/defer/reject decisions to evidence; never execute or promote automatically.'}\n\n${zh ? '当前决策' : 'Current decision'}: ${receipt?.action ?? 'defer'}\n\n## Trigger / Scope\n\n${prose.trigger}\n\n## Purpose\n\n${prose.purpose}\n\n## Why\n\n${prose.why}\n\n## Project-local example\n\n\`\`\`javascript\n${candidate.example}\n\`\`\`\n\n## Evidence\n\n${candidate.evidencePaths.map((relative) => `- ${relative}: ${candidate.sourceDigests[relative]}`).join('\n')}\n\n## Verification\n\n${prose.verificationBoundary}\n\n## Freshness\n\n${prose.staleOnChange}\n\n<!-- evidenceHash: ${adaptiveDecisionEvidenceHash(candidate)} -->\n` };
  });
  if (discovery.candidates.length || discovery.gaps.length) artifacts.unshift({ path: 'docs/ai/project-conventions.json', content: stableJson(discovery), ownership: 'seed', kind: 'project-convention-index', source: 'project-convention-evidence' });
  return { ...discovery, artifacts };
}

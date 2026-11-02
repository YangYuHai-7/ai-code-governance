import path from 'node:path';
import { readBoundedRepositoryFile, assertNoLinkAncestor } from '../../preconditions.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/index.mjs';
import { loadTestCaseManifest } from '../testing/index.mjs';
import { prepareDeliveryArtifacts } from './delivery-preparation.mjs';
import { evaluateArchitectureApproval } from './architecture-approval.mjs';
import { ARCHITECTURE_DOCUMENT, architectureDocumentSource } from './architecture-documentation.mjs';
import { hasDocumentableDevelopmentUnit } from '../repository/index.mjs';

const PLACEHOLDER = /\b(?:TODO|TBD|FIXME)\b(?![-_])|待补充|待补证据|依据已确认需求、项目源码和测试补全|This scaffold|Replace from project evidence|Content and component states require design/;
// Recognize definition rows, not incidental ID mentions in narrative or copied case lists.
const REQUIREMENT = /^[ \t]*(?:[-*|][ \t]+|#{1,6}[ \t]+)?(?:\*\*|`)?([A-Z][A-Z0-9]*(?:[-_][A-Z0-9]+)+)(?:\*\*|`)?(?:[ \t]*[:：|]|[ \t]+(?=\S))/gm;
const LABELS = {
  actors: /actors?|permissions?|角色|参与者|权限/i,
  rules: /business rules?|业务规则/i,
  acceptance: /acceptance|验收/i,
  modules: /modules?|file responsibilities|模块|文件职责/i,
  verification: /verification|验证|测试命令/i,
  tokens: /tokens?|colou?r|typography|颜色|字体|间距/i,
  states: /components?|states?|组件|状态/i,
};

function section(source, label) {
  let active = false;
  const lines = [];
  for (const line of source.split(/\r?\n/)) {
    if (/^#{1,6}\s/.test(line)) active = label.test(line);
    else if (active && line.trim()) lines.push(line);
  }
  return lines.join('\n').trim();
}

function body(source) {
  return source.split(/\r?\n/).filter((line) => !/^#|^Status:|^状态：|^Task:/.test(line)).join('\n').replace(/\s+/g, ' ').trim();
}

// This reads selected artifacts only. It does not run tests or authenticate document claims.
export function assessDeliveryArtifacts(root, options) {
  const prepared = prepareDeliveryArtifacts(root, { ...options, write: false });
  const selected = [...prepared.files, ...prepared.references].filter((entry) => entry.id !== 'verification-report');
  const findings = [];
  const artifacts = [];
  const documents = new Map();
  const issue = (artifact, code, message) => findings.push({ artifact: artifact.id, path: artifact.path, code, message });
  for (const artifact of selected) {
    const entry = { id: artifact.id, path: artifact.path, authority: artifact.authority ?? 'project-native' };
    artifacts.push(entry);
    let source;
    try { source = readBoundedRepositoryFile(root, artifact.path, 512 * 1024).bytes.toString('utf8'); }
    catch (error) {
      if (error.code !== 'ENOENT') throw error;
      issue(entry, 'missing-artifact', 'Complete the selected artifact before implementation.');
      continue;
    }
    documents.set(entry.id, { ...entry, source });
    if (!source.trim()) issue(entry, 'empty-artifact', 'The selected artifact is empty.');
    if (PLACEHOLDER.test(source)) issue(entry, 'placeholder', 'Resolve template markers and draft evidence gaps.');
  }
  const seen = new Map();
  for (const document of documents.values()) {
    if (!['ba', 'development-plan', 'product-design', 'technical-design'].includes(document.id)) continue;
    const normalized = body(document.source);
    if (normalized && seen.has(normalized)) issue(document, 'duplicate-body', `Content duplicates ${seen.get(normalized)}; write the artifact's specific decisions.`);
    if (normalized) seen.set(normalized, document.id);
  }
  const ba = documents.get('ba');
  const requirementIds = new Set([...((ba?.source ?? '').matchAll(REQUIREMENT))].map((match) => match[1]));
  const requireSection = (document, label, code) => {
    if (!section(document.source, LABELS[label])) issue(document, code, `Add substantive ${label} content under an identifiable heading.`);
  };
  if (ba) {
    for (const label of ['actors', 'rules', 'acceptance']) requireSection(ba, label, `missing-${label}`);
    if (!requirementIds.size) issue(ba, 'missing-requirement-ids', 'Define business requirements with stable domain identifiers such as MEMBER-001 or MEMBER_NAME in definition rows.');
  }
  const plan = documents.get('development-plan');
  if (plan) {
    requireSection(plan, 'modules', 'missing-modules');
    requireSection(plan, 'verification', 'missing-verification');
  }
  const design = documents.get('product-design');
  if (design) {
    const inherited = prepared.references.some((entry) => entry.id === 'product-design');
    if (inherited) {
      requireSection(design, 'tokens', 'missing-design-tokens');
      requireSection(design, 'states', 'missing-design-states');
    }
    let localSources = 0;
    const links = [...design.source.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map((match) => match[1]);
    for (const link of links) {
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
      const relative = normalizeRelative(path.posix.join(path.posix.dirname(design.path), link.split('#')[0]));
      if (!isSafeRelative(relative) || relative.split('/').some((part) => part.toLowerCase() === '.git')) {
        issue(design, 'unsafe-source', 'Design evidence must use safe repository-relative sources.');
        continue;
      }
      assertNoLinkAncestor(root, relative);
      try { readBoundedRepositoryFile(root, relative, 512 * 1024); localSources += 1; }
      catch (error) { if (error.code !== 'ENOENT') throw error; issue(design, 'missing-source', `Missing design evidence: ${relative}.`); }
    }
    if (!inherited && !localSources) issue(design, 'missing-design-evidence', 'Link to observed source files or an existing design specification; a prose claim alone is not source evidence.');
  }
  const architecture = documents.get('architecture');
  if (architecture) {
    const views = [/system overview|系统总览/i, /module architecture|模块架构/i, /(?:core )?business flow|核心业务流程|业务流程/i];
    const diagrams = views.map((view) => section(architecture.source, view).match(/```mermaid\s*\n([\s\S]*?)```/)?.[1]?.trim());
    if (diagrams.some((diagram) => !diagram || !/^(?:flowchart|graph|sequenceDiagram)\b/m.test(diagram) || !/(?:-->|->>|==>|---)/.test(diagram))) {
      issue(architecture, 'missing-architecture-views', 'Provide distinct system overview, module architecture and core business flow Mermaid views with relationships and explanatory prose.');
    }
    const distinct = diagrams.filter(Boolean).map((diagram) => diagram.replace(/\s+/g, ' '));
    if (new Set(distinct).size !== distinct.length) issue(architecture, 'duplicate-architecture-views', 'Different views must not repeat the same diagram.');
    if (!/failure|reject|denied|invalid|error|失败|拒绝|无权|错误|权限不足/i.test(diagrams[2] ?? '')) {
      issue(architecture, 'missing-negative-flow', 'Document a failure or permission branch in the selected business flow.');
    }
    let evidence = 0;
    for (const match of architecture.source.matchAll(/\[[^\]]*\]\(<?([^)>]+)>?\)/g)) {
      const link = match[1];
      if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(link)) continue;
      const relative = normalizeRelative(path.posix.join(path.posix.dirname(architecture.path), link.split('#')[0]));
      if (!isSafeRelative(relative) || relative.split('/').some((part) => part.toLowerCase() === '.git')) {
        issue(architecture, 'unsafe-source', 'Architecture references must remain inside the repository and outside .git.');
        continue;
      }
      assertNoLinkAncestor(root, relative);
      try { readBoundedRepositoryFile(root, relative, 512 * 1024); evidence += 1; }
      catch (error) { if (error.code !== 'ENOENT') throw error; issue(architecture, 'missing-source', `Missing architecture evidence: ${relative}.`); }
    }
    if (!evidence) issue(architecture, 'missing-architecture-evidence', 'Link material nodes and relationships to repository sources or requirement/decision documents; prose alone is insufficient.');
  }
  const cases = documents.get('module-test-cases');
  if (cases) {
    try {
      const raw = JSON.parse(cases.source);
      if (Array.isArray(raw.cases) && !raw.cases.length) issue(cases, 'empty-cases', 'Add behavior-specific module cases before implementation.');
      const manifest = loadTestCaseManifest(root, raw);
      if (ba) for (const testCase of manifest.cases) {
        for (const id of testCase.sourceIds) if (!requirementIds.has(id)) issue(cases, 'unresolved-requirement', `${testCase.id} source ${id} has no matching identifier in the selected BA.`);
      }
    } catch (error) { issue(cases, 'invalid-cases', error.message); }
  }
  const confirmationRequired = ['L2', 'L3'].includes(prepared.level)
    && (options.delivery.lifecycle === 'greenfield' || selected.some((entry) => entry.id === 'architecture'));
  const approval = confirmationRequired && !findings.length ? evaluateArchitectureApproval(root, {
    prepared, text: options.text, lifecycle: options.delivery.lifecycle,
    approvalEvidence: options.approvalEvidence, approve: options.approve,
  }) : null;
  return { schemaVersion: 1, scope: options.scope, level: prepared.level,
    readiness: !selected.length ? 'not-required' : findings.length ? 'needs-content' : 'structurally-ready',
    acceptance: 'not-assessed', artifacts, findings,
    ...(architecture ? { diagramRendering: 'unverified' } : {}),
    ...(confirmationRequired ? { approval, implementationReadiness: findings.length ? 'needs-content'
      : approval?.ok ? 'approved-scope-operator-declared' : 'awaiting-customer-confirmation' } : {}),
    limitations: ['Structural heuristics do not prove business accuracy, source authenticity, design quality, requirement completeness or owner approval.', 'No commands or tests are executed. Fresh runtime evidence and visual/user evaluation remain separate.'] };
}

/** Optional documentation gaps are advisory and independent of business Memory choices. */
export function assessProjectArchitecture(scan, config) {
  if (config?.features?.architectureDocumentation !== true) return null;
  const relative = architectureDocumentSource(scan);
  if (!relative && config.initialization?.lifecycle === 'existing' && !hasDocumentableDevelopmentUnit(scan)) return null;
  if (!relative) return { readiness: 'needs-content', acceptance: 'not-assessed', findings: [{ artifact: 'architecture',
    path: ARCHITECTURE_DOCUMENT, code: 'missing-artifact', message: 'Complete the selected project architecture and business-flow views.' }] };
  return assessDeliveryArtifacts(scan.root, { delivery: { level: 'L0', lifecycle: config.initialization?.lifecycle,
    artifacts: [{ id: 'architecture', mode: 'reference', path: relative }] }, scope: 'PROJECT_ARCHITECTURE', text: 'Review project architecture documentation' });
}

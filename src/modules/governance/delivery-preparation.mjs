import fs from 'node:fs';
import path from 'node:path';
import { assertNoLinkAncestor } from '../../preconditions.mjs';
import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative, normalizeRelative, sha256 } from '../../shared/index.mjs';
import { defaultTestCaseManifest } from '../testing/index.mjs';
import { architectureDocument } from './architecture-documentation.mjs';

const SECTIONS = {
  ba: ['Business problem and measurable outcome', 'Actors and permissions', 'Current and target flow', 'Business rules and terminology', 'Scope and non-goals', 'Acceptance criteria and requirement IDs', 'Assumptions and owner questions'],
  'development-plan': ['Approved requirements and design references', 'Module and file responsibilities', 'Dependencies and implementation steps', 'Verification commands and expected results', 'Compatibility and rollback', 'Owner decisions'],
  'product-design': ['Existing design sources and observed evidence', 'Information architecture and user journey', 'Color, typography, spacing and component tokens', 'Components and responsive behavior', 'Loading, empty, error and permission states', 'Accessibility and visual acceptance', 'Conflicts and owner decisions'],
  'technical-design': ['Architecture options and selected rationale', 'Module ownership and public interfaces', 'Programming conventions and directory structure', 'Data, authorization and error contracts', 'Versions, licenses and external costs', 'Migration, compatibility and rollback', 'Verification and unresolved decisions'],
  reproduction: ['Original symptom', 'Environment and minimal reproduction', 'Expected versus actual result', 'Failing regression case'],
  'root-cause': ['Observed evidence and affected boundary', 'Hypothesis and discriminating experiment', 'Confirmed cause', 'Bounded fix and regression scope'],
  'verification-report': ['Commands, environment and revision', 'Case IDs and actual results', 'Retained evidence paths', 'Failed, blocked and not-run cases', 'Automated, simulated-human and real-user distinction', 'Remaining gaps'],
};

function safe(root, relative) {
  if (!isSafeRelative(relative) || normalizeRelative(relative) !== relative || relative.split('/').some((part) => part.toLowerCase() === '.git')) throw usageError('Preparation requires safe repository-relative paths.');
  assertNoLinkAncestor(root, relative);
  return path.join(root, relative);
}

/** Create only missing preparation artifacts; a retry never overwrites owner content. */
export function prepareDeliveryArtifacts(root, { delivery, scope, text, caseRoot = 'docs/ai/testing', caseFormat = 'aicg-json-v2', reportRoot = 'reports/testing', language = 'en', write = false } = {}) {
  if (!/^[A-Z0-9][A-Z0-9_-]{0,63}$/.test(scope ?? '')) throw usageError('Preparation scope must use 1-64 uppercase letters, digits, underscores or dashes.');
  if (!['aicg-json-v2', 'markdown-plus-json'].includes(caseFormat)) throw usageError('Preparation test-case format must be aicg-json-v2 or markdown-plus-json.');
  const base = `docs/changes/${scope}`;
  const references = [];
  const files = [];
  const addFile = (id, relative, content) => {
    const target = safe(root, relative);
    const exists = fs.existsSync(target);
    if (exists && !fs.lstatSync(target).isFile()) throw usageError(`Preparation destination must be a regular file: ${relative}`);
    files.push({ id, path: relative, action: exists ? 'keep' : 'create', status: 'needs-evidence', content, target });
  };
  for (const artifact of delivery.artifacts) {
    if (artifact.mode === 'reference') {
      if (artifact.authority === 'openspec' && artifact.path === 'openspec/changes') throw usageError('OpenSpec authority is unresolved: bind active_change and implementation_task_list to a specific change and its task document before preparation.');
      const target = safe(root, artifact.path);
      if (!fs.existsSync(target)) throw usageError(`Missing authoritative artifact: ${artifact.path}`);
      if (!fs.lstatSync(target).isFile()) throw usageError(`Authoritative artifact must be a regular file: ${artifact.path}`);
      references.push({ ...artifact, status: 'referenced-unverified' });
      continue;
    }
    const relative = artifact.id === 'module-test-cases' ? `${caseRoot}/${scope}-${caseFormat === 'markdown-plus-json' ? 'execution' : 'test-cases'}.json`
      : artifact.id === 'verification-report' ? `${reportRoot}/${scope}-test-report.md`
        : `${base}/${artifact.id === 'visual-preview' ? 'visual-preview.html' : `${artifact.id}.md`}`;
    let content;
    if (artifact.id === 'module-test-cases') {
      const manifest = defaultTestCaseManifest({ scope, locale: language === 'zh-CN' ? language : 'en', evidenceDir: `${reportRoot}/evidence/${scope}` });
      content = `${JSON.stringify(manifest, null, 2)}\n`;
      if (caseFormat === 'markdown-plus-json') {
        const baseline = language === 'zh-CN'
          ? `# ${scope} 测试用例基线\n\n状态：草稿 / 待补证据。模板不代表负责人批准或行为验证。\n\n执行清单：[${scope}-execution.json](${scope}-execution.json)\n\n## 测试依据\n\nTODO：补全已确认需求、模块边界及需求 ID。\n\n## 用例与覆盖\n\n沿用执行清单中的稳定 Case ID，按模块整理用例和覆盖决策。通过 imports 引用公共角色、环境和数据，避免重复维护。\n`
          : `# ${scope} test-case baseline\n\nStatus: draft / needs-evidence. This scaffold is not owner approval or verified behavior.\n\nExecution manifest: [${scope}-execution.json](${scope}-execution.json)\n\n## Test basis\n\nTODO: document confirmed requirements, module boundaries and requirement IDs.\n\n## Cases and coverage\n\nKeep stable Case IDs from the execution manifest and organize cases and coverage decisions by module. Use imports for shared actors, environments and data rather than duplicating context.\n`;
        addFile('module-test-baseline', `${caseRoot}/${scope}-test-cases.md`, baseline);
      }
    } else if (artifact.id === 'architecture') {
      content = architectureDocument({ lifecycle: delivery.lifecycle, text, language, relative });
    } else if (artifact.id === 'visual-preview') {
      content = '<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Design review draft</title><body><h1>Design review draft</h1><p>Unverified wireframe. Replace from project evidence before owner review.</p><nav aria-label="Proposed navigation">Navigation</nav><main><h2>Primary user task</h2><p>Content and component states require design.</p><button disabled>Primary action (draft)</button></main></body></html>\n';
    } else {
      const sections = SECTIONS[artifact.id] ?? ['Evidence and decisions'];
      content = `# ${scope}: ${artifact.id}\n\nStatus: draft / needs-evidence. This scaffold is not owner approval or verified behavior.\n\nTask: ${String(text).replace(/[\r\n]+/g, ' ')}\n\n${sections.map((section) => `## ${section}\n\nTODO: complete from confirmed intent, repository sources and tests.\n`).join('\n')}`;
      if (language === 'zh-CN') content = content.replace('Status: draft / needs-evidence. This scaffold is not owner approval or verified behavior.', '状态：草稿 / 待补证据。模板不代表负责人批准或行为验证。').replaceAll('TODO: complete from confirmed intent, repository sources and tests.', 'TODO：依据已确认需求、项目源码和测试补全，并引用证据。');
    }
    addFile(artifact.id, relative, content);
  }
  // Validate the complete set before any write. Exclusive creation protects concurrent edits.
  const created = [];
  try {
    if (write) for (const file of files.filter((entry) => entry.action === 'create')) {
      assertNoLinkAncestor(root, file.path);
      fs.mkdirSync(path.dirname(file.target), { recursive: true });
      fs.writeFileSync(file.target, file.content, { flag: 'wx' });
      created.push(file);
    }
  } catch (error) {
    for (const file of created) {
      // Restore only bytes written by this invocation; retain a concurrent user edit.
      if (fs.existsSync(file.target) && fs.lstatSync(file.target).isFile() && sha256(fs.readFileSync(file.target)) === sha256(file.content)) fs.unlinkSync(file.target);
    }
    throw error;
  }
  return { schemaVersion: 1, status: write ? 'prepared-needs-evidence' : 'preview', level: delivery.level, scope, references,
    files: files.map(({ content, target, ...file }) => file), readiness: 'unverified',
    next: 'Complete the selected artifacts from project evidence, then run delivery assess with the same text, scope and paths for structural content findings. Reuse module Case IDs and shared-context imports. Review scope-changing questions before implementation; record fresh execution evidence before completion. Structural readiness is not acceptance.' };
}

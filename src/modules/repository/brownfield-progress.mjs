import { readBoundedRepositoryFile } from '../../adapters/filesystem/index.mjs';
import { isMemoryCodePath, loadProjectMemory } from '../memory/index.mjs';
import { hasDocumentableDevelopmentUnit } from './development-documentation.mjs';

const BASELINE = /code-scan understanding baseline|代码扫描生成的理解基线|## AI completion required from code evidence|## 待 AI 依据代码补全/;

function read(root, relative) {
  try { return readBoundedRepositoryFile(root, relative, 2 * 1024 * 1024).bytes.toString('utf8'); }
  catch { return null; }
}

export function brownfieldProgress(scan, config) {
  if (config?.initialization?.lifecycle !== 'existing') return null;
  const gaps = [];
  // A repository with neither code nor a build manifest has no code-backed behavior to
  // document and no business memory to own. Repository-family orchestrator parents and
  // documentation-only repositories land here. Enforcing the development-documentation
  // and Memory-ownership contracts on them forces placeholder artifacts that carry no
  // evidence - a page explaining the absence of the code it is meant to describe. Those
  // contracts are reported as not applicable, with the reason stated, so the condition
  // stays visible instead of being silently skipped.
  const documentable = hasDocumentableDevelopmentUnit(scan);
  let index;
  try { index = JSON.parse(read(scan.root, 'docs/ai/development/index.json')); }
  catch { if (documentable) gaps.push('development index is missing or invalid'); }
  const units = Array.isArray(index?.units) ? index.units : [];
  if (documentable && !units.length) gaps.push('no development units are indexed');
  if (documentable) for (const unit of units) {
    const doc = read(scan.root, unit.documentation);
    if (!doc || BASELINE.test(doc) || !/## (?:Evidence-reviewed behavior|已核对的业务行为)/.test(doc)
      || !/## (?:Local development workflow|本地开发流程)/.test(doc)) {
      gaps.push(`${unit.documentation}: complete the code-backed behavior and local development workflow`);
    }
  }
  let memory;
  try { memory = loadProjectMemory(scan.root); }
  catch { if (documentable) gaps.push('business memory index is invalid'); }
  if (documentable) {
    if (!memory?.modules?.length) gaps.push('business memory has no owned modules');
    else for (const module of memory.modules) {
      if (!module.summary?.text?.trim() || !module.summary.verifiedFrom?.length) gaps.push(`${module.memoryPage}: business summary needs source evidence`);
      const page = read(scan.root, module.memoryPage);
      if (!page || /Unverified; Agent-authored summary|尚未验证；Agent 应提供/.test(page)) gaps.push(`${module.memoryPage}: owning page remains a scan placeholder`);
    }
    const ownedPaths = new Set((memory?.modules ?? []).flatMap((module) => module.owns ?? []));
    const unowned = scan.files.filter((file) => file.type === 'file' && isMemoryCodePath(file.relative) && !ownedPaths.has(file.relative));
    if (unowned.length) gaps.push(`${unowned.length} production source file(s) lack business Memory ownership; first: ${unowned[0].relative}`);
  }
  let managed = [];
  try { managed = JSON.parse(read(scan.root, '.ai-governance/manifest.json')).files.map((entry) => entry.path); }
  catch { /* The governance checker reports an invalid manifest separately. */ }
  const projectSkills = config.skillDiscovery?.decision?.status === 'approved'
    ? (config.skillDiscovery.decision.candidates ?? []).filter((candidate) => candidate.sourceKind === 'project'
      && ['approved', 'applied', 'active-for-task'].includes(candidate.decision)
      && !managed.includes(candidate.location?.relative))
    : [];
  const adoptedConventions = (config.adaptiveDecisions?.skills ?? []).filter((decision) => decision.action === 'add');
  if (!projectSkills.length && !adoptedConventions.length) gaps.push('no evidence-backed project Skill has been approved');
  return {
    status: gaps.length ? 'needs-enrichment' : documentable ? 'recorded-needs-review' : 'not-applicable-no-code',
    documentable,
    notApplicable: documentable ? null : {
      contracts: ['development-documentation', 'business-memory-ownership'],
      reason: 'The repository contains neither code nor a build manifest, so there is no code-backed behavior to document and no business Memory to own.',
    },
    units: units.length,
    memoryModules: memory?.modules?.length ?? 0,
    unownedSourceFiles: scan.files.filter((file) => {
      const owned = new Set((memory?.modules ?? []).flatMap((module) => module.owns ?? []));
      return file.type === 'file' && isMemoryCodePath(file.relative) && !owned.has(file.relative);
    }).length,
    projectSkills: projectSkills.length + adoptedConventions.length,
    gaps,
    boundary: 'This checks recorded evidence and coverage signals; a human must review semantic accuracy and actual Agent loading.',
  };
}

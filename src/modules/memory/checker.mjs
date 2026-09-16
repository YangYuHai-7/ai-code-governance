import { runGit } from '../../adapters/process/index.mjs';
import { sha256, stableJson } from '../../shared/index.mjs';
import { capabilitySourceChanged } from '../capabilities/index.mjs';
import { MEMORY_INDEX, readMemoryFile, safeMemoryPath, validateMemoryShape } from './schema.mjs';
import { isMemoryCodePath, scanProjectMemoryFacts } from './scanner.mjs';

const HASH = /^[a-f0-9]{64}$/;
const ID = /^(?:module|page|api|method|data|call|source)-[a-f0-9]{16}$/;

function unchangedMemoryBehavior(relative, before, after) {
  if (/\.(?:[cm]?js|ts)$/.test(relative)) return !capabilitySourceChanged(before, after);
  if (before === after) return true;
  // Only terminal empty physical lines are normalized in these code-only
  // grammars. Preserve every nonempty line, including Python indentation.
  // Embedded markup/data formats (PHP, Ruby, Vue, etc.) remain byte-sensitive.
  if (!/\.(?:py|go|rs|java|kt|cs|swift|dart|sql|prisma)$/.test(relative)) return false;
  const terminalLines = (source) => source.replace(/(?:\r?\n[\t ]*)+$/, '\n');
  return terminalLines(before) === terminalLines(after);
}
export function memoryIssues(root, scan, changedPaths) {
  const issues = [];
  let memory;
  try { memory = validateMemoryShape(JSON.parse(readMemoryFile(root, MEMORY_INDEX))); }
  catch (error) { return [`memory: ${error.message}`]; }
  const checkFile = (relative, label = 'evidence') => {
    try { return readMemoryFile(root, relative); }
    catch (error) { issues.push(`memory ${label}: ${error.message}`); return null; }
  };
  const owners = new Map();
  const entities = new Map();
  for (const kind of ['modules', 'pages', 'apis', 'methods', 'dataSources', 'callSites', 'sources']) for (const entry of memory[kind]) {
    if (!entry || !ID.test(entry.id ?? '') || entities.has(entry.id)) { issues.push(`memory invalid or duplicate ${kind} id`); continue; }
    entities.set(entry.id, entry);
  }
  for (const module of memory.modules) {
    if (!module || !Array.isArray(module.owns) || !Array.isArray(module.codeGlobs) || !Array.isArray(module.verifiedFrom)) { issues.push('memory invalid module ownership'); continue; }
    if (module.memoryPage !== `docs/memory/modules/${module.id}.md`) issues.push(`memory unsafe module page: ${module.memoryPage}`);
    else {
      const page = checkFile(module.memoryPage, 'page');
      if (page !== null) for (const section of ['Purpose', 'Invariants', 'Structure', 'Evidence', 'Gaps']) if (!new RegExp(`^## ${section}\\s*$`, 'm').test(page)) issues.push(`memory page missing section ${section}: ${module.memoryPage}`);
    }
    if (stableJson(module.codeGlobs) !== stableJson(module.owns)) issues.push(`memory ownership globs must be exact source paths: ${module.id}`);
    for (const relative of module.owns) {
      if (!safeMemoryPath(relative) || !isMemoryCodePath(relative)) issues.push(`memory unsafe owning code path: ${relative}`);
      if (owners.has(relative)) issues.push(`memory duplicate owner: ${relative}`);
      owners.set(relative, module);
      checkFile(relative);
    }
    if (!module.summary || module.summary.status !== 'unverified' || typeof module.summary.text !== 'string' || !Array.isArray(module.summary.verifiedFrom)
      || (module.summary.text.trim() && module.summary.verifiedFrom.length === 0)) issues.push(`memory semantic summary needs unverified evidence: ${module.id}`);
    else for (const relative of module.summary.verifiedFrom) checkFile(relative);
    for (const relative of module.verifiedFrom) checkFile(relative);
  }
  for (const kind of ['pages', 'apis', 'methods', 'dataSources', 'callSites']) for (const entry of memory[kind]) {
    if (!entry || !entities.has(entry.moduleId) || !Array.isArray(entry.verifiedFrom) || !entry.verifiedFrom.length) { issues.push(`memory invalid owner/evidence for ${kind}`); continue; }
    for (const relative of entry.verifiedFrom) checkFile(relative);
    const relative = kind === 'apis' ? entry.implementationPath : entry.path;
    if (owners.get(relative)?.id !== entry.moduleId) issues.push(`memory mismatched owner: ${entry.id}`);
    if (kind === 'apis' && (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(entry.method) || typeof entry.path !== 'string' || !entry.path.startsWith('/'))) issues.push(`memory invalid method/path pairing: ${entry.id}`);
  }
  const reciprocal = (entries, field, targets, back) => {
    for (const entry of entries) {
      if (!entry || !Array.isArray(entry[field]) || new Set(entry[field]).size !== entry[field].length) { issues.push(`memory invalid reciprocal ${field}`); continue; }
      for (const targetId of entry[field]) {
        const target = targets.find((item) => item?.id === targetId);
        if (!target || !Array.isArray(target[back]) || !target[back].includes(entry.id)) issues.push(`memory reciprocal ${entry.id} -> ${targetId}`);
        if (field === 'apiIds' && entry.apiPath && target && (target.path !== entry.apiPath || target.method !== entry.method)) issues.push(`memory method/path mismatch: ${entry.id}`);
      }
    }
  };
  reciprocal(memory.pages, 'apiIds', memory.apis, 'pageIds');
  reciprocal(memory.apis, 'pageIds', memory.pages, 'apiIds');
  reciprocal(memory.callSites, 'apiIds', memory.apis, 'callSiteIds');
  reciprocal(memory.apis, 'callSiteIds', memory.callSites, 'apiIds');
  reciprocal(memory.pages, 'callSiteIds', memory.callSites, 'pageIds');
  reciprocal(memory.callSites, 'pageIds', memory.pages, 'callSiteIds');
  reciprocal(memory.modules, 'apiIds', memory.apis, 'moduleIds');
  reciprocal(memory.apis, 'moduleIds', memory.modules, 'apiIds');
  for (const [field, collection] of [['pageIds', 'pages'], ['methodIds', 'methods'], ['dataSourceIds', 'dataSources'], ['callSiteIds', 'callSites']]) {
    for (const module of memory.modules) for (const entryId of module[field]) if (!memory[collection].some((entry) => entry.id === entryId && entry.moduleId === module.id)) issues.push(`memory reciprocal module relation: ${module.id} -> ${entryId}`);
    for (const entry of memory[collection]) if (!memory.modules.some((module) => module.id === entry.moduleId && module[field].includes(entry.id))) issues.push(`memory reciprocal module relation: ${entry.id} -> ${entry.moduleId}`);
  }
  if (memory.apis.length) {
    const current = scanProjectMemoryFacts(scan);
    for (const api of memory.apis) if (!current.apis.some((entry) => entry.implementationPath === api.implementationPath && entry.method === api.method && entry.path === api.path)) issues.push(`memory unsupported API evidence: ${api.id}`);
  }
  for (const relative of memory.tests) checkFile(relative);
  const sources = new Map();
  for (const source of memory.sources) {
    if (!source || !HASH.test(source.sha256 ?? '') || source.record !== `docs/memory/sources/${source.id}.json` || !owners.has(source.path) || sources.has(source.path)) { issues.push('memory invalid source record'); continue; }
    sources.set(source.path, source);
    const record = checkFile(source.record);
    try { if (record !== null && stableJson(JSON.parse(record)) !== stableJson(source)) issues.push(`memory source record does not match index: ${source.path}`); }
    catch { issues.push(`memory invalid source JSON: ${source.record}`); }
  }
  for (const relative of owners.keys()) if (!sources.has(relative)) issues.push(`memory missing source evidence: ${relative}`);
  let previous = null;
  if (changedPaths?.length) {
    const result = runGit(scan.memoryGitRoot ?? root, ['show', `HEAD:${MEMORY_INDEX}`], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    if (result.status === 0) try { previous = validateMemoryShape(JSON.parse(result.stdout)); } catch { issues.push('memory previous ownership evidence is invalid'); }
  }
  if (Array.isArray(changedPaths)) for (const relative of changedPaths.filter(isMemoryCodePath)) {
    const owner = owners.get(relative);
    let current;
    try { current = readMemoryFile(root, relative); } catch { current = null; }
    const before = runGit(scan.memoryGitRoot ?? root, ['show', `HEAD:${relative}`], { timeout: 15000, maxBuffer: 2 * 1024 * 1024 });
    if (before.status === 0 && current !== null && unchangedMemoryBehavior(relative, before.stdout, current)) continue;
    const digest = current === null ? null : sha256(current);
    const previousOwner = previous?.modules.find((entry) => entry.owns?.includes(relative));
    if (current === null && !owner && previousOwner && changedPaths.includes(MEMORY_INDEX) && changedPaths.includes(previousOwner.memoryPage)) continue;
    if (!owner) { issues.push(`memory unowned behavior ${relative}: update the owning module page and ${MEMORY_INDEX}`); continue; }
    if (!changedPaths.includes(owner.memoryPage) || !changedPaths.includes(MEMORY_INDEX) || !digest || sources.get(relative)?.sha256 !== digest) issues.push(`memory stale owning code ${relative}: update ${owner.memoryPage}, ${MEMORY_INDEX} and source evidence`);
  }
  return [...new Set(issues)];
}

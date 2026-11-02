import fs from 'node:fs';
import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { architectureDocumentSource } from './architecture-documentation.mjs';

const LEVELS = ['L0', 'L1', 'L1.5', 'L2', 'L3'];
const UI_TEXT = /(?:页面|界面|视觉|样式|交互|前端|仪表盘|按钮|表单|\b(?:ui|ux|page|screen|dashboard|frontend|visual|styles?|button|form)\b)/i;
const UI_PATH = /(?:\.(?:tsx|jsx|vue|svelte|css|scss|sass|html)$|(?:^|\/)(?:pages|views|components|frontend|web)\/)/i;
const DESIGN_DOCUMENT = /(?:^|\/)(?:design-system|design-guidelines|ui-guidelines|visual-specification|设计规范)\.(?:md|mdx|json)$/i;
const OPENSPEC = /^(?:openspec|openspec-change-governance)(?:$|[/:])/;

/** Read only the explicit scalar authority mapping, without executing a YAML provider. */
export function readDeliveryAuthority(root) {
  for (const relative of ['docs/ai/integrations/workflow-integrations.yaml', 'docs/ai/workflow-integrations.yaml']) {
    const target = path.join(root, relative);
    let current = root;
    for (const part of relative.split('/')) {
      current = path.join(current, part);
      try {
        if (fs.lstatSync(current).isSymbolicLink()) throw usageError('Workflow authority must not traverse a symlink.');
      } catch (error) { if (error.code === 'ENOENT') break; throw error; }
    }
    if (!fs.existsSync(target)) continue;
    const handle = fs.openSync(target, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    let source;
    try {
      const stat = fs.fstatSync(handle);
      if (!stat.isFile() || stat.size > 65536) throw usageError('Workflow authority must be a YAML file of at most 64 KiB.');
      const bytes = Buffer.alloc(65537);
      const length = fs.readSync(handle, bytes, 0, bytes.length, 0);
      if (length > 65536) throw usageError('Workflow authority must be a YAML file of at most 64 KiB.');
      source = bytes.subarray(0, length).toString('utf8');
    } finally { fs.closeSync(handle); }
    const lines = source.split(/\r?\n/);
    const authority = {};
    let active = false;
    for (const line of lines) {
      if (/^authority:\s*(?:#.*)?$/.test(line)) { active = true; continue; }
      if (active && /^\S/.test(line) && !/^#/.test(line)) active = false;
      if (!active) continue;
      const match = line.match(/^ {2}(current_product_behavior|active_change|implementation_task_list):\s*["']?([\w./:-]+)["']?\s*(?:#.*)?$/);
      if (match) authority[match[1]] = match[2];
    }
    return authority;
  }
  return {};
}

function openSpecReference(owner, artifactId) {
  if (!owner.startsWith('openspec/')) return 'openspec/changes';
  if (owner.includes('\\') || owner.split('/').some((part) => !part || part === '.' || part === '..')) throw usageError('OpenSpec authority must use a safe repository-relative path.');
  const filename = { ba: 'proposal.md', architecture: 'design.md', 'technical-design': 'design.md', 'development-plan': 'tasks.md' }[artifactId];
  if (/\.md$/i.test(owner)) return artifactId === 'development-plan' ? owner : path.posix.join(path.posix.dirname(owner), filename);
  return path.posix.join(owner, filename);
}

/** Select small capabilities from the effective route; selection grants no execution authority. */
export function buildDeliveryCapabilityPlan({ text = '', paths = [], route = { level: 'L0' }, config = {}, scan = {}, authority = {} } = {}) {
  const level = route.level;
  if (!LEVELS.includes(level)) throw usageError(`Unsupported task level: ${level}`);
  const lifecycle = config.initialization?.lifecycle ?? config.initialClassification?.codebase?.lifecycle?.value
    ?? (config.projectMode === 'greenfield' ? 'greenfield' : 'existing');
  const capabilities = [];
  const artifacts = [];
  const add = (id, reason, artifactIds) => {
    capabilities.push({ id, required: true, reason, artifactIds });
    for (const artifactId of artifactIds) artifacts.push({ id: artifactId, kind: artifactId, authority: 'project-native', mode: 'create-or-update', path: null });
  };
  if (level === 'L1.5') {
    add('systematic-debugging', 'A bounded defect requires reproducible evidence and a root cause.', ['reproduction', 'root-cause']);
    add('regression-test-design', 'The fixed defect and affected module need reusable regression cases.', ['module-test-cases']);
  }
  if (['L2', 'L3'].includes(level)) {
    add('business-analysis', 'Behavior changes require business rules, scope and acceptance criteria.', ['ba']);
    add('development-planning', 'Implementation needs module responsibilities and verification steps.', ['development-plan']);
    add('module-test-design', 'Changed behavior needs traceable cases grouped by module with shared context references.', ['module-test-cases']);
    const ui = UI_TEXT.test(text) || paths.some((relative) => UI_PATH.test(relative));
    if (ui) {
      const existingDesign = (scan.files ?? []).map((file) => typeof file === 'string' ? file : file.type === 'file' ? file.relative : null)
        .filter((relative) => typeof relative === 'string' && DESIGN_DOCUMENT.test(relative)).sort()[0];
      add('product-design', existingDesign ? 'Inherit the existing design specification.' : lifecycle === 'greenfield' ? 'Establish interaction, component and visual design for the new UI.' : 'Extract the existing UI baseline and identify evidence gaps before extending it.', ['product-design']);
      if (existingDesign) Object.assign(artifacts.at(-1), { mode: 'reference', path: existingDesign });
      else add('visual-preview', 'UI work without an existing design specification needs a reviewable preview.', ['visual-preview']);
    }
    if (level === 'L3' || lifecycle === 'greenfield') add('technical-design', level === 'L3' ? 'Integrated or high-consequence changes need technical decisions and compatibility analysis.' : 'A new project needs an initial architecture and programming conventions.', ['technical-design']);
    if (lifecycle === 'greenfield' || level === 'L3' || /架构图|流程图|architecture diagram|business flowchart/i.test(text)) {
      add('architecture-documentation', 'Review system, module and business-flow views alongside development conventions before implementation.', ['architecture']);
      const existing = lifecycle !== 'greenfield' && level !== 'L3' ? architectureDocumentSource(scan) : null;
      if (existing) Object.assign(artifacts.at(-1), { mode: 'reference', path: existing });
    }
  }
  if (level !== 'L0') add('fresh-verification', 'Completion needs current verification output; templates alone do not prove delivery.', ['verification-report']);
  for (const artifact of artifacts) {
    const owner = artifact.id === 'development-plan' ? authority.implementation_task_list
      : ['ba', 'technical-design', 'architecture'].includes(artifact.id) ? authority.active_change : null;
    if (typeof owner === 'string' && OPENSPEC.test(owner)) Object.assign(artifact, { authority: 'openspec', mode: 'reference', path: openSpecReference(owner, artifact.id) });
  }
  return { schemaVersion: 1, routing: 'conditional', level, lifecycle, capabilities, artifacts,
    defaults: { worktree: false, multiAgent: false, mandatoryTdd: false }, authority };
}

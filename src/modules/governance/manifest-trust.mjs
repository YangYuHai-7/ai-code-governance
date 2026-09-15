import { MANIFEST_PATH, MANIFEST_SCHEMA_VERSION, TEMPLATE_VERSION, TOOL_NAME, TOOL_VERSION } from '../../constants.mjs';
import { isSafeRelative } from '../../shared/index.mjs';
import { assertNoLinkAncestor } from '../../preconditions.mjs';

const KNOWN_MANAGED_RELATIONSHIPS = new Set([
  'full\0adapter\0docs/ai/rules/00_always.mdc',
  'full\0architecture-module-graph\0architecture-profile-registry-and-initialization-decision',
  'full\0architecture-profile\0architecture-profile-registry-and-initialization-decision',
  'full\0architecture-rule\0architecture-profile-registry-and-initialization-decision',
  'full\0business-constraint-registry\0owner-confirmed-config',
  'full\0canonical\0capability-pack-registry',
  'full\0canonical\0project-classification-and-governance-config',
  'full\0capability-evolution-catalog\0project-capability-harvest',
  'full\0configuration\0confirmed-decisions',
  'full\0project-capability-skill\0project-capability-harvest',
  'full\0release-policy\0asset:release-acceptance-policy',
  'full\0surface-verification-profiles\0asset:surface-verification-contract',
  'full\0task-routing-policy\0template:task-routing-policy',
  'full\0technical-standard-manifest\0technical-standard-registry',
  'full\0technical-standard-skill\0technical-standard-registry',
  'gitignore-block\0local-output-ignore\0template:local-output-layout',
  'managed-block\0adapter\0AGENTS.md',
  'managed-block\0entrypoint\0template:agents',
]);

const MANAGED_SKILL_SOURCE_RELATIONSHIPS = Object.freeze({
  'adapter-skill': /^docs\/ai\/skills\/(?!project\/|standards\/)[A-Za-z0-9_-]+\/SKILL\.md$/,
  'project-capability-adapter-skill': /^docs\/ai\/skills\/project\/[A-Za-z0-9_-]+\/SKILL\.md$/,
  'technical-standard-adapter-skill': /^docs\/ai\/skills\/standards\/[A-Za-z0-9_-]+\/SKILL\.md$/,
});

const FIXED_MANAGED_PATHS = Object.freeze({
  'architecture-module-graph': ['docs/ai/module-graph.json'],
  'architecture-profile': ['docs/ai/architecture-profile.json'],
  'architecture-rule': ['docs/ai/rules/15_architecture.mdc'],
  'business-constraint-registry': ['docs/ai/business-constraints.json'],
  'capability-evolution-catalog': ['docs/ai/capability-evolution.json'],
  configuration: ['.ai-governance/config.json'],
  'release-policy': ['docs/ai/release-acceptance-policy.json'],
  'surface-verification-profiles': ['docs/ai/surface-verification-profiles.json'],
  'task-routing-policy': ['docs/ai/task-routing-policy.json'],
  'technical-standard-manifest': ['docs/ai/technical-standards.json'],
  'local-output-ignore': ['.gitignore'],
  entrypoint: ['AGENTS.md'],
});

function hasKnownManagedPath(entry) {
  if (entry.kind === 'adapter') return entry.path === (entry.ownership === 'full' ? '.cursor/rules/ai-code-governance.mdc' : 'CLAUDE.md');
  if (Object.hasOwn(FIXED_MANAGED_PATHS, entry.kind)) return FIXED_MANAGED_PATHS[entry.kind].includes(entry.path);
  if (entry.kind === 'canonical') return entry.path === (entry.source === 'capability-pack-registry' ? 'docs/ai/stack-profile.json' : 'docs/ai/decision-ledger.json');
  if (entry.kind === 'project-capability-skill') return /^docs\/ai\/skills\/project\/[A-Za-z0-9_-]+\/SKILL\.md$/.test(entry.path);
  if (entry.kind === 'technical-standard-skill') return /^docs\/ai\/skills\/standards\/[A-Za-z0-9_-]+\/SKILL\.md$/.test(entry.path);
  if (Object.hasOwn(MANAGED_SKILL_SOURCE_RELATIONSHIPS, entry.kind) && MANAGED_SKILL_SOURCE_RELATIONSHIPS[entry.kind].test(entry.source ?? '')) {
    const suffix = entry.source.slice('docs/ai/skills/'.length);
    return ['.agents', '.claude'].some((client) => entry.path === `${client}/skills/${suffix}`);
  }
  return false;
}

function supportedToolVersion(version) {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) return false;
  const actual = version.split(/[.+-]/).slice(0, 3).map(Number);
  const supported = TOOL_VERSION.split(/[.+-]/).slice(0, 3).map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (actual[index] !== supported[index]) return actual[index] < supported[index];
  }
  return true;
}

function hasKnownManagedRelationship(entry) {
  const relationship = `${entry?.ownership}\0${entry?.kind}\0${entry?.source}`;
  if (KNOWN_MANAGED_RELATIONSHIPS.has(relationship)) return true;
  if (entry?.ownership !== 'full') return false;
  return Object.hasOwn(MANAGED_SKILL_SOURCE_RELATIONSHIPS, entry?.kind)
    && MANAGED_SKILL_SOURCE_RELATIONSHIPS[entry.kind].test(entry.source ?? '');
}

export function validateManifestRemovalAuthority(root, manifest) {
  const errors = [];
  try { assertNoLinkAncestor(root, MANIFEST_PATH); } catch { errors.push('manifest path traverses a symbolic link'); }
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push('schemaVersion');
  if (manifest?.generatedBy !== TOOL_NAME) errors.push('generatedBy');
  if (!supportedToolVersion(manifest?.toolVersion)) errors.push('toolVersion');
  if (!Number.isInteger(manifest?.templateVersion) || manifest.templateVersion < 1 || manifest.templateVersion > TEMPLATE_VERSION) errors.push('templateVersion');
  if (!Array.isArray(manifest?.files)) errors.push('files');
  const paths = new Set();
  for (const entry of Array.isArray(manifest?.files) ? manifest.files : []) {
    if (!isSafeRelative(entry?.path ?? '')) errors.push(`unsafe path: ${entry?.path}`);
    if (!['full', 'managed-block', 'gitignore-block'].includes(entry?.ownership)) errors.push(`ownership: ${entry?.path}`);
    if (!hasKnownManagedRelationship(entry)) errors.push(`kind/source/ownership: ${entry?.path}`);
    if (!entry || !hasKnownManagedPath(entry)) errors.push(`kind/source/path: ${entry?.path}`);
    if (paths.has(entry?.path)) errors.push(`duplicate path: ${entry?.path}`);
    paths.add(entry?.path);
    if (!/^[a-f0-9]{64}$/.test(entry?.sha256 ?? '')) errors.push(`sha256: ${entry?.path}`);
  }
  return { trusted: errors.length === 0, errors };
}

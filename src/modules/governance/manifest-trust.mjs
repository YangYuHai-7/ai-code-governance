import path from 'node:path';
import { CONFIG_PATH, MANIFEST_PATH, MANIFEST_SCHEMA_VERSION, TEMPLATE_VERSION, TOOL_NAME, TOOL_VERSION } from '../../constants.mjs';
import { isSafeRelative, sha256 } from '../../shared/index.mjs';
import { assertNoLinkAncestor } from '../../preconditions.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { loadCapabilityRegistry } from '../../catalogs/index.mjs';
import { loadTechnicalStandardRegistry } from '../standards/index.mjs';
import { buildCapabilityArtifacts } from '../capabilities/index.mjs';
import { BUSINESS_CONSTRAINT_SKILL_PATH } from './business-constraints.mjs';

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
  'full\0release-policy\0asset:release-acceptance-policy',
  'full\0surface-verification-profiles\0asset:surface-verification-contract',
  'full\0task-routing-policy\0template:task-routing-policy',
  'full\0technical-standard-manifest\0technical-standard-registry',
  'full\0skill-management-skill\0approved-skill-governance-plan',
  'full\0skill-management-index\0approved-skill-governance-plan',
  'full\0project-agent-team\0approved-skill-governance-plan',
  'gitignore-block\0local-output-ignore\0template:local-output-layout',
  'managed-block\0adapter\0AGENTS.md',
  'managed-block\0entrypoint\0template:agents',
]);

const SKILL_KINDS = new Set(['adapter-skill', 'project-capability-skill', 'project-capability-adapter-skill', 'technical-standard-skill', 'technical-standard-adapter-skill']);

function definitionKey(entry) {
  return [entry?.ownership, entry?.kind, entry?.source, entry?.path].join('\0');
}

function readLocalEvidence(root, relative) {
  assertNoLinkAncestor(root, relative);
  return readText(path.join(root, relative));
}

function supportedSkillDefinitions(root, manifest) {
  const definitions = new Map();
  // Templates 1, 2 and 3 share these registry-backed canonical and adapter definitions.
  // Retired definitions must be enumerated here explicitly, never admitted by a slug pattern.
  if (![1, 2, 3].includes(manifest?.templateVersion)) return definitions;
  const add = (artifact, hash = true) => definitions.set(definitionKey({ ownership: 'full', ...artifact }), hash);
  const adapters = (source, kind) => {
    const suffix = source.slice('docs/ai/skills/'.length);
    for (const client of ['.agents', '.claude']) add({ path: `${client}/skills/${suffix}`, kind, source });
  };
  for (const pack of loadCapabilityRegistry().packs) adapters(`docs/ai/skills/${pack.id}/SKILL.md`, 'adapter-skill');
  adapters(BUSINESS_CONSTRAINT_SKILL_PATH, 'adapter-skill');
  for (const standard of loadTechnicalStandardRegistry().standards) {
    const canonical = `docs/ai/skills/standards/${standard.id}/SKILL.md`;
    add({ path: canonical, kind: 'technical-standard-skill', source: 'technical-standard-registry' });
    adapters(canonical, 'technical-standard-adapter-skill');
  }

  const configurations = [];
  try {
    const config = JSON.parse(readLocalEvidence(root, CONFIG_PATH));
    if (config.schemaVersion === 1 && config.generatedBy === TOOL_NAME) configurations.push(config);
  } catch { /* Missing or unverifiable project definitions confer no deletion authority. */ }
  try {
    const catalogPath = 'docs/ai/capability-evolution.json';
    const entry = manifest.files.find((item) => item?.path === catalogPath);
    const content = readLocalEvidence(root, catalogPath);
    if (entry?.ownership === 'full' && entry.kind === 'capability-evolution-catalog'
      && entry.source === 'project-capability-harvest' && sha256(content) === entry.sha256) {
      const catalog = JSON.parse(content);
      if (catalog.schemaVersion === 1) configurations.push({ projectCapabilities: catalog.capabilities, capabilityEvolution: { lastHarvest: catalog.lastHarvest } });
    }
  } catch { /* A historical catalog must still match its managed preimage. */ }
  for (const config of configurations) {
    try {
      const artifacts = buildCapabilityArtifacts({ ...config, clients: ['codex', 'claude-code'] }).artifacts;
      for (const artifact of artifacts.filter((item) => SKILL_KINDS.has(item.kind))) add(artifact, sha256(artifact.content));
    } catch { /* Invalid capability records cannot manufacture a supported definition. */ }
  }
  return definitions;
}

function hasSupportedSkillDefinition(entry, definitions) {
  const proof = definitions.get(definitionKey(entry));
  return proof === true || (typeof proof === 'string' && proof === entry?.sha256);
}

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
  'skill-management-skill': ['docs/ai/skills/skill-discovery/SKILL.md', 'docs/ai/skills/team-orchestrator/SKILL.md'],
  'skill-management-index': ['docs/ai/skill-index.json'],
  'project-agent-team': ['docs/ai/agent-team.json'],
  'local-output-ignore': ['.gitignore'],
  entrypoint: ['AGENTS.md'],
});

function hasKnownManagedPath(entry, definitions) {
  if (entry.kind === 'adapter') return entry.path === (entry.ownership === 'full' ? '.cursor/rules/ai-code-governance.mdc' : 'CLAUDE.md');
  if (Object.hasOwn(FIXED_MANAGED_PATHS, entry.kind)) return FIXED_MANAGED_PATHS[entry.kind].includes(entry.path);
  if (entry.kind === 'canonical') return entry.path === (entry.source === 'capability-pack-registry' ? 'docs/ai/stack-profile.json' : 'docs/ai/decision-ledger.json');
  return hasSupportedSkillDefinition(entry, definitions);
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

function hasKnownManagedRelationship(entry, definitions) {
  const relationship = `${entry?.ownership}\0${entry?.kind}\0${entry?.source}`;
  if (KNOWN_MANAGED_RELATIONSHIPS.has(relationship)) return true;
  return hasSupportedSkillDefinition(entry, definitions);
}

export function validateManifestRemovalAuthority(root, manifest) {
  const errors = [];
  try { assertNoLinkAncestor(root, MANIFEST_PATH); } catch { errors.push('manifest path traverses a symbolic link'); }
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push('schemaVersion');
  if (manifest?.generatedBy !== TOOL_NAME) errors.push('generatedBy');
  if (!supportedToolVersion(manifest?.toolVersion)) errors.push('toolVersion');
  if (!Number.isInteger(manifest?.templateVersion) || manifest.templateVersion < 1 || manifest.templateVersion > TEMPLATE_VERSION) errors.push('templateVersion');
  if (!Array.isArray(manifest?.files)) errors.push('files');
  const definitions = Array.isArray(manifest?.files) && manifest.files.some((entry) => SKILL_KINDS.has(entry?.kind))
    ? supportedSkillDefinitions(root, manifest) : new Map();
  const paths = new Set();
  for (const entry of Array.isArray(manifest?.files) ? manifest.files : []) {
    if (!isSafeRelative(entry?.path ?? '')) errors.push(`unsafe path: ${entry?.path}`);
    if (!['full', 'managed-block', 'gitignore-block'].includes(entry?.ownership)) errors.push(`ownership: ${entry?.path}`);
    if (!hasKnownManagedRelationship(entry, definitions)) errors.push(`kind/source/ownership: ${entry?.path}`);
    if (!entry || !hasKnownManagedPath(entry, definitions)) errors.push(`kind/source/path: ${entry?.path}`);
    if (paths.has(entry?.path)) errors.push(`duplicate path: ${entry?.path}`);
    paths.add(entry?.path);
    if (!/^[a-f0-9]{64}$/.test(entry?.sha256 ?? '')) errors.push(`sha256: ${entry?.path}`);
  }
  return { trusted: errors.length === 0, errors };
}

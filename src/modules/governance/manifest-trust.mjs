import { MANIFEST_SCHEMA_VERSION, TEMPLATE_VERSION, TOOL_NAME } from '../../constants.mjs';
import { isSafeRelative } from '../../shared/index.mjs';

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

function hasKnownManagedRelationship(entry) {
  const relationship = `${entry?.ownership}\0${entry?.kind}\0${entry?.source}`;
  if (KNOWN_MANAGED_RELATIONSHIPS.has(relationship)) return true;
  if (entry?.ownership !== 'full') return false;
  return MANAGED_SKILL_SOURCE_RELATIONSHIPS[entry?.kind]?.test(entry?.source ?? '') === true;
}

export function validateManifestRemovalAuthority(root, manifest) {
  void root;
  const errors = [];
  if (manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION) errors.push('schemaVersion');
  if (manifest?.generatedBy !== TOOL_NAME) errors.push('generatedBy');
  if (!Number.isInteger(manifest?.templateVersion) || manifest.templateVersion < 1 || manifest.templateVersion > TEMPLATE_VERSION) errors.push('templateVersion');
  if (!Array.isArray(manifest?.files)) errors.push('files');
  for (const entry of Array.isArray(manifest?.files) ? manifest.files : []) {
    if (!isSafeRelative(entry?.path ?? '')) errors.push(`unsafe path: ${entry?.path}`);
    if (!['full', 'managed-block', 'gitignore-block'].includes(entry?.ownership)) errors.push(`ownership: ${entry?.path}`);
    if (!hasKnownManagedRelationship(entry)) errors.push(`kind/source/ownership: ${entry?.path}`);
    if (!/^[a-f0-9]{64}$/.test(entry?.sha256 ?? '')) errors.push(`sha256: ${entry?.path}`);
  }
  return { trusted: errors.length === 0, errors };
}

import path from 'node:path';
import { CONFIG_PATH, MANIFEST_PATH, MANIFEST_SCHEMA_VERSION, TEMPLATE_VERSION, TOOL_NAME, TOOL_VERSION } from '../../constants.mjs';
import { isSafeRelative, sha256 } from '../../shared/index.mjs';
import { assertNoLinkAncestor } from '../../preconditions.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { declaredSkillDirectories, loadCapabilityRegistry } from '../../catalogs/index.mjs';
import { buildProjectConventionArtifacts, loadTechnicalStandardRegistry } from '../standards/index.mjs';
import { buildCapabilityArtifacts } from '../capabilities/index.mjs';
import { scanProject } from '../repository/index.mjs';
import { scanProjectMemoryFacts } from '../memory/index.mjs';
import { BUSINESS_CONSTRAINT_SKILL_PATH } from './business-constraints.mjs';
import { BROWNFIELD_ENRICHMENT_SKILL } from './brownfield-enrichment.mjs';
import { WORKFLOW_DOC, WORKFLOW_KIND } from './workflow.mjs';
import { RETIRED_PROCESS_SKILL_IDS } from './retired.mjs';
import { canonicalPath, remapContentPaths } from './layout.mjs';

/** Normalize an ownership-kind-source relationship so a preserve and compact tree both match. */
function normalizeRelationship(value) {
  const [ownership, kind, source] = String(value).split('\0');
  return [ownership, kind, typeof source === 'string' ? canonicalPath(source, 'compact') : source].join('\0');
}

const DEVELOPMENT_UNIT_KINDS = new Set([
  'development-unit-rule',
  'development-unit-skill',
  'development-unit-adapter-skill',
  'development-unit-entrypoint',
]);

function escapePathSegment(value) {
  return value.replaceAll(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);
}

// A unit's documentation page never repeats the unit's own path: the root unit writes
// docs/ai/development/root.md and every other unit writes docs/ai/development/units/<id>.md
// against the repository root. `source` alone therefore cannot carry the prefix back, and
// the artifact path is the only place the unit path and unit id can be recovered from.
function recoverDevelopmentUnit(entry) {
  const artifactPath = entry?.path;
  if (typeof artifactPath !== 'string') return null;
  const describe = (unitPath, unitId) => {
    const localRoot = unitPath === '' ? 'docs/ai' : `${unitPath}/docs/ai`;
    return {
      unitPath,
      unitId,
      localRoot,
      adapterPrefix: unitPath === '' ? '' : `${unitPath}/`,
      documentation: unitPath === '' ? 'docs/ai/development/root.md' : `docs/ai/development/units/${unitId}.md`,
      canonicalSkill: unitId === null ? null : `${localRoot}/skills/development-${unitId}/SKILL.md`,
    };
  };
  switch (entry.kind) {
    case 'development-unit-adapter-skill':
      // Matching a client directory declared in the agent registry is what keeps this rule
      // from accepting a slug-shaped directory nobody owns.
      for (const directory of declaredSkillDirectories()) {
        const match = artifactPath.match(new RegExp(`^(?:(.+)/)?${escapePathSegment(directory)}/development-([^/]+)/SKILL\\.md$`));
        if (match) return describe(match[1] ?? '', match[2]);
      }
      return null;
    case 'development-unit-skill': {
      const match = artifactPath.match(/^(?:(.+)\/)?docs\/ai\/skills\/development-([^/]+)\/SKILL\.md$/);
      return match ? describe(match[1] ?? '', match[2]) : null;
    }
    case 'development-unit-rule': {
      const match = artifactPath.match(/^(?:(.+)\/)?docs\/ai\/(?:rules|policies)\/development\.md$/);
      return match ? describe(match[1] ?? '', null) : null;
    }
    case 'development-unit-entrypoint': {
      const match = artifactPath.match(/^(.+)\/AGENTS\.md$/);
      return match ? describe(match[1], null) : null;
    }
    default:
      return null;
  }
}

function citesItsOwnUnitDocumentation(entry, unit) {
  // Every artifact of a unit cites that unit's documentation page. Manifests written before
  // this contract was unified cited the mirrored canonical Skill path instead, so that one
  // shape is still accepted: otherwise an upgrade would reclassify an already installed
  // governance tree as unmanaged files this tool refuses to touch.
  if (entry.source === unit.documentation) return true;
  return entry.kind === 'development-unit-adapter-skill' && entry.source === unit.canonicalSkill;
}

function matchesDevelopmentUnitShape(entry, unit) {
  switch (entry.kind) {
    case 'development-unit-rule':
      return isSameKnownPath(entry.path, `${unit.localRoot}/rules/development.md`);
    case 'development-unit-skill':
      return entry.path === unit.canonicalSkill;
    case 'development-unit-adapter-skill':
      return declaredSkillDirectories().some((directory) => entry.path === `${unit.adapterPrefix}${directory}/development-${unit.unitId}/SKILL.md`);
    case 'development-unit-entrypoint':
      // The entrypoint only exists for non-root units; the root unit uses the shared AGENTS.md.
      return unit.unitPath !== '' && entry.path === `${unit.unitPath}/AGENTS.md`;
    default:
      return false;
  }
}

function isKnownDevelopmentUnitPath(entry) {
  const unit = recoverDevelopmentUnit(entry);
  return Boolean(unit) && citesItsOwnUnitDocumentation(entry, unit) && matchesDevelopmentUnitShape(entry, unit);
}

const KNOWN_MANAGED_RELATIONSHIPS = new Set([...[
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
  'full\0project-memory-schema\0project-memory-evidence',
  'gitignore-block\0local-output-ignore\0template:local-output-layout',
  'managed-block\0adapter\0AGENTS.md',
  'managed-block\0entrypoint\0template:agents',
  'full\0development-documentation-index\0repository-code-scan',
  // The repository family index is written by the family scan on the orchestrator root.
  // Without this entry every `projectMode=repository-family` root manifests as untrusted,
  // which makes `aicg check` report all of its artifacts as unmanaged and blocks apply.
  'full\0repository-family-index\0repository-family-scan',
  'managed-block\0development-readme\0repository-code-scan',
  'full\0brownfield-understanding-skill\0repository-code-scan',
  'full\0brownfield-understanding-adapter-skill\0docs/ai/skills/brownfield-understanding/SKILL.md',
  // The delivery workflow document is a first-party template surface. Registering it here is
  // what lets a generated workflow be retained and later pruned instead of being treated as an
  // unmanaged file the tool must refuse to touch. The two runtime ledgers are seeds, so they
  // never need a manifest relationship.
  'full\0project-workflow\0template:project-workflow',
  // The retired process Skills stay recognized so a manifest generated by an earlier template
  // remains trusted, which is what lets `sync --prune` clean them up.
  'full\0delivery-loop-skill\0template:delivery-loop',
  'full\0delivery-loop-phase-skill\0template:delivery-loop',
  'full\0project-flow-skill\0template:project-flow',
  'full\0project-flow-phase-skill\0template:project-flow',
  'full\0fixed-team-roster\0team-role-registry',
  'full\0brownfield-enrichment-skill\0brownfield-enrichment-decision',
  // development-unit-* kinds cannot be enumerated up front because each unit has its own
  // source path (docs/ai/development/units/<id>.md). They are trusted only when the path
  // rule below reconstructs an exact match from `source`; an entry that fails to derive a
  // descriptor stays untrusted so we cannot silently delete user-written content.
  'seed\0development-unit-rule\0<recovered-from-source>',
  'seed\0development-unit-skill\0<recovered-from-source>',
  'full\0development-unit-adapter-skill\0<recovered-from-source>',
  'managed-block\0development-unit-entrypoint\0<recovered-from-source>',
  // Retired first-party adapter Skills stay a known relationship, so a manifest generated by an
  // earlier template keeps prune authority over exactly the files AICG generated.
  ...RETIRED_PROCESS_SKILL_IDS.map((id) => 'full\0adapter-skill\0docs/ai/skills/' + id + '/SKILL.md'),
  // repository-family orchestrator root writes a stable membership/governance-authority
  // index (docs/ai/repository-family.json). It is a first-party generated artifact, so
  // registering the relationship lets the parent manifest stay trusted instead of being
  // reported as an unmanaged executable governance artifact on every check.
  'full\0repository-family-index\0repository-family-scan',
].map(normalizeRelationship)]);

const SKILL_KINDS = new Set(['adapter-skill', 'project-capability-skill', 'project-capability-adapter-skill', 'project-convention-skill', 'technical-standard-skill', 'technical-standard-adapter-skill']);

function isSameKnownPath(candidate, legacyPath) {
  return canonicalPath(candidate ?? '', 'compact') === canonicalPath(legacyPath, 'compact');
}

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
  if (![1, 2, 3, 4].includes(manifest?.templateVersion)) return definitions;
  const add = (artifact, hash = true) => definitions.set(definitionKey({ ownership: 'full', ...artifact }), hash);
  // Every client Skill directory the agent registry declares, not just `.agents` and `.claude`.
  // A client whose directory is omitted here writes adapters the tool then refuses to trust,
  // which silently disables prune authority for the whole repository.
  const adapterDirs = declaredSkillDirectories();
  const adapters = (source, kind) => {
    const suffix = source.slice('docs/ai/skills/'.length);
    for (const directory of adapterDirs) add({ path: `${directory}/${suffix}`, kind, source });
  };
  for (const pack of loadCapabilityRegistry().packs) adapters(`docs/ai/skills/${pack.id}/SKILL.md`, 'adapter-skill');
  adapters(BUSINESS_CONSTRAINT_SKILL_PATH, 'adapter-skill');
  adapters(BROWNFIELD_ENRICHMENT_SKILL, 'adapter-skill');
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
    // Read the catalog from the manifest entry's own path so a preserve and a compact tree
    // both resolve the preimage without hardcoding either layout.
    const entry = manifest.files.find((item) => item?.ownership === 'full' && item?.kind === 'capability-evolution-catalog');
    if (entry && entry.source === 'project-capability-harvest') {
      const content = readLocalEvidence(root, entry.path);
      if (sha256(content) === entry.sha256) {
        const catalog = JSON.parse(content);
        if (catalog.schemaVersion === 1) configurations.push({ projectCapabilities: catalog.capabilities, capabilityEvolution: { lastHarvest: catalog.lastHarvest } });
      }
    }
  } catch { /* A historical catalog must still match its managed preimage. */ }
  for (const config of configurations) {
    // The compiler remaps generated content onto the recorded footprint before writing it, so
    // trust comparisons must hash the same remapped bytes the manifest recorded.
    const footprint = config.governanceFootprint ?? 'compact';
    try {
      const artifacts = buildCapabilityArtifacts({ ...config, clients: ['codex', 'claude-code'] }).artifacts;
      for (const artifact of artifacts.filter((item) => SKILL_KINDS.has(item.kind))) add(artifact, sha256(remapContentPaths(artifact.content, footprint)));
    } catch { /* Invalid capability records cannot manufacture a supported definition. */ }
    try {
      const scan = scanProject(root);
      const memory = scanProjectMemoryFacts(scan);
      for (const artifact of buildProjectConventionArtifacts(config, scan, memory).artifacts.filter((item) => item.kind === 'project-convention-skill')) {
        add(artifact, sha256(remapContentPaths(artifact.content, footprint)));
      }
    } catch { /* Invalid or stale convention evidence cannot manufacture a supported definition. */ }
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
  // `team-orchestrator` is retired but stays listed so an older manifest remains trusted.
  'skill-management-skill': ['docs/ai/skills/skill-discovery/SKILL.md', 'docs/ai/skills/team-orchestrator/SKILL.md'],
  'skill-management-index': ['docs/ai/skill-index.json'],
  'project-agent-team': ['docs/ai/agent-team.json'],
  'project-memory-schema': ['docs/memory/SCHEMA.md'],
  'repository-family-index': ['docs/ai/repository-family.json'],
  'local-output-ignore': ['.gitignore'],
  entrypoint: ['AGENTS.md'],
  'fixed-team-roster': ['docs/ai/team-roster.json'],
  'brownfield-enrichment-skill': [BROWNFIELD_ENRICHMENT_SKILL],
  // Retired first-party process Skills, enumerated explicitly and never admitted by a slug
  // pattern, so an older manifest keeps prune authority over exactly the files AICG generated.
  'delivery-loop-skill': ['docs/ai/skills/delivery-loop/SKILL.md'],
  'delivery-loop-phase-skill': ['delivery-decomposition', 'delivery-assignment', 'delivery-development', 'delivery-test-authoring', 'delivery-local-test', 'delivery-report', 'delivery-fix-loop'].map((id) => 'docs/ai/skills/' + id + '/SKILL.md'),
  'project-flow-skill': ['docs/ai/skills/project-flow/SKILL.md'],
  'project-flow-phase-skill': ['requirements', 'design', 'plan'].map((id) => 'docs/ai/skills/' + id + '/SKILL.md'),
  [WORKFLOW_KIND]: [WORKFLOW_DOC],
});

function hasKnownManagedPath(entry, definitions) {
  if (DEVELOPMENT_UNIT_KINDS.has(entry.kind)) {
    // Per-unit artifacts recover both their prefix and id from their own path, which is
    // why they are listed in DEVELOPMENT_UNIT_KINDS rather than the static table above.
    const unit = recoverDevelopmentUnit(entry);
    return Boolean(unit) && matchesDevelopmentUnitShape(entry, unit);
  }
  if (entry.kind === 'development-documentation-index') return entry.path === 'docs/ai/development/index.json';
  if (entry.kind === 'repository-family-index') return isSameKnownPath(entry.path, 'docs/ai/repository-family.json');
  if (entry.kind === 'development-readme') return entry.path === 'README.md' || entry.path.endsWith('/README.md');
  if (entry.kind === 'brownfield-understanding-skill') return entry.path === 'docs/ai/skills/brownfield-understanding/SKILL.md';
  if (entry.kind === 'brownfield-understanding-adapter-skill') return declaredSkillDirectories().some((directory) => entry.path === `${directory}/brownfield-understanding/SKILL.md`);
  if (entry.kind === 'adapter') return entry.path === (entry.ownership === 'full' ? '.cursor/rules/ai-code-governance.mdc' : 'CLAUDE.md');
  if (Object.hasOwn(FIXED_MANAGED_PATHS, entry.kind)) return FIXED_MANAGED_PATHS[entry.kind].some((fixed) => isSameKnownPath(entry.path, fixed));
  if (entry.kind === 'canonical') return isSameKnownPath(entry.path, entry.source === 'capability-pack-registry' ? 'docs/ai/stack-profile.json' : 'docs/ai/decision-ledger.json');
  // Stack adapter skills come from the capability pack registry; the per-stack
  // definition list in `supportedSkillDefinitions` covers every pack, including the
  // `generic-unknown` fallback that the orchestrator keeps around for any client
  // directory. Treating this as a fallback lets the trust table accept adapters that
  // were installed before a topology migration away from single-repo mode without
  // listing each `(client, pack)` pair explicitly.
  if (entry.kind === 'adapter-skill' && typeof entry.source === 'string'
    && entry.source.startsWith('docs/ai/skills/') && entry.source.endsWith('/SKILL.md')) {
    return declaredSkillDirectories().some((directory) => entry.path === `${directory}/${entry.source.slice('docs/ai/skills/'.length)}`);
  }
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
  const relationship = normalizeRelationship([entry?.ownership, entry?.kind, entry?.source].join('\0'));
  if (KNOWN_MANAGED_RELATIONSHIPS.has(relationship)) return true;
  // development-unit-* kinds have a per-unit documentation source path, so the static
  // relationship table cannot enumerate them. Trust the entry iff its own path recovers the
  // unit and its source cites that same unit. An entry that fails either check stays
  // untrusted, so unmanaged content is never silently deleted.
  if (DEVELOPMENT_UNIT_KINDS.has(entry?.kind) && isKnownDevelopmentUnitPath(entry)) return true;
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

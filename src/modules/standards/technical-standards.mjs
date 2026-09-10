import path from 'node:path';
import { GENERATED_MARKER, PACKAGE_ROOT } from '../../constants.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { stableJson, unique } from '../../shared/index.mjs';

const REGISTRY_PATH = 'assets/registries/technical-standard-registry.json';
const STANDARD_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PACKAGE_NAME = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

function asSortedStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === 'string' && value.length > 0))].sort((left, right) => left.localeCompare(right));
}

function sourceSnapshot(source) {
  return {
    id: source.id,
    kind: source.kind,
    title: source.title,
    ...(source.url ? { url: source.url } : {}),
    retrievedAt: source.retrievedAt,
  };
}

export function validateTechnicalStandardRegistry(registry) {
  if (!registry || registry.schemaVersion !== 1 || !Array.isArray(registry.standards)) {
    throw usageError('Technical standard registry must contain schemaVersion 1 and a standards array.');
  }
  const snapshot = registry.snapshot;
  if (!snapshot || snapshot.status !== 'reviewed-offline-snapshot' || !ISO_DATE.test(snapshot.reviewedAt ?? '') || !Number.isInteger(snapshot.refreshAfterDays) || snapshot.refreshAfterDays < 1 || typeof snapshot.boundary !== 'string' || !snapshot.boundary) {
    throw usageError('Technical standard registry must declare a reviewed offline snapshot and refresh boundary.');
  }
  const ids = new Set();
  const sourceIds = new Set();
  for (const standard of registry.standards) {
    if (!standard || !STANDARD_ID.test(standard.id ?? '')) throw usageError('Each technical standard needs a safe kebab-case id.');
    if (ids.has(standard.id)) throw usageError(`Technical standard registry contains duplicate id: ${standard.id}`);
    ids.add(standard.id);
    if (typeof standard.title !== 'string' || !standard.title) throw usageError(`Technical standard ${standard.id} needs a title.`);
    const applies = standard.appliesTo;
    if (applies?.packsAny !== undefined) throw usageError(`Technical standard ${standard.id} must use exact package selectors, not broad stack selectors.`);
    const packagesAny = asSortedStrings(applies?.packagesAny);
    if (!applies || (applies.always !== true && packagesAny.length === 0)) {
      throw usageError(`Technical standard ${standard.id} needs an explicit applicability condition.`);
    }
    if (packagesAny.some((name) => !PACKAGE_NAME.test(name))) throw usageError(`Technical standard ${standard.id} has an invalid package selector.`);
    if (!Array.isArray(standard.sources) || standard.sources.length === 0) throw usageError(`Technical standard ${standard.id} needs at least one source.`);
    for (const source of standard.sources) {
      if (!source || !STANDARD_ID.test(source.id ?? '') || typeof source.kind !== 'string' || !source.kind || typeof source.title !== 'string' || !source.title || !ISO_DATE.test(source.retrievedAt ?? '')) {
        throw usageError(`Technical standard ${standard.id} has an invalid source.`);
      }
      if (source.kind !== 'governance-principle' && !/^https:\/\//.test(source.url ?? '')) {
        throw usageError(`Technical standard ${standard.id} source ${source.id} must use an HTTPS URL.`);
      }
      if (sourceIds.has(source.id)) throw usageError(`Technical standard registry contains duplicate source id: ${source.id}`);
      sourceIds.add(source.id);
    }
    for (const field of ['practices', 'verification', 'boundaries']) {
      if (!Array.isArray(standard[field]) || standard[field].length === 0 || standard[field].some((item) => typeof item !== 'string' || !item)) {
        throw usageError(`Technical standard ${standard.id} needs non-empty ${field}.`);
      }
    }
  }
  return registry;
}

export function loadTechnicalStandardRegistry(registryPath = path.join(PACKAGE_ROOT, REGISTRY_PATH)) {
  return validateTechnicalStandardRegistry(readJson(registryPath));
}

function declaredPackages(config) {
  return asSortedStrings(config?.technologyPackages);
}

function detectedPackageNames(scan) {
  return asSortedStrings(Object.keys(scan.packageDependencies ?? {}));
}

function selectionReason(standard, installed, declared) {
  if (standard.appliesTo.always) return { kind: 'always', evidence: ['governance-baseline'] };
  const installedMatches = asSortedStrings(standard.appliesTo.packagesAny).filter((name) => installed.includes(name));
  if (installedMatches.length > 0) return { kind: 'installed-package', evidence: installedMatches };
  const declaredMatches = asSortedStrings(standard.appliesTo.packagesAny).filter((name) => declared.includes(name));
  if (declaredMatches.length > 0) return { kind: 'declared-technology', evidence: declaredMatches };
  return null;
}

export function selectTechnicalStandards(scan, config, registry = loadTechnicalStandardRegistry()) {
  const installedPackages = detectedPackageNames(scan);
  const configuredPackages = declaredPackages(config);
  const stackIds = asSortedStrings(config?.stacks ?? scan.stacks?.map((stack) => stack.id));
  const selected = registry.standards
    .map((standard) => ({ standard, selection: selectionReason(standard, installedPackages, configuredPackages) }))
    .filter((entry) => entry.selection)
    .sort((left, right) => left.standard.id.localeCompare(right.standard.id));
  return {
    snapshot: registry.snapshot,
    installedPackages,
    configuredPackages,
    stackIds,
    selected,
  };
}

function markdownList(values) {
  return values.map((value) => `- ${value}`).join('\n');
}

function sourcesMarkdown(sources) {
  return sources.map((source) => {
    const link = source.url ? `[${source.title}](${source.url})` : source.title;
    return `- ${link} — ${source.kind}; retrieved ${source.retrievedAt}.`;
  }).join('\n');
}

function technicalSkill(standard, selection, snapshot) {
  return `---
name: ${standard.id}
description: Apply the reviewed ${standard.title} guidance only when its declared technology evidence matches the task.
---

# ${standard.title}

<!-- ${GENERATED_MARKER} -->

## Applicability

- Selection: \`${selection.kind}\` (${selection.evidence.join(', ')})
- Source status: \`${snapshot.status}\`; reviewed ${snapshot.reviewedAt}; refresh after ${snapshot.refreshAfterDays} days.

## Evidence sources

${sourcesMarkdown(standard.sources)}

## Required practices

${markdownList(standard.practices)}

## Required verification

${markdownList(standard.verification)}

## Boundaries

${markdownList(standard.boundaries)}

- This Skill is stated guidance, not a claim of enforced policy or real-client verification.
`;
}

function technicalStandardsManifest(selection) {
  return {
    schemaVersion: 1,
    status: selection.snapshot.status,
    reviewedAt: selection.snapshot.reviewedAt,
    refreshAfterDays: selection.snapshot.refreshAfterDays,
    boundary: selection.snapshot.boundary,
    technologyEvidence: {
      installedPackages: selection.installedPackages,
      configuredPackages: selection.configuredPackages,
      selectedStacks: selection.stackIds,
    },
    skills: selection.selected.map(({ standard, selection: reason }) => ({
      id: standard.id,
      title: standard.title,
      path: `docs/ai/skills/standards/${standard.id}/SKILL.md`,
      applicability: reason,
      sources: standard.sources.map(sourceSnapshot),
      verification: standard.verification,
      boundaries: standard.boundaries,
      claimState: 'stated',
    })),
    generationVerification: {
      requiredCommand: 'aicg check .',
      boundary: 'The generator verifies managed artifact integrity. Framework and business verification remain project-specific and must be run separately.',
    },
  };
}

export function buildTechnicalStandardArtifacts(config, scan, registry = loadTechnicalStandardRegistry()) {
  const selection = selectTechnicalStandards(scan, config, registry);
  const manifest = technicalStandardsManifest(selection);
  const artifacts = [{
    path: 'docs/ai/technical-standards.json',
    content: stableJson(manifest),
    ownership: 'full',
    kind: 'technical-standard-manifest',
    source: 'technical-standard-registry',
  }];
  for (const { standard, selection: reason } of selection.selected) {
    const canonicalPath = `docs/ai/skills/standards/${standard.id}/SKILL.md`;
    const content = technicalSkill(standard, reason, selection.snapshot);
    artifacts.push({
      path: canonicalPath,
      content,
      ownership: 'full',
      kind: 'technical-standard-skill',
      source: 'technical-standard-registry',
    });
    const adapters = [];
    const agents = config?.clients ?? [];
    if (agents.some((agent) => ['codex', 'cursor', 'generic'].includes(agent))) adapters.push(`.agents/skills/standards/${standard.id}/SKILL.md`);
    if (agents.includes('claude-code')) adapters.push(`.claude/skills/standards/${standard.id}/SKILL.md`);
    for (const adapterPath of unique(adapters)) {
      artifacts.push({
        path: adapterPath,
        content,
        ownership: 'full',
        kind: 'technical-standard-adapter-skill',
        source: canonicalPath,
      });
    }
  }
  return { selection, manifest, artifacts };
}

export function technicalStandardsSummary(scan, config, registry = loadTechnicalStandardRegistry()) {
  const selection = selectTechnicalStandards(scan, config, registry);
  const manifest = technicalStandardsManifest(selection);
  return {
    schemaVersion: 1,
    mode: 'read-only-preview',
    target: scan.root,
    status: manifest.status,
    reviewedAt: manifest.reviewedAt,
    refreshAfterDays: manifest.refreshAfterDays,
    technologyEvidence: manifest.technologyEvidence,
    skills: manifest.skills.map(({ path: skillPath, ...skill }) => ({ ...skill, generatedPath: skillPath })),
    verification: manifest.generationVerification,
    boundary: manifest.boundary,
  };
}

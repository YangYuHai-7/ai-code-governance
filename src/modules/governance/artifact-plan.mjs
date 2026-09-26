import fs from 'node:fs';
import path from 'node:path';
import {
  CONFIG_PATH,
  GENERATED_MARKER,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  TEMPLATE_VERSION,
  TOOL_NAME,
} from '../../constants.mjs';
import { snapshotPath } from '../../preconditions.mjs';
import { lstatSafe, readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, normalizeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { linkAncestor, nonDirectoryAncestor, plannedLinkAncestor } from './link-paths.mjs';
import { managedContentHash, previousManifestEntry, buildManifest } from './manifest.mjs';
import { canonicalPath, canonicalPathVariants, classifyRetainedArtifact, COMPACT_PATH_PAIRS, migrationTarget } from './layout.mjs';
import { loadManifest } from './manifest-store.mjs';
import { validateManifestRemovalAuthority } from './manifest-trust.mjs';
import {
  mergeGitignoreBlock,
  mergeManagedBlock,
  removeGitignoreBlock,
  removeManagedBlock,
} from './managed-block.mjs';

function mergeOwnedContent(current, artifact) {
  if (artifact.ownership === 'managed-block') return mergeManagedBlock(current, artifact.content);
  if (artifact.ownership === 'gitignore-block') return mergeGitignoreBlock(current, artifact.content);
  return artifact.content;
}

function removeOwnedBlock(current, ownership) {
  if (ownership === 'managed-block') return removeManagedBlock(current);
  if (ownership === 'gitignore-block') return removeGitignoreBlock(current);
  return current;
}

const CONTEXT_MAP_PATH = 'docs/ai/context-map.yaml';

function yamlProfilesBounds(content) {
  const lines = content.split(/\r?\n/);
  const starts = lines.flatMap((line, index) => line === 'profiles:' ? [index] : []);
  if (starts.length !== 1) {
    throw new Error(`${CONTEXT_MAP_PATH}: expected exactly one top-level profiles container; found ${starts.length}`);
  }
  const start = starts[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_-]+:\s*/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return { lines, start, end };
}

function yamlProfileBlock(content, profileName) {
  const { lines, start: profilesStart, end: profilesEnd } = yamlProfilesBounds(content);
  const escapedName = profileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const profileHeader = new RegExp(`^  (?:${escapedName}|["']${escapedName}["'])\\s*:\\s*$`);
  const starts = lines.flatMap((line, index) => index > profilesStart && index < profilesEnd && profileHeader.test(line) ? [index] : []);
  if (starts.length === 0) return null;
  if (starts.length > 1) throw new Error(`${CONTEXT_MAP_PATH}: duplicate ${profileName} profiles are not safe to merge`);
  const [start] = starts;
  let end = profilesEnd;
  for (let index = start + 1; index < profilesEnd; index += 1) {
    if (/^  (?:[A-Za-z0-9_-]+|["'][A-Za-z0-9_-]+["'])\s*:/.test(lines[index]) || /^[A-Za-z0-9_-]+\s*:/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}

function yamlTopLevelBlock(content, key) {
  const lines = content.split(/\r?\n/);
  const escapedName = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const header = new RegExp(`^${escapedName}:\\s*$`);
  const starts = lines.flatMap((line, index) => header.test(line) ? [index] : []);
  if (starts.length === 0) return null;
  if (starts.length > 1) throw new Error(`${CONTEXT_MAP_PATH}: duplicate top-level ${key} blocks are not safe to merge`);
  const [start] = starts;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^[A-Za-z0-9_-]+:\s*/.test(lines[index])) {
      end = index;
      break;
    }
  }
  return lines.slice(start, end).join('\n').trimEnd();
}


function recognizedLegacyBusinessProfile(profile) {
  const lines = profile?.split(/\r?\n/) ?? [];
  const standardPrefix = [
    '  business_constraints:',
    '    description: Apply owner-confirmed business invariants without inferring risk from wording.',
    '    triggers:',
    '      en: [business rule, invariant, acceptance]',
    '      zh: [业务规则, 不变量, 验收]',
    '    required:',
    '      - docs/ai/business-constraints.json',
    '      - docs/ai/skills/business-constraints/SKILL.md',
    '    verify:',
  ];
  const isStandard = lines.length === standardPrefix.length + 1
    && standardPrefix.every((line, index) => lines[index] === line)
    && /^      - (?:aicg|npm exec -- aicg|npm exec --yes --package=ai-code-governance@\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)? -- aicg) check \.$/.test(lines.at(-1));
  const minimal = [
    '  business_constraints:',
    '    description: Production readiness is blocked until every owner-confirmed constraint has complete evidence bound to its current id, text, and hash; recorded evidence remains unverified and only eligible for review.',
    '    required:',
    '      - docs/ai/business-constraints.json',
    '    cta: Select standard or complete governance to generate the routable business constraint Skill, then record success plus negative or boundary evidence.',
  ];
  return isStandard || (lines.length === minimal.length && minimal.every((line, index) => lines[index] === line));
}

function conditionalSeedLayout(profile) {
  const lines = profile.split(/\r?\n/);
  const headers = lines.flatMap((line, index) => /^    (?:conditional|["']conditional["'])\s*:/.test(line) ? [index] : []);
  if (headers.length !== 1 || !/^    conditional:(?: \{\})?$/.test(lines[headers[0]])) {
    throw new Error(`${CONTEXT_MAP_PATH}: behavior_change profile has no unambiguous safe conditional block to extend`);
  }
  const start = headers[0];
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^    \S/.test(lines[index]) && !/^\s*#/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const empty = lines[start] === '    conditional: {}';
  const conditions = new Map();
  let active = null;
  for (let index = start + 1; index < end; index += 1) {
    const line = lines[index];
    if (/^\s*(?:#.*)?$/.test(line)) continue;
    if (empty) throw new Error(`${CONTEXT_MAP_PATH}: empty conditional map has conflicting nested content`);
    const header = line.match(/^      (?:([A-Za-z0-9_-]+)|["']([A-Za-z0-9_-]+)["']):\s*$/);
    if (header) {
      active = header[1] ?? header[2];
      if (conditions.has(active)) throw new Error(`${CONTEXT_MAP_PATH}: duplicate ${active} conditions are not safe to merge`);
      conditions.set(active, { header: line, entries: [] });
    } else if (active && /^        -\s+(?:[A-Za-z0-9._/-]+|"[A-Za-z0-9._/-]+"|'[A-Za-z0-9._/-]+')\s*$/.test(line)) {
      conditions.get(active).entries.push(line);
    } else {
      throw new Error(`${CONTEXT_MAP_PATH}: unsupported conditional mapping syntax is not safe to merge`);
    }
  }
  return { lines, start, end, empty, conditions };
}

function routeEntryPath(line) {
  return line.replace(/^ +- /, '');
}

function routesAreCounterparts(left, right) {
  const a = routeEntryPath(left);
  const b = routeEntryPath(right);
  return a !== b && (canonicalPathVariants(a).includes(b) || canonicalPathVariants(b).includes(a));
}

/**
 * Rewrite every generated route to its compact counterpart when the desired map names that
 * destination. Owner-authored routes that never had a generated counterpart are left alone.
 */
function migrateGeneratedRoutes(content, desired) {
  const desiredPaths = new Set([...desired.matchAll(/^ +- (\S+)$/gm)].map((match) => match[1]));
  return content.replace(/^( +- )(\S+)$/gm, (line, indent, pathValue) => {
    const compact = canonicalPath(pathValue, 'compact');
    return compact !== pathValue && desiredPaths.has(compact) ? indent + compact : line;
  });
}

function mergeConditionalSeedRoutes(current, desired) {
  const currentProfile = yamlProfileBlock(current, 'behavior_change');
  const desiredProfile = yamlProfileBlock(desired, 'behavior_change');
  const required = conditionalSeedLayout(desiredProfile);
  if (required.conditions.size === 0) return current;
  const existing = conditionalSeedLayout(currentProfile);
  const additions = [];
  let changed = false;
  for (const [condition, route] of required.conditions) {
    const present = existing.conditions.get(condition);
    if (present) {
      const originalPresent = [...present.entries];
      const missing = [];
      // A footprint change rewrites a generated route to its compact counterpart in place,
      // preserving every owner-authored entry and the surrounding order.
      for (const desiredEntry of route.entries) {
        if (present.entries.includes(desiredEntry)) continue;
        const legacy = present.entries.find((entry) => routesAreCounterparts(entry, desiredEntry));
        if (legacy) {
          existing.lines[existing.lines.indexOf(legacy)] = desiredEntry;
          present.entries[present.entries.indexOf(legacy)] = desiredEntry;
          changed = true;
          continue;
        }
        missing.push(desiredEntry);
      }
      if (missing.length > 0) {
        const overlapsGeneratedRoute = route.entries.some((entry) => originalPresent.includes(entry));
        const generatedSkillExpansion = missing.every((entry) => /^        - docs\/ai\/skills\/(?:standards|project-conventions)\/[A-Za-z0-9._/-]+\/SKILL\.md$/.test(entry)
          || /^        - docs\/ai\/skills\/[a-z0-9]+(?:-[a-z0-9]+)*\/SKILL\.md$/.test(entry));
        // The approved project roster is generated under the same team_orchestrator condition as
        // the Skill. When the Skill already ships by default, adding the roster later must extend
        // that condition instead of being rejected as an owner-authored conflict.
        const generatedRosterExpansion = missing.every((entry) => /^        - (?:\.ai-governance\/state\/agent-team\.json|docs\/ai\/agent-team\.json)$/.test(entry));
        if (overlapsGeneratedRoute && !generatedSkillExpansion && !generatedRosterExpansion) {
          throw new Error(`${CONTEXT_MAP_PATH}: ${condition} condition conflicts with the required AICG route`);
        }
        const headerIndex = existing.lines.indexOf(present.header);
        let insertionIndex = headerIndex + 1;
        while (insertionIndex < existing.lines.length && /^        -/.test(existing.lines[insertionIndex])) insertionIndex += 1;
        existing.lines.splice(insertionIndex, 0, ...missing);
        if (insertionIndex <= existing.end) existing.end += missing.length;
        present.entries.push(...missing);
        changed = true;
      }
    } else {
      additions.push(route.header, ...route.entries);
    }
  }
  if (additions.length > 0) {
    if (existing.empty) existing.lines[existing.start] = '    conditional:';
    existing.lines.splice(existing.end, 0, ...additions);
    changed = true;
  }
  if (!changed) return current;
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  return current.replace(currentProfile.replaceAll('\n', newline), existing.lines.join(newline));
}

// Adopting a foreign canonical root must extend it, never replace it. When the existing
// context-map already uses a single `profiles:` container but has none of AICG's required
// base/ordinary/behavior_change/release routing, prepend the required layout and leave every
// owner-authored key and profile exactly as it was. This is the only non-destructive way to
// let AICG's own structure check pass on a repository whose routing predates AICG.
function appendRequiredIncrementalLayout(current, desired) {
  const requiredBase = yamlTopLevelBlock(desired, 'base');
  const requiredOrdinary = yamlProfileBlock(desired, 'ordinary');
  const requiredBehavior = yamlProfileBlock(desired, 'behavior_change');
  const requiredRelease = yamlProfileBlock(desired, 'release');
  if (!requiredBase || !requiredOrdinary || !requiredBehavior || !requiredRelease) {
    throw new Error(`${CONTEXT_MAP_PATH}: generated incremental profile layout is incomplete`);
  }
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const { lines, start: profilesStart } = yamlProfilesBounds(current);
  const additions = [
    ['ordinary', requiredOrdinary],
    ['behavior_change', requiredBehavior],
    ['release', requiredRelease],
  ].filter(([name]) => !yamlProfileBlock(current, name));
  lines.splice(profilesStart + 1, 0, ...additions.flatMap(([, block]) => block.split('\n')));
  lines.splice(profilesStart, 0, ...requiredBase.split('\n'));
  const merged = `${lines.join(newline).replace(new RegExp(`${newline}+$`), '')}${newline}`;
  const mergedLines = merged.split(/\r?\n/);
  const baseHeaders = mergedLines.filter((line) => line === 'base:').length;
  const profileHeaders = mergedLines.filter((line) => line === 'profiles:').length;
  if (baseHeaders !== 1 || profileHeaders !== 1) {
    throw new Error(`${CONTEXT_MAP_PATH}: adopting the existing context-map would leave ambiguous base or profiles containers`);
  }
  return merged;
}

function mergeLegacyContextMapSeed(current, desired, options = {}) {
  const legacyProfile = yamlProfileBlock(current, 'business_constraints');
  if (legacyProfile && !recognizedLegacyBusinessProfile(legacyProfile)) {
    throw new Error(`${CONTEXT_MAP_PATH}: existing business_constraints profile conflicts with the required AICG route`);
  }
  const currentBase = yamlTopLevelBlock(current, 'base');
  const currentOrdinary = yamlProfileBlock(current, 'ordinary');
  const currentBehavior = yamlProfileBlock(current, 'behavior_change');
  const currentRelease = yamlProfileBlock(current, 'release');
  const hasIncrementalLayout = Boolean(currentBase && currentOrdinary && currentBehavior && currentRelease);
  const hasAnyIncrementalLayout = Boolean(currentBase || currentOrdinary || currentBehavior);

  if (!hasIncrementalLayout) {
    if (hasAnyIncrementalLayout) {
      throw new Error(`${CONTEXT_MAP_PATH}: partial incremental profile layout is not safe to merge`);
    }
    const legacyImplementation = yamlProfileBlock(current, 'implementation');
    const legacyReview = yamlProfileBlock(current, 'review');
    if (!legacyImplementation || !legacyReview || !currentRelease) {
      if (options.adoptForeign) return appendRequiredIncrementalLayout(current, desired);
      throw new Error(`${CONTEXT_MAP_PATH}: unrecognized legacy profile layout is not safe to merge`);
    }
    if (!canonicalPathVariants('docs/ai/release-acceptance-policy.json').some((route) => currentRelease.includes(`      - ${route}`))) {
      throw new Error(`${CONTEXT_MAP_PATH}: legacy release profile does not contain the generated release policy route`);
    }
    const releaseExtendsValues = [...currentRelease.matchAll(/^    extends:\s+["']?([A-Za-z0-9_-]+)["']?\s*$/gm)].map((match) => match[1]);
    if (releaseExtendsValues.length > 1) {
      throw new Error(`${CONTEXT_MAP_PATH}: legacy release profile declares duplicate extends targets`);
    }
    const releaseExtends = releaseExtendsValues[0] ?? null;
    if (releaseExtends && releaseExtends !== 'ordinary') {
      throw new Error(`${CONTEXT_MAP_PATH}: legacy release profile extends conflicting profile ${releaseExtends}`);
    }
    const requiredBase = yamlTopLevelBlock(desired, 'base');
    const requiredOrdinary = yamlProfileBlock(desired, 'ordinary');
    const requiredBehavior = yamlProfileBlock(desired, 'behavior_change');
    if (!requiredBase || !requiredOrdinary || !requiredBehavior) {
      throw new Error(`${CONTEXT_MAP_PATH}: generated incremental profile layout is incomplete`);
    }
    const newline = current.includes('\r\n') ? '\r\n' : '\n';
    const { lines, start: profilesStart } = yamlProfilesBounds(current);
    const releaseStart = lines.findIndex((line, index) => index > profilesStart && line === '  release:');
    if (releaseStart === -1) throw new Error(`${CONTEXT_MAP_PATH}: legacy release profile header is not safe to merge`);
    if (!releaseExtends) lines.splice(releaseStart + 1, 0, '    extends: ordinary');
    lines.splice(profilesStart + 1, 0, ...requiredOrdinary.split('\n'), ...requiredBehavior.split('\n'));
    lines.splice(profilesStart, 0, ...requiredBase.split('\n'));
    const rebuilt = `${lines.join(newline).replace(new RegExp(`${newline}+$`), '')}${newline}`;
    return options.migration === true ? migrateGeneratedRoutes(rebuilt, desired) : rebuilt;
  }

  const desiredRelease = yamlProfileBlock(desired, 'release');
  const desiredReleaseRoute = desiredRelease?.match(/^      - (\S*release-acceptance-policy\.json)$/m)?.[1] ?? null;
  if (desiredReleaseRoute && /^    required: \[\]$/m.test(currentRelease)) {
    const newline = current.includes('\r\n') ? '\r\n' : '\n';
    const expanded = currentRelease.replace(/^    required: \[\]$/m, `    required:\n      - ${desiredReleaseRoute}`);
    current = current.replace(currentRelease.replaceAll('\n', newline), expanded.replaceAll('\n', newline));
  }
  const merged = mergeConditionalSeedRoutes(current, desired);
  // Only an explicit footprint migration rewrites generated routes to their compact form.
  // Ordinary sync preserves the recorded layout, including a legacy base route.
  return options.migration === true ? migrateGeneratedRoutes(merged, desired) : merged;
}

function trustedLegacyManifest(root, manifest) {
  if (
    manifest?.schemaVersion !== MANIFEST_SCHEMA_VERSION
    || manifest.generatedBy !== TOOL_NAME
    || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.toolVersion ?? '')
    || !Number.isInteger(manifest.templateVersion)
    || manifest.templateVersion < 1
    || manifest.templateVersion > TEMPLATE_VERSION
  ) return false;
  const agents = previousManifestEntry(manifest, 'AGENTS.md');
  if (
    agents?.ownership !== 'managed-block'
    || agents.kind !== 'entrypoint'
    || agents.source !== 'template:agents'
    || !/^[a-f0-9]{64}$/.test(agents.sha256 ?? '')
  ) return false;
  try {
    return managedContentHash(readText(path.join(root, 'AGENTS.md'), ''), 'managed-block') === agents.sha256;
  } catch {
    return false;
  }
}

/** The startup closure: an artifact the first-run/kernel contract always depends on. */
const KERNEL_REQUIRED_PATHS = new Set([
  'AGENTS.md',
  'CLAUDE.md',
  'docs/ai/README.md',
  'docs/ai/context-map.yaml',
  'docs/ai/rules/00_always.mdc',
  'docs/ai/policies/00_always.mdc',
  CONFIG_PATH,
  MANIFEST_PATH,
]);

/**
 * Paths a current context map, the active configuration, or a recorded manifest source still
 * references. A trusted artifact that is still referenced is 'reachable' and may be migrated,
 * never treated as dormant cleanup material.
 */
function referencedPathsFor(root, artifacts) {
  const referenced = new Set();
  // The target context map is the authority: a route the new plan still emits is reachable;
  // a route only the stale tree carried is not.
  const contextMap = (artifacts ?? []).find((artifact) => normalizeRelative(artifact.path) === CONTEXT_MAP_PATH);
  if (contextMap) {
    const content = typeof contextMap.content === 'string' ? contextMap.content
      : (typeof contextMap.desired === 'string' ? contextMap.desired : '');
    for (const match of content.matchAll(/^ +- (\S+)$/gm)) referenced.add(match[1]);
  }
  try {
    const recorded = readText(path.join(root, CONFIG_PATH), '');
    for (const [legacy] of COMPACT_PATH_PAIRS) if (recorded.includes(legacy)) referenced.add(legacy);
  } catch { /* A missing configuration references nothing. */ }
  return referenced;
}

/** Thin data-gathering wrapper: callers hold (root, entry, referencedPaths). */
function classifyRetainedEntry(root, entry, relative, referencedPaths) {
  const absolute = path.join(root, relative);
  const stat = lstatSafe(absolute);
  const isLink = Boolean(stat?.isSymbolicLink()) || Boolean(linkAncestor(root, relative));
  let managedHashMatches = false;
  let hasUserContent = false;
  if (stat?.isFile() && !isLink && ['full', 'managed-block', 'gitignore-block'].includes(entry.ownership)
    && /^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
    try {
      const current = readText(absolute, '');
      managedHashMatches = managedContentHash(current, entry.ownership) === entry.sha256;
      hasUserContent = !managedHashMatches;
    } catch {
      hasUserContent = true;
    }
  }
  return classifyRetainedArtifact({ ...entry, path: relative, requiredByKernel: KERNEL_REQUIRED_PATHS.has(relative) }, {
    referencedPaths,
    managedHashMatches,
    isLink,
    hasUserContent,
  });
}

function candidateAction(classification, newPath) {
  if (classification === 'historical-or-user') return 'keep';
  if (newPath) return 'migrate';
  if (classification === 'dormant-managed') return 'delete';
  return 'keep';
}

/** A report-only candidate: never written by apply, so the manifest contract is unchanged. */
function candidateOperation(entry, relative, classification, newPath, referencedPaths) {
  return {
    path: relative,
    ownership: entry.ownership,
    kind: entry.kind ?? 'legacy',
    source: entry.source ?? null,
    sha256: entry.sha256 ?? null,
    classification,
    action: candidateAction(classification, newPath),
    migration: newPath ? { from: relative, to: newPath } : null,
    referenced: referencedPaths instanceof Set ? referencedPaths.has(relative) : false,
    candidate: true,
    remove: false,
    changed: false,
  };
}

export function planArtifacts(root, artifacts, options = {}) {
  const manifest = loadManifest(root);
  const operations = [];
  const conflicts = [];
  const retained = [];
  const manualCleanupCandidates = [];
  const links = new Set();
  const expectedPaths = new Set(artifacts.map((artifact) => normalizeRelative(artifact.path)));
  const previousFiles = Array.isArray(manifest?.files) ? manifest.files : [];
  const manifestRemovalAuthority = validateManifestRemovalAuthority(root, manifest);
  // Adopting foreign governance must never overwrite existing files, so the caller's
  // replaceExisting request is dropped for the whole plan rather than only for known seeds.
  const replaceExisting = options.replaceExisting === true && options.adoptForeignGovernance !== true;
  if (options.allowStaleRemoval && !manifestRemovalAuthority.trusted) {
    conflicts.push(`${MANIFEST_PATH}: manifest is not trusted for stale removal (${manifestRemovalAuthority.errors.join(', ')})`);
  }
  const legacyManagedProject = trustedLegacyManifest(root, manifest);
  if (manifest && manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) conflicts.push(`${MANIFEST_PATH}: unsupported schemaVersion`);
  if (manifest && !Array.isArray(manifest.files)) conflicts.push(`${MANIFEST_PATH}: files must be an array`);

  for (const artifact of artifacts) {
    const relative = normalizeRelative(artifact.path);
    if (!isSafeRelative(relative)) {
      conflicts.push(`${relative}: generated artifact path is not a safe repository-relative path`);
      continue;
    }
    const absolute = path.join(root, relative);
    const invalidAncestor = nonDirectoryAncestor(root, relative);
    if (invalidAncestor) {
      conflicts.push(`${normalizeRelative(path.relative(root, invalidAncestor))}: expected a directory ancestor but found another filesystem object`);
      continue;
    }
    const ancestor = linkAncestor(root, relative);
    if (ancestor) {
      links.add(ancestor);
      if (!options.migrateLinks) {
        conflicts.push(`${normalizeRelative(path.relative(root, ancestor))}: link adapter requires explicit --migrate-links`);
        continue;
      }
    }

    const existingStat = lstatSafe(absolute);
    if (existingStat && !existingStat.isFile() && !existingStat.isSymbolicLink()) {
      conflicts.push(`${relative}: expected a file but found another filesystem object`);
      continue;
    }

    const current = ancestor ? '' : readText(absolute, '');
    if (artifact.ownership === 'seed') {
      const seedExists = !ancestor && Boolean(existingStat);
      const adoptForeign = options.adoptForeignGovernance === true;
      // Adoption preserves every pre-existing canonical seed and extends the routing file
      // instead of replacing it, even when the caller asked for replaceExisting.
      let desired = seedExists && !replaceExisting ? current : artifact.content;
      if (seedExists && relative === CONTEXT_MAP_PATH && !replaceExisting) {
        try {
          const merged = mergeLegacyContextMapSeed(current, artifact.content, { adoptForeign, migration: options.migration === true });
          if (legacyManagedProject || adoptForeign) desired = merged;
          else if (merged !== current) conflicts.push(`${MANIFEST_PATH}: manifest is not trusted to extend ${CONTEXT_MAP_PATH}`);
        } catch (error) {
          conflicts.push(error.message);
        }
      }
      operations.push({
        ...artifact,
        path: relative,
        absolute,
        desired,
        changed: current !== desired,
      });
      continue;
    }
    let desired;
    try {
      desired = mergeOwnedContent(current, artifact);
    } catch (error) {
      conflicts.push(`${relative}: ${error.message}`);
      continue;
    }

    const previous = previousManifestEntry(manifest, relative);
    if (current && current !== desired) {
      const currentHash = managedContentHash(current, artifact.ownership);
      const isPreviouslyOwned = previous && previous.ownership === artifact.ownership;
      const isExactSeedPromotion = artifact.ownership === 'full'
        && /^[a-f0-9]{64}$/.test(artifact.promotionSourceSha256 ?? '')
        && sha256(current) === artifact.promotionSourceSha256;
      const recognizableGenerated = current.includes(GENERATED_MARKER);
      if (isPreviouslyOwned && currentHash !== previous.sha256 && !options.force && !replaceExisting) {
        conflicts.push(`${relative}: managed content changed; run sync --force to replace only the managed content`);
        continue;
      }
      if (!isPreviouslyOwned && !isExactSeedPromotion && artifact.ownership === 'full' && !recognizableGenerated && !replaceExisting) {
        conflicts.push(`${relative}: existing unowned file will not be overwritten`);
        continue;
      }
    }
    operations.push({ ...artifact, path: relative, absolute, desired, changed: current !== desired });
  }

  const referencedPaths = referencedPathsFor(root, artifacts);
  const candidates = [];
  // Report-only candidate operations exist for the preview/migration surfaces; ordinary sync
  // keeps its historical operation shape and only carries classifications on retained entries.
  const reportCandidates = options.reportCandidates === true || options.migration === true;
  for (const entry of previousFiles) {
    if (!entry || typeof entry.path !== 'string') {
      conflicts.push(`${MANIFEST_PATH}: every managed entry must contain a string path`);
      continue;
    }
    const relative = normalizeRelative(entry.path);
    if (!isSafeRelative(relative)) {
      conflicts.push(`${relative}: manifest path is not a safe repository-relative path`);
      continue;
    }
    if (expectedPaths.has(relative)) continue;
    const classification = classifyRetainedEntry(root, entry, relative, referencedPaths);
    const target = migrationTarget(relative);
    const newPath = target && expectedPaths.has(target) ? target : null;
    candidates.push({
      path: relative,
      newPath,
      source: entry.source ?? null,
      sha256: entry.sha256 ?? null,
      ownership: entry.ownership,
      kind: entry.kind ?? null,
      classification,
      action: candidateAction(classification, newPath),
      referenced: referencedPaths.has(relative),
      requiredByKernel: KERNEL_REQUIRED_PATHS.has(relative),
    });
    if (entry.ownership === 'seed') {
      retained.push({ ...entry, path: relative, classification });
      if (options.allowStaleRemoval) manualCleanupCandidates.push({ path: relative, ownership: 'seed', classification, reason: 'User-owned seed; review and remove manually.' });
      continue;
    }
    if (options.allowStaleRemoval !== true) {
      retained.push({ ...entry, path: relative, classification });
      if (reportCandidates) operations.push({ ...candidateOperation(entry, relative, classification, newPath, referencedPaths), absolute: path.join(root, relative) });
      continue;
    }
    if (!manifestRemovalAuthority.trusted) {
      retained.push({ ...entry, path: relative, classification: 'historical-or-user' });
      if (reportCandidates) operations.push({ ...candidateOperation(entry, relative, 'historical-or-user', newPath, referencedPaths), absolute: path.join(root, relative) });
      continue;
    }
    const absolute = path.join(root, relative);
    const invalidAncestor = nonDirectoryAncestor(root, relative);
    if (invalidAncestor) {
      conflicts.push(`${normalizeRelative(path.relative(root, invalidAncestor))}: stale managed path requires a directory ancestor but found another filesystem object`);
      continue;
    }
    const ancestor = linkAncestor(root, relative);
    if (ancestor) {
      retained.push({ ...entry, path: relative, classification: 'historical-or-user' });
      manualCleanupCandidates.push({ path: relative, ownership: entry.ownership, classification: 'historical-or-user', reason: 'Stale path traverses a symbolic link; review and remove manually.' });
      if (reportCandidates) operations.push({ ...candidateOperation(entry, relative, 'historical-or-user', newPath, referencedPaths), absolute });
      if (options.migration !== true) conflicts.push(`${relative}: stale path traverses a symbolic link and will not be removed`);
      continue;
    }
    const stat = lstatSafe(absolute);
    if (!stat) continue;
    if (!stat.isFile()) {
      conflicts.push(`${relative}: stale managed path is no longer a regular file`);
      continue;
    }
    if (!['full', 'managed-block', 'gitignore-block'].includes(entry.ownership)) {
      conflicts.push(`${relative}: manifest contains unsupported ownership ${entry.ownership}`);
      continue;
    }
    if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
      conflicts.push(`${relative}: manifest contains an invalid SHA-256`);
      continue;
    }
    const current = readText(absolute, '');
    let actualHash;
    try {
      actualHash = managedContentHash(current, entry.ownership);
    } catch (error) {
      conflicts.push(`${relative}: ${error.message}`);
      continue;
    }
    if (actualHash !== entry.sha256) {
      retained.push({ ...entry, path: relative, classification: 'historical-or-user' });
      manualCleanupCandidates.push({ path: relative, ownership: entry.ownership, classification: 'historical-or-user', reason: 'Managed content drifted or was user-edited; review and remove manually.' });
      if (reportCandidates) operations.push({ ...candidateOperation(entry, relative, 'historical-or-user', newPath, referencedPaths), absolute });
      // A migration keeps drifted/user files and still converges the trusted ones; explicit
      // stale removal (non-migration) refuses to touch them and reports the conflict.
      if (options.migration !== true) conflicts.push(`${relative}: stale managed content changed and will not be removed`);
      continue;
    }
    if (classification === 'historical-or-user') {
      retained.push({ ...entry, path: relative, classification });
      manualCleanupCandidates.push({ path: relative, ownership: entry.ownership, classification, reason: 'User, unknown, or link content; review and remove manually.' });
      if (reportCandidates) operations.push({ ...candidateOperation(entry, relative, classification, newPath, referencedPaths), absolute });
      continue;
    }
    if (['managed-block', 'gitignore-block'].includes(entry.ownership)) {
      let desired;
      try {
        desired = removeOwnedBlock(current, entry.ownership);
      } catch (error) {
        conflicts.push(`${relative}: ${error.message}`);
        continue;
      }
      operations.push({ ...entry, absolute, desired, changed: current !== desired, remove: true, deleteWhenEmpty: desired.trim().length === 0, classification });
      continue;
    }
    if (newPath) {
      // A trusted, unedited artifact with a compact destination migrates by removing the
      // legacy path; the compact artifact is written by the normal artifact plan. Both the
      // removed source and the written destination are bound to their preimages.
      operations.push({
        ...entry,
        path: relative,
        absolute,
        changed: true,
        remove: true,
        deleteWhenEmpty: true,
        classification,
        action: 'migrate',
        migration: { from: relative, to: newPath },
        referenced: referencedPaths.has(relative),
        candidate: true,
      });
      continue;
    }
    if (classification === 'dormant-managed') {
      operations.push({ ...entry, absolute, changed: true, remove: true, deleteWhenEmpty: true, classification, action: 'delete', referenced: referencedPaths.has(relative), candidate: true });
      continue;
    }
    retained.push({ ...entry, path: relative, classification });
    if (reportCandidates) operations.push({ ...candidateOperation(entry, relative, classification, newPath, referencedPaths), absolute });
  }
  // An owner-confirmed baseline rebuild records the current on-disk content as the trusted
  // baseline for every retained fully-managed artifact, so a drifted file the rebuild keeps
  // (for example a dormant Skill index) stops being reported as drift. Ordinary init and sync
  // never take this path.
  if (options.rebaseline === true) {
    for (const entry of retained) {
      if (entry.ownership !== 'full') continue;
      const absolute = path.join(root, entry.path);
      const stat = lstatSafe(absolute);
      if (!stat?.isFile() || stat.isSymbolicLink()) continue;
      try { entry.sha256 = managedContentHash(readText(absolute, ''), entry.ownership); } catch { /* keep the recorded hash */ }
    }
  }
  const linkPaths = [...links];
  if (options.allowStaleRemoval) {
    for (const relative of options.seedPaths ?? []) {
      if (!isSafeRelative(relative) || expectedPaths.has(relative) || manualCleanupCandidates.some((item) => item.path === relative)) continue;
      if (nonDirectoryAncestor(root, relative) || linkAncestor(root, relative)) continue;
      if (lstatSafe(path.join(root, relative))) manualCleanupCandidates.push({ path: relative, ownership: 'seed', reason: 'User-owned seed; review and remove manually.' });
    }
    manualCleanupCandidates.sort((left, right) => left.path.localeCompare(right.path));
  }
  // A migration keeps drifted/user/link artifacts on disk but hands them back to the owner:
  // removing them from the managed manifest is what stops the structural check from reporting
  // them as managed drift, while nothing on disk is moved or deleted.
  const manifestRetained = manifestRemovalAuthority.trusted
    ? (options.migration === true ? retained.filter((entry) => entry.classification !== 'historical-or-user') : retained)
    : [];
  const manifestValue = buildManifest(operations, {
    generatedAt: manifest?.generatedAt ?? null,
    retained: manifestRetained,
  });
  const manifestContent = stableJson(manifestValue);
  const manifestPath = path.join(root, MANIFEST_PATH);
  return {
    operations,
    candidates,
    conflicts,
    retained,
    manualCleanupCandidates,
    links: linkPaths,
    previousManifest: manifest,
    manifest: {
      value: manifestValue,
      content: manifestContent,
      changed: readText(manifestPath, '') !== manifestContent,
    },
    preconditions: {
      root: fs.realpathSync(root),
      files: operations.filter((operation) => !(operation.candidate === true && operation.remove !== true)).map((operation) => {
        const coveredByLink = plannedLinkAncestor(root, linkPaths, operation.path);
        return {
          path: operation.path,
          before: coveredByLink ? { kind: 'covered-by-planned-link', link: coveredByLink } : snapshotPath(operation.absolute),
        };
      }),
      links: linkPaths.map((link) => ({ path: normalizeRelative(path.relative(root, link)), before: snapshotPath(link) })),
      manifest: snapshotPath(path.join(root, MANIFEST_PATH)),
    },
  };
}

import fs from 'node:fs';
import path from 'node:path';
import {
  GENERATED_MARKER,
  MANIFEST_PATH,
  MANIFEST_SCHEMA_VERSION,
  TEMPLATE_VERSION,
  TOOL_NAME,
} from '../../constants.mjs';
import { snapshotPath } from '../../preconditions.mjs';
import { lstatSafe, readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, normalizeRelative, stableJson } from '../../shared/index.mjs';
import { linkAncestor, nonDirectoryAncestor, plannedLinkAncestor } from './link-paths.mjs';
import { managedContentHash, previousManifestEntry, buildManifest } from './manifest.mjs';
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

function yamlConditionalBlock(content, profileName, conditionName) {
  const profile = yamlProfileBlock(content, profileName);
  if (!profile) return null;
  const lines = profile.split(/\r?\n/);
  const escapedName = conditionName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const conditionHeader = new RegExp(`^      (?:${escapedName}|["']${escapedName}["'])\\s*:\\s*$`);
  const starts = lines.flatMap((line, index) => conditionHeader.test(line) ? [index] : []);
  if (starts.length === 0) return null;
  if (starts.length > 1) throw new Error(`${CONTEXT_MAP_PATH}: duplicate ${conditionName} conditions are not safe to merge`);
  const [start] = starts;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^      (?:[A-Za-z0-9_-]+|["'][A-Za-z0-9_-]+["'])\s*:/.test(lines[index]) || /^    [A-Za-z0-9_-]+\s*:/.test(lines[index])) {
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

function mergeLegacyContextMapSeed(current, desired) {
  const requiredBusiness = yamlConditionalBlock(desired, 'behavior_change', 'business');
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
      throw new Error(`${CONTEXT_MAP_PATH}: unrecognized legacy profile layout is not safe to merge`);
    }
    if (!currentRelease.includes('      - docs/ai/release-acceptance-policy.json')) {
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
    return `${lines.join(newline).replace(new RegExp(`${newline}+$`), '')}${newline}`;
  }

  if (!requiredBusiness) return current;
  const existingBusiness = yamlConditionalBlock(current, 'behavior_change', 'business');
  if (existingBusiness) {
    if (existingBusiness === requiredBusiness) return current;
    throw new Error(`${CONTEXT_MAP_PATH}: existing behavior_change business condition conflicts with the required AICG route`);
  }
  const newline = current.includes('\r\n') ? '\r\n' : '\n';
  const lines = current.split(/\r?\n/);
  const profilesStart = lines.findIndex((line) => line === 'profiles:');
  if (profilesStart === -1) return current;
  const behaviorStart = lines.findIndex((line, index) => index > profilesStart && line === '  behavior_change:');
  if (behaviorStart === -1) {
    const requiredProfile = yamlProfileBlock(desired, 'behavior_change');
    if (!requiredProfile) return current;
    let insertion = lines.length;
    for (let index = profilesStart + 1; index < lines.length; index += 1) {
      if (/^[A-Za-z0-9_-]+:\s*$/.test(lines[index])) {
        insertion = index;
        break;
      }
    }
    lines.splice(insertion, 0, ...requiredProfile.split('\n'));
    return `${lines.join(newline).replace(new RegExp(`${newline}+$`), '')}${newline}`;
  }
  let behaviorEnd = lines.length;
  for (let index = behaviorStart + 1; index < lines.length; index += 1) {
    if (/^  (?:[A-Za-z0-9_-]+|["'][A-Za-z0-9_-]+["'])\s*:/.test(lines[index]) || /^[A-Za-z0-9_-]+\s*:/.test(lines[index])) {
      behaviorEnd = index;
      break;
    }
  }
  const conditionalStart = lines.findIndex((line, index) => index > behaviorStart && index < behaviorEnd && line === '    conditional:');
  if (conditionalStart === -1) {
    throw new Error(`${CONTEXT_MAP_PATH}: behavior_change profile has no safe conditional block to extend`);
  }
  let insertion = behaviorEnd;
  for (let index = conditionalStart + 1; index < behaviorEnd; index += 1) {
    if (/^    [A-Za-z0-9_-]+\s*:/.test(lines[index])) {
      insertion = index;
      break;
    }
  }
  lines.splice(insertion, 0, ...requiredBusiness.split('\n'));
  return `${lines.join(newline).replace(new RegExp(`${newline}+$`), '')}${newline}`;
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

export function planArtifacts(root, artifacts, options = {}) {
  const manifest = loadManifest(root);
  const operations = [];
  const conflicts = [];
  const retained = [];
  const links = new Set();
  const expectedPaths = new Set(artifacts.map((artifact) => normalizeRelative(artifact.path)));
  const previousFiles = Array.isArray(manifest?.files) ? manifest.files : [];
  const manifestRemovalAuthority = validateManifestRemovalAuthority(root, manifest);
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
      let desired = seedExists ? current : artifact.content;
      if (seedExists && legacyManagedProject && relative === CONTEXT_MAP_PATH) {
        try {
          desired = mergeLegacyContextMapSeed(current, artifact.content);
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
      const recognizableGenerated = current.includes(GENERATED_MARKER);
      if (isPreviouslyOwned && currentHash !== previous.sha256 && !options.force) {
        conflicts.push(`${relative}: managed content changed; run sync --force to replace only the managed content`);
        continue;
      }
      if (!isPreviouslyOwned && artifact.ownership === 'full' && !recognizableGenerated) {
        conflicts.push(`${relative}: existing unowned file will not be overwritten`);
        continue;
      }
    }
    operations.push({ ...artifact, path: relative, absolute, desired, changed: current !== desired });
  }

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
    if (options.allowStaleRemoval !== true) {
      retained.push({ ...entry, path: relative });
      continue;
    }
    if (!manifestRemovalAuthority.trusted) {
      retained.push({ ...entry, path: relative });
      conflicts.push(`${MANIFEST_PATH}: manifest is not trusted for stale removal (${manifestRemovalAuthority.errors.join(', ')})`);
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
      links.add(ancestor);
      if (!options.migrateLinks) {
        conflicts.push(`${normalizeRelative(path.relative(root, ancestor))}: stale link adapter requires explicit --migrate-links`);
      }
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
      retained.push({ ...entry, path: relative });
      conflicts.push(`${relative}: stale managed content changed and will not be removed`);
      continue;
    }
    if (entry.ownership === 'full' && !current.includes(GENERATED_MARKER)) {
      conflicts.push(`${relative}: stale full-file artifact lacks a generated marker and will not be removed`);
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
      operations.push({ ...entry, absolute, desired, changed: current !== desired, remove: true, deleteWhenEmpty: desired.trim().length === 0 });
    } else {
      operations.push({ ...entry, absolute, changed: true, remove: true, deleteWhenEmpty: true });
    }
  }
  const linkPaths = [...links];
  const manifestValue = buildManifest(operations, {
    generatedAt: manifest?.generatedAt ?? null,
    retained: manifestRemovalAuthority.trusted ? retained : [],
  });
  const manifestContent = stableJson(manifestValue);
  const manifestPath = path.join(root, MANIFEST_PATH);
  return {
    operations,
    conflicts,
    retained,
    links: linkPaths,
    previousManifest: manifest,
    manifest: {
      value: manifestValue,
      content: manifestContent,
      changed: readText(manifestPath, '') !== manifestContent,
    },
    preconditions: {
      root: fs.realpathSync(root),
      files: operations.map((operation) => {
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

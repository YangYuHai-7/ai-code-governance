import fs from 'node:fs';
import { memoryIssues } from '../memory/index.mjs';
import { projectConventionIssues } from '../standards/index.mjs';
import path from 'node:path';
import { CONFIG_PATH, MANAGED_END, MANAGED_START, MANIFEST_PATH, MANIFEST_SCHEMA_VERSION } from '../../constants.mjs';
import { capabilityEvidenceIssues } from '../capabilities/index.mjs';
import { architecturePlacementIssues, evaluateModuleGraph } from '../architecture/index.mjs';
import { artifactDefinitions, buildArtifactsWithDefinitions, renderSelectedArtifacts, selectedArtifactDefinitions, validateConfig } from './compiler.mjs';
import { canonicalPath, isCanonicalPath } from './layout.mjs';
import { conditionalArtifactRoutes } from './artifact-selection.mjs';
import {
  extractManagedBlock,
  loadManifest,
  managedContentHash,
  renderGitignoreBlock,
  renderManagedBlock,
} from './managed-files.mjs';
import { validateManifestRemovalAuthority } from './manifest-trust.mjs';
import { assertNoLinkAncestor, lstatSafe, readJson, readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { declaredSkillDirectories } from '../../catalogs/index.mjs';
import { brownfieldProgress, isRepositoryFamilyBoundary, repositoryTopologyMigrationRequired } from '../repository/index.mjs';

const ACCEPTANCE_CONTRACT_PATH = 'docs/ai/acceptance-contract.json';
const ACCEPTANCE_RESULTS_PATH = 'docs/ai/acceptance-results.json';
const ACCEPTANCE_STATUSES = new Set(['pass', 'fail', 'not-applicable', 'unverified']);
const BASELINE_APPLICABLE_PROBES = new Set([
  'broken-exact-path',
  'client-selection-adapter-parity',
  'checker-internal-error',
  'generated-adapter-no-links',
  'managed-adapter-drift',
  'initializer-idempotence',
  'unmanaged-file-preservation',
  'noninteractive-required-input',
]);
const EXECUTABLE_GOVERNANCE_SKILL = new RegExp(`^(?:docs\\/ai\\/skills|${declaredSkillDirectories().map((directory) => directory.replace(/\//g, '\\/')).join('|')})\\/(?:[^/]+\\/)*SKILL\\.md$`);

// Executable governance files AICG did not generate are "foreign". They become orphans the
// moment an AICG manifest exists, which is why a brownfield repository that already carries
// its own docs/ai fails post-apply verification and rolls back. Adoption records the owner's
// decision in .ai-governance/config.json so every later check agrees with it instead of
// re-reporting the same foreign files on each run.
export function adoptedForeignGovernancePaths(config) {
  const adopted = config?.externalGovernance?.adopted;
  if (!Array.isArray(adopted)) return [];
  return adopted.filter((entry) => typeof entry === 'string' && entry.length > 0);
}

export function detectForeignExecutableGovernance(scan, config = null, { registered = [] } = {}) {
  const adopted = new Set([...adoptedForeignGovernancePaths(config), ...registered]);
  return scan.files
    .filter((entry) => ['file', 'link'].includes(entry.type)
      && EXECUTABLE_GOVERNANCE_SKILL.test(entry.relative)
      && !adopted.has(entry.relative))
    .map((entry) => entry.relative)
    .sort((left, right) => left.localeCompare(right));
}

function indexedProjectSkillPaths(config, scan) {
  if (config.skillDiscovery?.decision?.status !== 'approved') return [];
  return (config.skillDiscovery.decision.candidates ?? [])
    .filter((candidate) => candidate?.sourceKind === 'project'
      && candidate.location?.root
      && path.resolve(candidate.location.root) === path.resolve(scan.root)
      && typeof candidate.location.relative === 'string'
      && isSafeRelative(candidate.location.relative)
      && EXECUTABLE_GOVERNANCE_SKILL.test(candidate.location.relative))
    .map((candidate) => candidate.location.relative);
}

function unmanagedExecutableGovernanceIssues(scan, expected, trustedHistoricalFiles, legalSeedDefinitions, approvedProjectSkills = [], config = null, extraRegistered = []) {
  const registered = new Set([
    ...expected.map((artifact) => artifact.path),
    ...trustedHistoricalFiles.filter((entry) => entry && typeof entry.path === 'string').map((entry) => entry.path),
    ...legalSeedDefinitions
      .filter((definition) => definition.ownership === 'seed')
      .map((definition) => definition.path),
    ...approvedProjectSkills,
    ...adoptedForeignGovernancePaths(config),
    ...extraRegistered,
  ]);
  // Stack adapter skills emitted by the `generic-unknown` fallback stay on disk after a
  // single-repo → repository-family migration: the family plan no longer regenerates
  // them but the orchestrator client directories still need to mirror the previously
  // installed set. Treat those exact paths as registered whenever the current scan is
  // in family mode, so the migration does not leave orphan adapters behind.
  if (config?.projectMode === 'repository-family') {
    const suffix = 'generic-unknown/SKILL.md';
    for (const directory of declaredSkillDirectories()) registered.add(`${directory}/${suffix}`);
  }
  return scan.files
    .filter((entry) => ['file', 'link'].includes(entry.type) && EXECUTABLE_GOVERNANCE_SKILL.test(entry.relative) && !registered.has(entry.relative))
    .map((entry) => `${entry.relative}: unmanaged executable governance artifact; register it through the governance configuration and manifest or remove it`)
    .sort((left, right) => left.localeCompare(right));
}

function expectedManagedHash(artifact) {
  if (artifact.ownership === 'managed-block') return sha256(renderManagedBlock(artifact.content));
  if (artifact.ownership === 'gitignore-block') return sha256(renderGitignoreBlock(artifact.content));
  return sha256(artifact.content);
}

function actualManagedHash(content, ownership) {
  return managedContentHash(content, ownership) ?? sha256('');
}

function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function yamlName(line, indent) {
  const match = line.match(new RegExp(`^ {${indent}}(?:([A-Za-z0-9_-]+)|["']([A-Za-z0-9_-]+)["']):\\s*$`));
  return match?.[1] ?? match?.[2] ?? null;
}

function startsTopLevelYamlNode(line) {
  return line.length > 0 && !/^\s/.test(line) && !/^\s*#/.test(line);
}

function normalizeContextMapping(content) {
  const issues = [];
  const frames = [{ indent: -1, name: null, keys: new Set() }];
  let topLevel = null;
  const lines = content.split(/\r?\n/).map((line) => {
    if (/^\s*(?:#.*)?$/.test(line)) return line;
    const formal = topLevel === 'base' || topLevel === 'profiles';
    const match = line.match(/^( *)(?:([A-Za-z0-9_-]+)|"([A-Za-z0-9_-]+)"|'([A-Za-z0-9_-]+)'):\s*(.*?)\s*$/);
    if (!match) {
      // This parser accepts a deliberately small block-mapping subset. Explicit,
      // escaped, merge, anchor, and flow mapping keys must never shadow a route.
      if (startsTopLevelYamlNode(line) || (formal && !/^ +-\s+/.test(line))) {
        issues.push('unsupported mapping syntax in context-map routing');
      }
      return line;
    }
    const indent = match[1].length;
    const name = match[2] ?? match[3] ?? match[4];
    const value = match[5].replace(/\s+#.*$/, '');
    if (indent === 0) topLevel = name;
    while (frames.length > 1 && frames.at(-1).indent >= indent) frames.pop();
    const parent = frames.at(-1);
    if (parent.keys.has(name)) issues.push(`duplicate mapping key ${name} in context-map routing`);
    parent.keys.add(name);
    const inRouting = topLevel === 'base' || topLevel === 'profiles';
    if (inRouting) {
      const container = indent === 0 || (topLevel === 'profiles' && indent === 2);
      if ((container && value !== '')
        || (name === 'conditional' && !['', '{}'].includes(value))
        || (name === 'required' && !['', '[]'].includes(value))
        || (/^[{&*!?]/.test(value) && !(name === 'conditional' && value === '{}'))) {
        issues.push(`unsupported mapping syntax for ${name} in context-map routing`);
      }
    }
    if (value === '') frames.push({ indent, name, keys: new Set() });
    return `${match[1]}${name}:${value ? ` ${value}` : ''}`;
  });
  return { lines, issues };
}

function contextMapStructure(content) {
  const { lines, issues } = normalizeContextMapping(content);
  const profilesHeaders = lines.flatMap((line, index) => line === 'profiles:' ? [index] : []);
  const baseHeaders = lines.flatMap((line, index) => line === 'base:' ? [index] : []);
  if (profilesHeaders.length !== 1) issues.push(`expected exactly one top-level profiles container; found ${profilesHeaders.length}`);
  if (baseHeaders.length !== 1) issues.push(`expected exactly one top-level base profile; found ${baseHeaders.length}`);

  let base = null;
  if (baseHeaders.length === 1) {
    const start = baseHeaders[0];
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (startsTopLevelYamlNode(lines[index])) {
        end = index;
        break;
      }
    }
    base = { name: 'base', lines: lines.slice(start, end) };
  }

  const profiles = new Map();
  if (profilesHeaders.length === 1) {
    const start = profilesHeaders[0];
    let end = lines.length;
    for (let index = start + 1; index < lines.length; index += 1) {
      if (startsTopLevelYamlNode(lines[index])) {
        end = index;
        break;
      }
    }
    const starts = [];
    for (let index = start + 1; index < end; index += 1) {
      const name = yamlName(lines[index], 2);
      if (name) starts.push({ name, index });
    }
    for (let index = 0; index < starts.length; index += 1) {
      const current = starts[index];
      if (profiles.has(current.name)) {
        issues.push(`duplicate profile ${current.name}`);
        continue;
      }
      profiles.set(current.name, {
        name: current.name,
        lines: lines.slice(current.index, starts[index + 1]?.index ?? end),
      });
    }
  }

  return { base, profiles, issues };
}

function blockRequiredPaths(block, requiredIndent, itemIndent) {
  const paths = new Set();
  let inRequired = false;
  for (const line of block?.lines ?? []) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    if (line === `${' '.repeat(requiredIndent)}required:`) {
      inRequired = true;
      continue;
    }
    if (new RegExp(`^ {${requiredIndent}}[A-Za-z0-9_-]+:\\s*`).test(line)) {
      inRequired = false;
      continue;
    }
    if (!inRequired) continue;
    const item = line.match(new RegExp(`^ {${itemIndent}}-\\s+["']?([A-Za-z0-9._/-]+)["']?\\s*$`));
    if (item) paths.add(item[1]);
  }
  return paths;
}

function profileConditionalPaths(structure, profileName, conditionName) {
  const paths = new Set();
  let inConditional = false;
  let inCondition = false;
  for (const line of structure.profiles.get(profileName)?.lines ?? []) {
    if (/^\s*#/.test(line) || /^\s*$/.test(line)) continue;
    if (/^    conditional:\s*$/.test(line)) {
      inConditional = true;
      inCondition = false;
      continue;
    }
    if (/^    [A-Za-z0-9_-]+:\s*/.test(line)) {
      inConditional = false;
      inCondition = false;
      continue;
    }
    if (!inConditional) continue;
    const condition = line.match(/^      ([A-Za-z0-9_-]+):\s*$/);
    if (condition) {
      inCondition = condition[1] === conditionName;
      continue;
    }
    if (!inCondition) continue;
    const item = line.match(/^        -\s+["']?([A-Za-z0-9._/-]+)["']?\s*$/);
    if (item) paths.add(item[1]);
  }
  return paths;
}

function profileExtendsValues(profile) {
  return (profile?.lines ?? []).flatMap((line) => {
    const match = line.match(/^    extends:\s+["']?([A-Za-z0-9_-]+)["']?\s*$/);
    return match ? [match[1]] : [];
  });
}

function profileExtends(profile) {
  const values = profileExtendsValues(profile);
  return values.length === 1 ? values[0] : null;
}

function contextMapStructureIssues(structure, gateAssertions, footprint = 'compact') {
  const issues = [...structure.issues];
  const alwaysPath = canonicalPath('docs/ai/rules/00_always.mdc', footprint);
  const releasePolicyPath = canonicalPath('docs/ai/release-acceptance-policy.json', footprint);
  if (structure.base && !blockRequiredPaths(structure.base, 2, 4).has(alwaysPath)) {
    issues.push(`base profile must require ${alwaysPath}`);
  }
  let baseRequiredSeen = false;
  let inBaseRequired = false;
  for (const line of structure.base?.lines.slice(1) ?? []) {
    if (/^\s*$/.test(line) || /^\s*#/.test(line)) continue;
    if (/^  (?:extends|["']extends["'])\s*:/.test(line)) {
      const parent = line.match(/^  (?:extends|["']extends["'])\s*:\s*["']?([A-Za-z0-9_-]+)["']?\s*$/)?.[1];
      issues.push(parent ? `base profile must not extend ${parent}` : 'base profile must not declare extends');
      inBaseRequired = false;
      continue;
    }
    if (line === '  required:' && !baseRequiredSeen) {
      baseRequiredSeen = true;
      inBaseRequired = true;
      continue;
    }
    if (inBaseRequired && /^    -\s+(?:[A-Za-z0-9._/-]+|"[A-Za-z0-9._/-]+"|'[A-Za-z0-9._/-]+')\s*$/.test(line)) continue;
    issues.push('base profile contains unsupported mapping syntax');
    inBaseRequired = false;
  }
  const requiredParents = new Map([
    ['ordinary', 'base'],
    ['behavior_change', 'ordinary'],
    ['release', 'ordinary'],
  ]);
  for (const [name, expectedParent] of requiredParents) {
    const profile = structure.profiles.get(name);
    if (!profile) {
      issues.push(`missing required profile ${name}`);
      continue;
    }
    const parent = profileExtends(profile);
    if (!parent) issues.push(`profile ${name} must declare exactly one extends target`);
    else if (parent !== expectedParent) issues.push(`profile ${name} must extend ${expectedParent}, not ${parent}`);
  }
  const release = structure.profiles.get('release');
  if (gateAssertions.has('release-route') && release && !blockRequiredPaths(release, 4, 6).has(releasePolicyPath)) {
    issues.push(`release profile must require ${releasePolicyPath}`);
  }

  const known = new Set(['base', ...structure.profiles.keys()]);
  const parents = new Map();
  for (const [name, profile] of structure.profiles) {
    if (profileExtendsValues(profile).length > 1) issues.push(`profile ${name} declares duplicate extends targets`);
    const parent = profileExtends(profile);
    if (!parent) continue;
    parents.set(name, parent);
    if (!known.has(parent)) issues.push(`profile ${name} extends unknown profile ${parent}`);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (name) => {
    if (visiting.has(name)) {
      issues.push(`profile inheritance cycle includes ${name}`);
      return;
    }
    if (visited.has(name) || name === 'base') return;
    visiting.add(name);
    const parent = parents.get(name);
    if (parent && known.has(parent)) visit(parent);
    visiting.delete(name);
    visited.add(name);
  };
  for (const name of structure.profiles.keys()) visit(name);
  return [...new Set(issues)];
}

function acceptanceEvidence(root, footprint = 'compact') {
  const ACCEPTANCE_CONTRACT_PATH = canonicalPath('docs/ai/acceptance-contract.json', footprint);
  const ACCEPTANCE_RESULTS_PATH = canonicalPath('docs/ai/acceptance-results.json', footprint);
  const resultsPath = path.join(root, ACCEPTANCE_RESULTS_PATH);
  if (!fs.existsSync(resultsPath)) {
    return {
      status: 'unverified',
      issues: [],
      warning: `${ACCEPTANCE_RESULTS_PATH}: missing; enforcement remains unverified until contract-complete negative and recovery evidence is recorded.`,
    };
  }

  const issues = [];
  let contract;
  let evidence;
  try {
    contract = readJson(path.join(root, ACCEPTANCE_CONTRACT_PATH));
  } catch (error) {
    issues.push(`${ACCEPTANCE_CONTRACT_PATH}: ${error.message}`);
  }
  try {
    evidence = readJson(resultsPath);
  } catch (error) {
    issues.push(`${ACCEPTANCE_RESULTS_PATH}: ${error.message}`);
  }
  if (!contract || !evidence) return { status: 'fail', issues };

  const families = Array.isArray(contract.required_probe_families) ? contract.required_probe_families : null;
  if (!Number.isInteger(contract.schema_version) || !families) {
    issues.push(`${ACCEPTANCE_CONTRACT_PATH}: invalid schema_version or required_probe_families.`);
    return { status: 'fail', issues };
  }
  if (evidence.contract_schema_version !== contract.schema_version) {
    issues.push(`${ACCEPTANCE_RESULTS_PATH}: contract_schema_version must equal ${contract.schema_version}.`);
  }
  if (!Array.isArray(evidence.results)) {
    issues.push(`${ACCEPTANCE_RESULTS_PATH}: results must be an array.`);
    return { status: 'fail', issues };
  }

  const expectedIds = new Set();
  for (const family of families) {
    if (!nonEmptyString(family?.id) || expectedIds.has(family.id)) {
      issues.push(`${ACCEPTANCE_CONTRACT_PATH}: probe family IDs must be non-empty and unique.`);
      continue;
    }
    expectedIds.add(family.id);
  }
  const seen = new Set();
  let applicablePasses = 0;
  let hasFailedProbe = false;
  let hasUnverifiedProbe = false;
  for (const result of evidence.results) {
    const id = result?.id;
    if (!nonEmptyString(id)) {
      issues.push(`${ACCEPTANCE_RESULTS_PATH}: every result requires a non-empty id.`);
      continue;
    }
    if (seen.has(id)) issues.push(`${ACCEPTANCE_RESULTS_PATH}: duplicate result id ${id}.`);
    seen.add(id);
    if (!expectedIds.has(id)) issues.push(`${ACCEPTANCE_RESULTS_PATH}: unknown result id ${id}.`);
    if (!ACCEPTANCE_STATUSES.has(result.status)) issues.push(`${ACCEPTANCE_RESULTS_PATH}: ${id} has invalid status ${result.status ?? 'missing'}.`);
    if (typeof result.applies !== 'boolean') issues.push(`${ACCEPTANCE_RESULTS_PATH}: ${id} applies must be boolean.`);
    if (BASELINE_APPLICABLE_PROBES.has(id) && result.applies !== true) {
      issues.push(`${ACCEPTANCE_RESULTS_PATH}: baseline probe ${id} is applicable to every generated framework and cannot be waived.`);
    }
    if (!nonEmptyString(result.applicability_reason)) issues.push(`${ACCEPTANCE_RESULTS_PATH}: ${id} requires applicability_reason.`);
    if (result.applies === true && result.status === 'not-applicable') issues.push(`${ACCEPTANCE_RESULTS_PATH}: applicable probe ${id} cannot be not-applicable.`);
    if (result.applies === false && result.status !== 'not-applicable') issues.push(`${ACCEPTANCE_RESULTS_PATH}: non-applicable probe ${id} must use not-applicable status.`);
    if (result.status === 'pass') {
      applicablePasses += 1;
      for (const field of ['entrypoint', 'negative_evidence', 'recovery_evidence', 'remaining_boundary']) {
        if (!nonEmptyString(result[field])) issues.push(`${ACCEPTANCE_RESULTS_PATH}: passing probe ${id} requires ${field}.`);
      }
    } else if (result.status === 'fail') {
      hasFailedProbe = true;
    } else if (result.status === 'unverified') {
      hasUnverifiedProbe = true;
    }
  }
  for (const id of expectedIds) {
    if (!seen.has(id)) issues.push(`${ACCEPTANCE_RESULTS_PATH}: missing required result ${id}.`);
  }
  if (issues.length > 0 || hasFailedProbe) return { status: 'fail', issues };
  if (hasUnverifiedProbe || applicablePasses === 0) {
    return {
      status: 'unverified',
      issues: [],
      warning: `${ACCEPTANCE_RESULTS_PATH}: contract coverage is valid but applicable enforcement probes are not all verified.`,
    };
  }
  return {
    status: 'unverified',
    issues: [],
    warning: `${ACCEPTANCE_RESULTS_PATH}: contract coverage and receipt fields are complete, but aicg check does not replay their real entrypoints; enforcement remains unverified.`,
  };
}

function linkInPath(root, relative) {
  let current = root;
  for (const part of relative.split('/')) {
    current = path.join(current, part);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) return path.relative(root, current).replaceAll('\\', '/');
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }
  return null;
}

export function checkProject(scan, options = {}) {
  const structureErrors = [];
  const reachabilityErrors = [];
  const evidenceErrors = [];
  const warnings = [];
  let moduleGraph = { status: 'stated-only', issues: [], inspectedFiles: [], unsupportedFiles: [] };
  if (scan.scanBudget?.complete === false) {
    const truncation = scan.scanBudget.truncation ?? {};
    const details = [
      truncation.fileLimitReached ? `file limit ${scan.scanBudget.maxFiles} reached` : null,
      truncation.directoryLimitReached ? `directory limit ${scan.scanBudget.maxDirectories} reached before ${truncation.directoryBudgetPaths?.join(', ') || 'remaining directories'}` : null,
      truncation.entryLimitReached ? `entry limit ${scan.scanBudget.maxEntries} reached` : null,
      truncation.directories?.length ? `depth limit ${scan.scanBudget.maxDepth} skipped ${truncation.directories.join(', ')}` : null,
      truncation.oversizedFiles?.length ? `size limit ${scan.scanBudget.maxFileBytes} bytes skipped content for ${truncation.oversizedFiles.map((item) => item.path).join(', ')}` : null,
      truncation.readErrors?.length ? `read failures at ${truncation.readErrors.map((item) => `${item.path} (${item.operation}:${item.code})`).join(', ')}` : null,
    ].filter(Boolean).join('; ');
    structureErrors.push(`repository scan incomplete: ${details || 'configured scan budget was exceeded'}`);
  }
  for (const issue of scan.repositoryFamily?.issues ?? []) structureErrors.push(`repository-family discovery: ${issue}`);
  for (const unit of scan.governanceUnits ?? []) {
    if (unit.status === 'uninitialized') warnings.push(`repository-family member ${unit.path}: uninitialized; skipped without reading or changing the member`);
    else if (unit.status !== 'scanned') structureErrors.push(`repository-family member ${unit.path}: ${unit.status}${unit.reason ? ` (${unit.reason})` : ''}`);
  }
  let config;
  let manifest;
  const gateAssertions = new Set();

  try {
    config = validateConfig(readJson(path.join(scan.root, CONFIG_PATH)));
  } catch (error) {
    structureErrors.push(`${CONFIG_PATH}: ${error.message}`);
  }
  for (const exclusion of scan.scanIgnore?.unverifiedExclusions ?? []) {
    if (exclusion.evidenceStatus !== 'complete' || !/^[a-f0-9]{64}$/.test(exclusion.contentSha256 ?? '')) {
      structureErrors.push(`unverified scan exclusion: ${exclusion.path} has incomplete content evidence${exclusion.evidenceReason ? ` (${exclusion.evidenceReason})` : ''}; narrow or remove the rule`);
      continue;
    }
    const approval = config?.scanExclusions?.policySha256 === scan.scanIgnore.sha256
      ? config.scanExclusions.approvals.find((entry) => entry.path === exclusion.path && entry.evidenceHash === exclusion.evidenceHash)
      : null;
    if (!approval) structureErrors.push(`unverified scan exclusion: ${exclusion.path} matched .aicgignore:${exclusion.line} (${exclusion.category}); record an evidence-bound exclusion decision or narrow the rule`);
  }
  if (scan.scanIgnore?.unverifiedExclusionsTruncated || (scan.scanIgnore?.unverifiedExclusionCount ?? 0) > (scan.scanIgnore?.unverifiedExclusions?.length ?? 0)) {
    structureErrors.push(`unverified scan exclusions exceed the ${scan.scanIgnore?.unverifiedExclusions?.length ?? 0}-entry review budget; narrow the .aicgignore policy`);
  }
  try {
    manifest = loadManifest(scan.root);
    if (!manifest) structureErrors.push(`${MANIFEST_PATH}: missing manifest`);
    else if (manifest.schemaVersion !== MANIFEST_SCHEMA_VERSION) structureErrors.push(`${MANIFEST_PATH}: unsupported schemaVersion`);
  } catch (error) {
    structureErrors.push(error.message);
  }

  if (config && manifest) {
    if (repositoryTopologyMigrationRequired(scan, config)) {
      structureErrors.push(`${CONFIG_PATH}: migration-required; current repository mode or family membership differs from the stored classification (${config.projectMode} -> ${scan.projectMode})`);
    }
    if (!config.initialization?.lifecycle) {
      warnings.push(`${CONFIG_PATH}: legacy-unconfirmed initialization decision; re-run aicg init to record lifecycle and existing-code strategy before changing architecture or existing behavior.`);
    }
    if (!config.architecture || config.architecture.status === 'legacy-unconfigured') {
      warnings.push(`${CONFIG_PATH}: legacy-unconfigured architecture profile; re-run aicg init to record a future-code policy before relying on directory guidance.`);
    }
    let expected = [];
    let selected = [];
    let legalSeedDefinitions = [];
    let expectedResolved = false;
    let governanceCostDrift = null;
    try {
      selected = selectedArtifactDefinitions(config, scan);
      legalSeedDefinitions = artifactDefinitions(config, scan);
      for (const assertion of selected.flatMap((definition) => definition.gateAssertions)) gateAssertions.add(assertion);
      if (config.skillDiscovery?.enabled && config.agentTeam?.enabled) {
        const built = buildArtifactsWithDefinitions(config, scan);
        expected = built.artifacts;
        governanceCostDrift = built.governanceCostDrift;
      } else expected = renderSelectedArtifacts(selected, config.governanceFootprint ?? 'compact');
      expectedResolved = true;
    } catch (error) {
      structureErrors.push(`Cannot resolve expected artifacts: ${error.message}`);
    }
    if (governanceCostDrift) {
      warnings.push(`${CONFIG_PATH}: recorded Skill governance cost total ${stableJson(governanceCostDrift.recorded)} differs from the computed ${stableJson(governanceCostDrift.computed)}; the next approved init or sync records the current total. The governed increment and manager load are unchanged.`);
    }
    const manifestFiles = Array.isArray(manifest.files) ? manifest.files : [];
    if (!Array.isArray(manifest.files)) structureErrors.push(`${MANIFEST_PATH}: files must be an array`);
    const managedExpected = expected.filter((artifact) => artifact.ownership !== 'seed');
    const seedExpected = expected.filter((artifact) => artifact.ownership === 'seed');
    const expectedPaths = new Set(managedExpected.map((artifact) => artifact.path));
    const manifestPaths = new Set(manifestFiles.filter((entry) => entry && typeof entry.path === 'string').map((entry) => entry.path));
    const manifestAuthority = validateManifestRemovalAuthority(scan.root, manifest);
    const trustedHistoricalFiles = manifestAuthority.trusted ? manifestFiles : [];
    for (const entry of manifestFiles) if (typeof entry?.path === 'string' && isRepositoryFamilyBoundary(entry.path, scan.repositoryFamily)) {
      const member = scan.repositoryFamily.members.find((candidate) => isRepositoryFamilyBoundary(entry.path, { members: [candidate] }));
      structureErrors.push(`${MANIFEST_PATH}: parent manifest crosses repository boundary ${member?.path ?? '<unknown>'} with ${entry.path}`);
    }
    const approvedProjectSkills = expectedResolved ? indexedProjectSkillPaths(config, scan) : [];
    structureErrors.push(...unmanagedExecutableGovernanceIssues(scan, expected, trustedHistoricalFiles, legalSeedDefinitions, approvedProjectSkills, config, options.externalGovernancePaths ?? []));
    for (const relative of expectedPaths) {
      if (!manifestPaths.has(relative)) structureErrors.push(`${MANIFEST_PATH}: missing managed entry for ${relative}`);
    }
    for (const artifact of seedExpected) {
      const link = linkInPath(scan.root, artifact.path);
      if (link) structureErrors.push(`${artifact.path}: canonical path traverses link ${link}`);
      else {
        try {
          if (!fs.statSync(path.join(scan.root, artifact.path)).isFile()) structureErrors.push(`${artifact.path}: canonical seed is not a regular file`);
        } catch (error) {
          structureErrors.push(`${artifact.path}: ${error.code === 'ENOENT' ? 'missing canonical file' : error.message}`);
        }
      }
    }
    for (const artifact of managedExpected) {
      const entry = manifestFiles.find((candidate) => candidate?.path === artifact.path);
      if (!entry) continue;
      const expectedHash = expectedManagedHash(artifact);
      if (entry.sha256 !== expectedHash) structureErrors.push(`${artifact.path}: manifest source is stale; run aicg sync .`);
    }
    for (const entry of manifestFiles) {
      if (!entry || typeof entry.path !== 'string') {
        structureErrors.push(`${MANIFEST_PATH}: every managed entry must contain a string path`);
        continue;
      }
      if (!['full', 'managed-block', 'gitignore-block'].includes(entry.ownership)) {
        structureErrors.push(`${entry.path}: manifest contains unsupported ownership ${entry.ownership}`);
        continue;
      }
      if (!/^[a-f0-9]{64}$/.test(entry.sha256 ?? '')) {
        structureErrors.push(`${entry.path}: manifest contains an invalid SHA-256`);
        continue;
      }
      if (!isSafeRelative(entry.path)) {
        structureErrors.push(`${entry.path}: manifest path is not a safe repository-relative path`);
        continue;
      }
      const link = linkInPath(scan.root, entry.path);
      if (link) {
        structureErrors.push(`${entry.path}: managed path traverses link ${link}`);
        continue;
      }
      const absolute = path.join(scan.root, entry.path);
      let content;
      try {
        content = readText(absolute);
      } catch (error) {
        structureErrors.push(`${entry.path}: ${error.code === 'ENOENT' ? 'missing managed file' : error.message}`);
        continue;
      }
      try {
        const actual = actualManagedHash(content, entry.ownership);
        if (actual !== entry.sha256) structureErrors.push(`${entry.path}: managed content drifted; run aicg sync .`);
      } catch (error) {
        structureErrors.push(`${entry.path}: ${error.message}`);
      }
    }
    for (const relative of manifestPaths) {
      if (!expectedPaths.has(relative)) warnings.push(`${relative}: managed by an earlier configuration and no longer selected`);
    }

    try {
      if (gateAssertions.has('architecture-placement')) for (const issue of architecturePlacementIssues(scan, config)) structureErrors.push(`architecture placement: ${issue}`);
    } catch (error) {
      structureErrors.push(`architecture policy: ${error.message}`);
    }

    try {
      const moduleGraphRelative = canonicalPath('docs/ai/module-graph.json', config.governanceFootprint ?? 'compact');
      const declarationPath = path.join(scan.root, moduleGraphRelative);
      const declarationStat = lstatSafe(declarationPath);
      let declaration = null;
      if (gateAssertions.has('module-graph') && declarationStat) {
        assertNoLinkAncestor(scan.root, moduleGraphRelative);
        if (!declarationStat.isFile() || declarationStat.isSymbolicLink()) throw new Error(`${moduleGraphRelative} must be a regular repository-local file.`);
        declaration = readJson(declarationPath);
      }
      moduleGraph = evaluateModuleGraph(scan, declaration);
      for (const issue of moduleGraph.issues) {
        structureErrors.push(`architecture module graph: ${issue.source} -> ${issue.target}: ${issue.rule}`);
      }
      if (moduleGraph.status === 'stated-only' && moduleGraph.unsupportedFiles.length > 0) {
        warnings.push(`architecture module graph: unsupported dynamic relative module loading in ${moduleGraph.unsupportedFiles.join(', ')}; dependency direction remains stated-only for those files.`);
      }
    } catch (error) {
      structureErrors.push(`architecture module graph: ${error.message}`);
    }

    const agentsContent = readText(path.join(scan.root, 'AGENTS.md'), '');
    const managedAgentsContent = extractManagedBlock(agentsContent) ?? '';
    const contextMap = readText(path.join(scan.root, 'docs/ai/context-map.yaml'), '');
    const contextMapRouting = contextMapStructure(contextMap);
    for (const issue of contextMapStructureIssues(contextMapRouting, gateAssertions, config.governanceFootprint ?? 'compact')) {
      structureErrors.push(`docs/ai/context-map.yaml: ${issue}`);
    }
    if (!managedAgentsContent) {
      reachabilityErrors.push('AGENTS.md: shared managed entrypoint is not reachable');
    }
    if (gateAssertions.has('context-map') && !managedAgentsContent.includes('docs/ai/context-map.yaml')) {
      reachabilityErrors.push('AGENTS.md: context map is not reachable from the shared entrypoint');
    }
    if (gateAssertions.has('conditional-route')) {
      for (const [condition, paths] of conditionalArtifactRoutes(selected, 'behavior_change')) {
        const routed = profileConditionalPaths(contextMapRouting, 'behavior_change', condition);
        for (const relative of paths) {
          if (routed.has(relative)) continue;
          const definition = selected.find((item) => item.path === relative);
          const label = definition.gateAssertions.includes('business-skill-route') ? 'business constraint Skill'
            : definition.gateAssertions.includes('business-route') ? 'owner-confirmed constraint registry'
              : 'selected artifact';
          reachabilityErrors.push(`${relative}: ${label} is not reachable from the behavior_change route (${condition})`);
        }
      }
    }
    if (gateAssertions.has('claude-adapter')) {
      const claude = readText(path.join(scan.root, 'CLAUDE.md'), '');
      if (!claude.includes('@AGENTS.md')) reachabilityErrors.push('CLAUDE.md: native @AGENTS.md import is missing');
    }
    if (gateAssertions.has('cursor-adapter') && !manifestPaths.has('.cursor/rules/ai-code-governance.mdc')) {
      reachabilityErrors.push('.cursor/rules/ai-code-governance.mdc: selected Cursor adapter is missing');
    }

    const reviewItems = config.capabilityEvolution?.lastHarvest?.reviewItems ?? [];
    if (config.features?.knowledge) structureErrors.push(...memoryIssues(scan.root, scan));
    for (const issue of projectConventionIssues(scan.root, scan)) (['stale', 'warning'].includes(issue.status) ? warnings : structureErrors).push(`project convention ${issue.reason}`);
    for (const issue of capabilityEvidenceIssues(scan, config.projectCapabilities ?? [])) {
      const reviewed = reviewItems.some((item) => item.id === issue.id && item.status === 'required' && item.code === issue.code && item.observedFingerprint === issue.observedFingerprint);
      if (reviewed) warnings.push(`capability ${issue.id}: ${issue.reason}; owner review is required before promotion or reuse enforcement`);
      else structureErrors.push(`capability ${issue.id}: ${issue.reason}; run aicg harvest . and record the required review`);
    }
    for (const item of reviewItems) {
      warnings.push(`capability ${item.id}: ${item.reason} Owner ${item.owner} review is due ${item.dueDate}.`);
    }
  }

  const acceptance = config && manifest && gateAssertions.has('acceptance-evidence') ? acceptanceEvidence(scan.root, config.governanceFootprint ?? 'compact') : { status: 'unverified', issues: [] };
  const brownfield = config && manifest ? brownfieldProgress(scan, config) : null;
  if (brownfield?.gaps.length) warnings.push(`brownfield enrichment: ${brownfield.gaps.length} gap(s); see brownfield.gaps in the JSON report`);
  evidenceErrors.push(...acceptance.issues);
  if (acceptance.warning) warnings.push(acceptance.warning);
  const errors = [...structureErrors, ...reachabilityErrors, ...evidenceErrors];
  const present = structureErrors.length === 0;
  const reachable = Boolean(config && manifest) && reachabilityErrors.length === 0;
  const pass = errors.length === 0;
  // Orphan scan: governance files that look like first-party artifacts but are not in the
  // managed manifest. The check contract only validates managed files, so any file the
  // generator created (or that an earlier tool version left behind) and never registered
  // would otherwise be invisible. Reporting them here turns hidden orphans into an
  // actionable cleanup signal without making the managed set pass or fail on them.
  const orphans = manifest ? collectGovernanceOrphans(scan, manifest, config) : { status: 'no-manifest', count: 0, files: [], truncated: false };
  if (orphans.count > 0) warnings.push(`governance orphans: ${orphans.count} unmanaged file(s) under docs/ai or client skill directories; see orphans in the JSON report`);
  return {
    ok: pass,
    errors,
    warnings,
    brownfield,
    evidence: {
      present: present ? 'pass' : 'fail',
      reachable: reachable ? 'pass' : 'fail',
      enforced: acceptance.status,
      realClientVerified: 'unverified',
    },
    architecture: {
      status: config?.architecture?.status ?? 'legacy-unconfigured',
      newFilePlacement: config?.architecture?.verification?.newFilePlacement ?? 'not-enabled',
      moduleGraph,
      semanticDesign: 'stated-only',
    },
    orphans,
    boundaries: [
      'aicg check proves structure, ownership, hashes, and configured entrypoint reachability.',
      'acceptance-results.json is validated for exact contract coverage, mandatory applicability, and negative/recovery receipt fields; aicg check keeps enforcement unverified because it does not replay those entrypoints.',
      'A declared active module graph checks statically analyzable relative JS/TS import and export directions plus cross-module public entrypoints; dynamic imports, aliases, cohesion, and single responsibility remain unverified.',
      'Real agent loading, project behavior, hooks, and operating-system execution require separate replay evidence.',
    ],
  };
}

const ORPHAN_RUNTIME_PREFIXES = ['reports/', 'reviews/'];
const ORPHAN_SEED_PREFIXES = ['docs/ai/skills/project-conventions/'];
const ORPHAN_SELF_PATHS = new Set([MANIFEST_PATH, CONFIG_PATH]);

/**
 * Paths the generator writes with `ownership: 'seed'` are handed back to the project after
 * creation, so the managed manifest intentionally omits them. Reporting them as orphans
 * would flag the tool's own output as unmanaged clutter, so resolve the seed set from the
 * artifact definitions instead of guessing at path prefixes.
 */
function generatorSeedPaths(config, scan) {
  const seedPaths = new Set();
  if (!config || !scan) return seedPaths;
  try {
    for (const definition of selectedArtifactDefinitions(config, scan)) {
      if (definition?.ownership === 'seed' && definition?.path) seedPaths.add(definition.path);
    }
  } catch {
    // Definitions cannot be resolved for this scan; fall back to manifest-only orphan detection.
  }
  return seedPaths;
}

function collectGovernanceOrphans(scan, manifest, config = null) {
  const managed = new Set((manifest?.files ?? []).map((entry) => entry?.path).filter(Boolean));
  const adopted = new Set(adoptedForeignGovernancePaths(config));
  const seedPaths = generatorSeedPaths(config, scan);
  const clientDirs = new Set(declaredSkillDirectories());
  const candidates = [];
  for (const file of scan.files ?? []) {
    const relative = file.relative;
    if (!relative) continue;
    if (managed.has(relative)) continue;
    if (adopted.has(relative)) continue;
    if (seedPaths.has(relative)) continue;
    if (ORPHAN_SELF_PATHS.has(relative)) continue;
    if (ORPHAN_RUNTIME_PREFIXES.some((prefix) => relative === prefix.slice(0, -1) || relative.startsWith(prefix))) continue;
    if (ORPHAN_SEED_PREFIXES.some((prefix) => relative.startsWith(prefix))) continue;
    // Only flag paths the generator actually owns: the canonical docs/ai tree and every
    // client skill directory the agent registry declares. Anything outside these roots is
    // user content and is left to the operator's discretion.
    if (!relative.startsWith('docs/ai/')) {
      const matchesClient = [...clientDirs].some((directory) => relative === directory || relative.startsWith(`${directory}/`));
      if (!matchesClient) continue;
    }
    candidates.push(relative);
  }
  candidates.sort((left, right) => left.localeCompare(right));
  return {
    status: candidates.length === 0 ? 'clean' : 'orphan-files-detected',
    count: candidates.length,
    files: candidates.slice(0, 64),
    truncated: candidates.length > 64,
  };
}

export function printCheck(result, json = false) {
  if (json) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log(`governance_check=${result.ok ? 'pass' : 'fail'}`);
  console.log(`present=${result.evidence.present} reachable=${result.evidence.reachable} enforced=${result.evidence.enforced} real-client-verified=${result.evidence.realClientVerified}`);
  for (const warning of result.warnings) console.warn(`WARN: ${warning}`);
  for (const gap of result.brownfield?.gaps.slice(0, 20) ?? []) console.warn(`BROWNFIELD_GAP: ${gap}`);
  for (const error of result.errors) console.error(`FAIL: ${error}`);
  for (const boundary of result.boundaries) console.log(`BOUNDARY: ${boundary}`);
}

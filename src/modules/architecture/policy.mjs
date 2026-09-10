import path from 'node:path';
import { GENERATED_MARKER, PACKAGE_ROOT } from '../../constants.mjs';
import { classifyProject, isImplementationSourcePath, projectSourcePaths } from '../repository/index.mjs';
import { readJson } from '../../adapters/filesystem/index.mjs';
import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { isArchitectureNonSourcePath } from './source-classification.mjs';

export const ARCHITECTURE_PROFILE_ID = 'module-boundaries-v1';
export const ARCHITECTURE_MODES = ['module-first-new-code', 'preserve-current', 'staged-migration-pending', 'legacy-unconfigured'];
export const ARCHITECTURE_STATUSES = ['active', 'advisory', 'legacy-unconfigured'];
const TOPOLOGY_BINDINGS = new Set(['single-repo', 'monorepo']);
const NON_SOURCE_LINK_ROOTS = new Set([
  'docs', 'public', 'assets', 'static', 'scripts', 'script', 'tools', 'tooling', 'migrations', 'migration',
  'infra', 'infrastructure', 'terraform', '.github', '.ai-governance', '.cursor', '.claude', '.agents',
  '.runtime',
]);
const NON_SOURCE_ROOT_LINK_DOCUMENT = /^(?:README|LICENSE|NOTICE|CHANGELOG|CONTRIBUTING)(?:\.[^/]+)?$/i;
const NON_SOURCE_ROOT_LINK_NAMES = new Set(['.gitignore', '.gitattributes', '.editorconfig']);

function topologyBinding(scan) {
  return classifyProject(scan).codebase.topology.value;
}

function registry() {
  const value = readJson(path.join(PACKAGE_ROOT, 'assets/registries/architecture-profile-registry.json'));
  if (value.schemaVersion !== 1 || !Array.isArray(value.profiles)) throw new Error('Architecture profile registry is invalid.');
  const profile = value.profiles.find((candidate) => candidate.id === ARCHITECTURE_PROFILE_ID);
  if (!profile || profile.version !== 1 || !Array.isArray(profile.invariants) || !profile.placement) {
    throw new Error(`Architecture profile registry is missing ${ARCHITECTURE_PROFILE_ID}.`);
  }
  return { value, profile };
}

function architectureDigest(value) {
  return sha256(stableJson(value));
}

function initializationDigest(initialization) {
  return sha256(stableJson({
    lifecycle: initialization?.lifecycle ?? null,
    existingCodeStrategy: initialization?.existingCodeStrategy ?? null,
    source: initialization?.source ?? null,
  }));
}

function sameStringArray(left, right) {
  return Array.isArray(left)
    && Array.isArray(right)
    && left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function sourceBaseline(scan) {
  return projectSourcePaths(scan)
    .filter((relative) => !isTestPath(relative) && !isArchitectureNonSourcePath(relative))
    .sort((left, right) => left.localeCompare(right));
}

function profileMode(initialization) {
  if (!initialization?.lifecycle) return 'legacy-unconfigured';
  if (initialization.lifecycle === 'greenfield' || initialization.existingCodeStrategy === 'new-code-standard') return 'module-first-new-code';
  if (initialization.existingCodeStrategy === 'keep-existing') return 'preserve-current';
  return 'staged-migration-pending';
}

function scopeFor(scan, config, mode) {
  if (mode !== 'module-first-new-code') return { roots: [], appliesTo: 'none', baselineSourcePaths: [] };
  if (scan.projectMode === 'monorepo') {
    return { roots: [], appliesTo: 'none', baselineSourcePaths: [] };
  }
  const baselineSourcePaths = config.initialization?.lifecycle === 'existing' ? sourceBaseline(scan) : [];
  return {
    roots: ['src'],
    appliesTo: config.initialization?.lifecycle === 'existing' ? 'new-modules-only' : 'future-code',
    baselineSourcePaths,
  };
}

function statusFor(mode, scope) {
  if (mode === 'legacy-unconfigured') return 'legacy-unconfigured';
  if (mode !== 'module-first-new-code') return 'advisory';
  return scope.roots.length === 1 ? 'active' : 'advisory';
}

function verificationFor(status) {
  return {
    newFilePlacement: status === 'active' ? 'aicg-check-detects-current-tree' : 'not-enabled',
    dependencyDirection: 'stated-only',
    cohesion: 'stated-only',
    singleResponsibility: 'stated-only',
  };
}

export function deriveArchitectureDecision(scan, config, previous = null, { legacyGovernance = false } = {}) {
  const { profile } = registry();
  const stacks = [...new Set(config.stacks ?? [])].sort((left, right) => left.localeCompare(right));
  const mode = profileMode(config.initialization);
  const currentBinding = initializationDigest(config.initialization);
  const currentTopology = topologyBinding(scan);
  if (
    previous
    && previous.schemaVersion === 1
    && previous.profileId === profile.id
    && previous.profileVersion === profile.version
    && previous.initializationBinding === currentBinding
    && sameStringArray(previous.stackCandidates, stacks)
    && previous.topologyBinding === currentTopology
  ) {
    return previous;
  }
  if (
    legacyGovernance
    && !previous
    && config.initialization?.lifecycle === 'greenfield'
    && classifyProject(scan).codebase.lifecycle.value === 'existing'
  ) {
    return legacyArchitectureDecision({ stackCandidates: stacks, initialization: config.initialization, topologyBinding: currentTopology });
  }
  const scope = scopeFor(scan, config, mode);
  const status = statusFor(mode, scope);
  return {
    schemaVersion: 1,
    profileId: profile.id,
    profileVersion: profile.version,
    source: 'initialization-decision',
    mode,
    status,
    stackCandidates: stacks,
    scope,
    verification: verificationFor(status),
    initializationBinding: currentBinding,
    topologyBinding: currentTopology,
  };
}

export function legacyArchitectureDecision({ stackCandidates = [], initialization = null, topologyBinding = null } = {}) {
  const { profile } = registry();
  return {
    schemaVersion: 1,
    profileId: profile.id,
    profileVersion: profile.version,
    source: 'legacy-migration',
    mode: 'legacy-unconfigured',
    status: 'legacy-unconfigured',
    stackCandidates,
    scope: { roots: [], appliesTo: 'none', baselineSourcePaths: [] },
    verification: verificationFor('legacy-unconfigured'),
    initializationBinding: initialization?.lifecycle ? initializationDigest(initialization) : null,
    topologyBinding,
  };
}

function assertStringArray(value, label) {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) throw usageError(`${label} must be an array of strings.`);
}

export function validateArchitectureDecision(architecture, initialization = null) {
  if (architecture === undefined) return null;
  if (!architecture || typeof architecture !== 'object') throw usageError('architecture must be an object when provided.');
  const { profile } = registry();
  if (architecture.schemaVersion !== 1) throw usageError('architecture.schemaVersion must be 1.');
  if (architecture.profileId !== profile.id || architecture.profileVersion !== profile.version) {
    throw usageError(`architecture must use ${profile.id} version ${profile.version}.`);
  }
  if (!['initialization-decision', 'legacy-migration'].includes(architecture.source)) throw usageError('architecture.source is invalid.');
  if (!ARCHITECTURE_MODES.includes(architecture.mode)) throw usageError('architecture.mode is invalid.');
  if (!ARCHITECTURE_STATUSES.includes(architecture.status)) throw usageError('architecture.status is invalid.');
  if (architecture.topologyBinding !== null && !TOPOLOGY_BINDINGS.has(architecture.topologyBinding)) throw usageError('architecture.topologyBinding is invalid.');
  assertStringArray(architecture.stackCandidates, 'architecture.stackCandidates');
  if (!architecture.scope || typeof architecture.scope !== 'object') throw usageError('architecture.scope is required.');
  assertStringArray(architecture.scope.roots, 'architecture.scope.roots');
  assertStringArray(architecture.scope.baselineSourcePaths, 'architecture.scope.baselineSourcePaths');
  if (!['future-code', 'new-modules-only', 'none'].includes(architecture.scope.appliesTo)) throw usageError('architecture.scope.appliesTo is invalid.');
  if (architecture.scope.roots.some((root) => root !== 'src')) throw usageError('architecture.scope.roots may only contain the registry-defined src root.');
  if (architecture.scope.baselineSourcePaths.some((relative) => !isSafeRelative(relative))) {
    throw usageError('architecture.scope.baselineSourcePaths must contain safe repository-relative source paths.');
  }
  if (new Set(architecture.scope.baselineSourcePaths).size !== architecture.scope.baselineSourcePaths.length) {
    throw usageError('architecture.scope.baselineSourcePaths must not contain duplicates.');
  }
  if (!architecture.verification || typeof architecture.verification !== 'object') throw usageError('architecture.verification is required.');
  for (const [key, value] of Object.entries(verificationFor(architecture.status))) {
    if (architecture.verification[key] !== value) throw usageError(`architecture.verification.${key} is invalid for its status.`);
  }

  if (architecture.mode === 'legacy-unconfigured') {
    if (architecture.source !== 'legacy-migration' || architecture.status !== 'legacy-unconfigured') {
      throw usageError('legacy architecture must remain legacy-unconfigured and use legacy-migration provenance.');
    }
    if (architecture.scope.roots.length !== 0 || architecture.scope.appliesTo !== 'none' || architecture.scope.baselineSourcePaths.length !== 0) {
      throw usageError('legacy architecture must not define an active source scope or baseline.');
    }
    const expectedBinding = initialization?.lifecycle ? initializationDigest(initialization) : null;
    if (architecture.initializationBinding !== null && architecture.initializationBinding !== expectedBinding) {
      throw usageError('legacy architecture initializationBinding does not match the recorded initialization decision.');
    }
    return architecture;
  }

  if (!TOPOLOGY_BINDINGS.has(architecture.topologyBinding)) throw usageError('active or advisory architecture requires a scanner topology binding.');

  const expectedMode = profileMode(initialization);
  if (initialization?.lifecycle && architecture.mode !== expectedMode) {
    throw usageError('architecture.mode must match the confirmed initialization decision.');
  }
  if (!initialization?.lifecycle && architecture.mode !== 'legacy-unconfigured') {
    throw usageError('architecture must remain legacy-unconfigured until initialization is confirmed.');
  }
  if (architecture.mode === 'module-first-new-code') {
    if (architecture.source !== 'initialization-decision') throw usageError('active architecture must originate from an initialization decision.');
    if (architecture.status === 'active' && (architecture.scope.roots.join(',') !== 'src' || architecture.scope.appliesTo === 'none')) {
      throw usageError('active architecture requires the registry-defined src scope and a future-code boundary.');
    }
    if (initialization?.lifecycle === 'existing' && architecture.status === 'active' && architecture.scope.appliesTo !== 'new-modules-only') {
      throw usageError('existing new-code architecture must apply to new modules only.');
    }
    if (initialization?.lifecycle === 'greenfield' && architecture.status === 'active' && architecture.scope.appliesTo !== 'future-code') {
      throw usageError('greenfield architecture must apply to future code.');
    }
  } else if (architecture.status !== 'advisory' && architecture.status !== 'legacy-unconfigured') {
    throw usageError('non-module-first architecture must be advisory or legacy-unconfigured.');
  }
  if (architecture.initializationBinding !== (initialization?.lifecycle ? initializationDigest(initialization) : null)) {
    throw usageError('architecture.initializationBinding does not match the confirmed initialization decision.');
  }
  return architecture;
}

export function architectureProfileDocument(config) {
  const { profile } = registry();
  const decision = config.architecture ?? legacyArchitectureDecision({ initialization: config.initialization ?? null });
  validateArchitectureDecision(decision, config.initialization ?? null);
  return {
    schemaVersion: 1,
    generatedMarker: GENERATED_MARKER,
    decisionId: 'initialization-architecture',
    profile: {
      id: profile.id,
      version: profile.version,
      summary: profile.summary,
    },
    status: decision.status,
    mode: decision.mode,
    source: decision.source,
    stackCandidates: decision.stackCandidates,
    topologyBinding: decision.topologyBinding,
    scope: decision.scope,
    invariants: profile.invariants,
    placement: profile.placement,
    verification: decision.verification,
    boundaries: [
      'This profile does not create product directories, generate business code, move files, or approve a migration.',
      'A passing aicg check verifies managed governance artifacts and detects current-tree placement violations only.',
      'Dependency direction, cohesion, and single responsibility remain stated guidance until the project adds dedicated verifiers.',
    ],
    generationBinding: {
      architectureDigest: architectureDigest(decision),
      initializationBinding: decision.initializationBinding,
    },
  };
}

export function architectureRule(config) {
  const decision = config.architecture ?? legacyArchitectureDecision({ initialization: config.initialization ?? null });
  const title = decision.status === 'active' ? 'Active future-code module boundary' : decision.status === 'advisory' ? 'Advisory architecture boundary' : 'Legacy-unconfigured architecture boundary';
  return `---\nalwaysApply: false\nprofiles: [implementation]\n---\n\n<!-- ${GENERATED_MARKER} -->\n\n# ${title}\n\nThe sole current architecture policy is [architecture-profile.json](../architecture-profile.json). Its status is \`${decision.status}\` and mode is \`${decision.mode}\`.\n\n- Use the profile for new implementation only when it is active; do not infer approval to migrate or rewrite existing code.\n- \`aicg check .\` can detect current-tree source placement against an active profile. It does not prove dependency direction, cohesion, or single responsibility.\n- If the profile is advisory or legacy-unconfigured, preserve the current product structure and request a separately approved architecture decision before changing it.\n`;
}

function entryFileAllowed(relative, placement) {
  const basename = relative.slice('src/'.length);
  if (basename.includes('/')) return false;
  const normalized = basename.replace(/\.[^.]+$/, '').replace(/\.(?:test|spec)$/, '');
  return placement.entryFiles.includes(normalized);
}

function modulePathAllowed(relative, placement) {
  const remainder = relative.slice('src/'.length);
  const [first, second, third] = remainder.split('/');
  if (!placement.moduleDirectories.includes(first)) return false;
  if (first === 'app' || first === 'shared' || first === 'platform' || first === 'bootstrap') return Boolean(second);
  return Boolean(second && third);
}

function isTestPath(relative) {
  return /(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/i.test(relative);
}

function potentialSourceLink(relative) {
  if (isImplementationSourcePath(relative)) return true;
  const normalized = relative.replaceAll('\\', '/');
  const segments = normalized.toLowerCase().split('/');
  const [root] = segments;
  const basename = segments.at(-1);
  if (root === 'src') return true;
  if (
    NON_SOURCE_LINK_ROOTS.has(root)
    || (segments.length === 1 && (NON_SOURCE_ROOT_LINK_NAMES.has(basename) || NON_SOURCE_ROOT_LINK_DOCUMENT.test(normalized)))
  ) return false;
  // Do not inspect the target to distinguish a file from a directory. Any link in an
  // unknown project location can be a source-bearing directory, even when its name has
  // an extension; known documentation and asset roots are the narrow safe exception.
  return true;
}

export function architecturePlacementIssues(scan, config) {
  const decision = config.architecture;
  if (!decision) return [];
  validateArchitectureDecision(decision, config.initialization ?? null);
  if (decision.status !== 'active' || decision.verification.newFilePlacement !== 'aicg-check-detects-current-tree') return [];
  const currentTopology = topologyBinding(scan);
  if (decision.topologyBinding !== currentTopology) {
    return [`repository topology changed from ${decision.topologyBinding} to ${currentTopology}; the recorded root scope is disabled until aicg init records a new architecture decision.`];
  }
  const { profile } = registry();
  const baseline = new Set(decision.scope.baselineSourcePaths);
  const sourceIssues = projectSourcePaths(scan)
    .filter((relative) => !isTestPath(relative) && !baseline.has(relative) && !isArchitectureNonSourcePath(relative))
    .filter((relative) => !relative.startsWith('src/') || (!entryFileAllowed(relative, profile.placement) && !modulePathAllowed(relative, profile.placement)))
    .sort((left, right) => left.localeCompare(right))
    .map((relative) => `${relative}: new implementation source is outside the active ${decision.profileId} src placement policy; place it in a named module directory or an approved entrypoint.`);
  const linkIssues = scan.files
    .filter((file) => file.type === 'link')
    .map((file) => file.relative)
    .filter((relative) => potentialSourceLink(relative))
    .sort((left, right) => left.localeCompare(right))
    .map((relative) => isImplementationSourcePath(relative)
      ? `${relative}: implementation source is a symbolic link and cannot be governed by the active placement policy.`
      : `${relative}: a symbolic link in a potential source location is blocked because a directory link can conceal implementation source; aicg does not follow link targets.`);
  return [...sourceIssues, ...linkIssues].sort((left, right) => left.localeCompare(right));
}

export function validateArchitectureProfileRegistry() {
  const { value, profile } = registry();
  if (value.profiles.filter((candidate) => candidate.id === profile.id).length !== 1) throw new Error('Architecture profile registry contains duplicate profile ids.');
  if (!profile.placement.scopeRoot || !Array.isArray(profile.placement.entryFiles) || !Array.isArray(profile.placement.moduleDirectories)) {
    throw new Error('Architecture profile registry has an invalid placement contract.');
  }
  return true;
}

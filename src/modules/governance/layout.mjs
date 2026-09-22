import fs from 'node:fs';
import path from 'node:path';

/**
 * The single source of truth for the generated governance layout.
 *
 * The canonical docs/ai root only allows the human README and the machine context map.
 * Every other generated artifact is routed by responsibility:
 *   - machine-only control plane  -> .ai-governance/state/<basename>
 *   - human/agent-readable policy -> docs/ai/policies/<basename>
 *   - routing/entry documents     -> docs/ai/routing/<basename>
 *   - acceptance and evidence     -> docs/ai/evidence/<basename>
 *   - activated integrations      -> docs/ai/integrations/<basename>
 *   - per-development-unit docs   -> docs/ai/development/<basename>
 *
 * The preserve footprint keeps the historical flat paths byte-for-byte so an existing
 * repository is never migrated by an ordinary sync.
 */
export const STATE_DIR = '.ai-governance/state';
export const POLICY_DIR = 'docs/ai/policies';
export const ROUTING_DIR = 'docs/ai/routing';
export const EVIDENCE_DIR = 'docs/ai/evidence';
export const INTEGRATION_DIR = 'docs/ai/integrations';

const initialMachineState = [
  'task-routing-policy.json',
  'verification-profiles.yaml',
  'decision-ledger.json',
  'skill-index.json',
  'agent-team.json',
  'delivery-loop.json',
  'module-graph.json',
  'stack-profile.json',
  'architecture-profile.json',
  'repository-family.json',
  'capability-evolution.json',
  'technical-standards.json',
  'surface-verification-profiles.json',
  'project-conventions.json',
];

const initialPolicies = [
  'anti-patterns.md',
  'lifecycle.md',
  'business-constraints.json',
];

const initialRules = [
  '00_always.mdc',
  '15_architecture.mdc',
  '20_stack.mdc',
];

const initialEvidence = [
  'release-acceptance-policy.json',
  'acceptance-contract.json',
  'surface-results.json',
  'acceptance-results.json',
  'certification-evidence.json',
  'business-acceptance-results.json',
  'business-risk-evidence.json',
  'risk-evidence.json',
  'release-acceptance-override.json',
  'surface-verification.json',
];

const initialIntegrations = ['workflow-integrations.yaml', 'hooks.md', 'ci-integration.md'];

/** [legacyPath, compactPath] pairs. Callers use these to build cross-references. */
export const COMPACT_PATH_PAIRS = Object.freeze([]
  .concat(initialMachineState.map((name) => ['docs/ai/' + name, STATE_DIR + '/' + name]))
  .concat(initialPolicies.map((name) => ['docs/ai/' + name, POLICY_DIR + '/' + name]))
  .concat(initialRules.map((name) => ['docs/ai/rules/' + name, POLICY_DIR + '/' + name]))
  .concat([['docs/ai/bootstrap-prompt.md', ROUTING_DIR + '/bootstrap-prompt.md']])
  .concat(initialEvidence.map((name) => ['docs/ai/' + name, EVIDENCE_DIR + '/' + name]))
  .concat(initialIntegrations.map((name) => ['docs/ai/' + name, INTEGRATION_DIR + '/' + name]))
  // The greenfield single-unit development page belongs to the development topic directory.
  .concat([['docs/ai/development.md', 'docs/ai/development/README.md']])
  .map((pair) => Object.freeze(pair)));

const COMPACT_PATH_MAP = new Map(COMPACT_PATH_PAIRS.map(([legacy, compact]) => [legacy, compact]));

/** Named compact paths the compiler depends on without re-declaring strings. */
export const COMPACT_PATHS = Object.freeze({
  alwaysRule: 'docs/ai/policies/00_always.mdc',
  architectureRule: 'docs/ai/policies/15_architecture.mdc',
  stackRule: 'docs/ai/policies/20_stack.mdc',
  taskRouting: '.ai-governance/state/task-routing-policy.json',
  verificationProfiles: '.ai-governance/state/verification-profiles.yaml',
  decisionLedger: '.ai-governance/state/decision-ledger.json',
  skillIndex: '.ai-governance/state/skill-index.json',
  agentTeam: '.ai-governance/state/agent-team.json',
  deliveryLoop: '.ai-governance/state/delivery-loop.json',
  moduleGraph: '.ai-governance/state/module-graph.json',
  stackProfile: '.ai-governance/state/stack-profile.json',
  architectureProfile: '.ai-governance/state/architecture-profile.json',
  repositoryFamily: '.ai-governance/state/repository-family.json',
  capabilityEvolution: '.ai-governance/state/capability-evolution.json',
  technicalStandards: '.ai-governance/state/technical-standards.json',
  surfaceVerificationProfiles: '.ai-governance/state/surface-verification-profiles.json',
  projectConventions: '.ai-governance/state/project-conventions.json',
  antiPatterns: 'docs/ai/policies/anti-patterns.md',
  lifecycle: 'docs/ai/policies/lifecycle.md',
  businessConstraints: 'docs/ai/policies/business-constraints.json',
  bootstrapPrompt: 'docs/ai/routing/bootstrap-prompt.md',
  releaseAcceptancePolicy: 'docs/ai/evidence/release-acceptance-policy.json',
  acceptanceContract: 'docs/ai/evidence/acceptance-contract.json',
  acceptanceResults: 'docs/ai/evidence/acceptance-results.json',
  surfaceResults: 'docs/ai/evidence/surface-results.json',
  certificationEvidence: 'docs/ai/evidence/certification-evidence.json',
  businessAcceptanceResults: 'docs/ai/evidence/business-acceptance-results.json',
  riskEvidence: 'docs/ai/evidence/risk-evidence.json',
  releaseAcceptanceOverride: 'docs/ai/evidence/release-acceptance-override.json',
  surfaceVerification: 'docs/ai/evidence/surface-verification.json',
  workflowIntegrations: 'docs/ai/integrations/workflow-integrations.yaml',
  hooks: 'docs/ai/integrations/hooks.md',
  ciIntegration: 'docs/ai/integrations/ci-integration.md',
});

/** Compact or unchanged repository-relative path for a generated governance artifact. */
export function canonicalPath(legacyPath, footprint = 'compact') {
  if (footprint !== 'compact') return legacyPath;
  return COMPACT_PATH_MAP.get(legacyPath) ?? legacyPath;
}

/** Bind the footprint once for a module that resolves several paths. */
export function canonicalPathFor(footprint = 'compact') {
  return (legacyPath) => canonicalPath(legacyPath, footprint);
}

/**
 * Both layouts an artifact may legitimately occupy: the historical path and its compact form.
 * Footprint-agnostic readers accept either so a preserve tree and a compact tree are both
 * recognized without rereading the managed configuration.
 */
export function canonicalPathVariants(legacyPath) {
  const compact = canonicalPath(legacyPath, 'compact');
  return compact === legacyPath ? [legacyPath] : [legacyPath, compact];
}

/** True when a candidate path is the legacy artifact or the compact form of the same artifact. */
export function isCanonicalPath(candidate, legacyPath) {
  return canonicalPathVariants(legacyPath).includes(candidate);
}

/** Only the two allowed root entries may sit directly under docs/ai in a compact tree. */
export function isAllowedCanonicalRootEntry(relativePath) {
  return relativePath === 'docs/ai/README.md' || relativePath === 'docs/ai/context-map.yaml';
}

/** Root-level docs/ai entries a compact tree would reject. */
export function disallowedCanonicalRootEntries(relativePaths) {
  return relativePaths.filter((relativePath) => relativePath.startsWith('docs/ai/')
    && !relativePath.slice('docs/ai/'.length).includes('/')
    && !isAllowedCanonicalRootEntry(relativePath));
}

/** Remap a whole rendered artifact list onto the requested footprint. */
export function remapArtifactPaths(artifacts, footprint = 'compact') {
  return artifacts.map((artifact) => ({ ...artifact, path: canonicalPath(artifact.path, footprint) }));
}

const PATH_CHARACTER = /[A-Za-z0-9_./-]/;

function replaceAtBoundaries(content, legacy, compact) {
  let result = '';
  let index = 0;
  while (index <= content.length) {
    const found = content.indexOf(legacy, index);
    if (found === -1) {
      result += content.slice(index);
      return result;
    }
    const before = found === 0 ? '' : content[found - 1];
    const afterIndex = found + legacy.length;
    const after = afterIndex >= content.length ? '' : content[afterIndex];
    const boundary = !PATH_CHARACTER.test(before) && !PATH_CHARACTER.test(after);
    result += content.slice(index, found);
    result += boundary ? compact : legacy;
    index = afterIndex;
  }
  return result;
}

/**
 * Rewrite every in-content reference to a moved artifact. A path only matches at a token
 * boundary, so a nested unit page such as services/api/docs/ai/development.md is never
 * rewritten by the root docs/ai/development.md pair.
 */
export function remapContentPaths(content, footprint = 'compact') {
  if (footprint !== 'compact' || typeof content !== 'string' || content.length === 0) return content;
  let result = content;
  for (const [legacy, compact] of COMPACT_PATH_PAIRS) {
    if (legacy === compact) continue;
    result = replaceAtBoundaries(result, legacy, compact);
  }
  return result;
}

/** Read a repository-relative reference relative to a canonical file's directory. */
export function relativeReference(fromPath, toPath) {
  return path.posix.relative(path.posix.dirname(fromPath), toPath);
}

const RECORDED_CONFIG_PATH = '.ai-governance/config.json';

/** Footprint recorded by the repository's managed config; a fresh tree is compact. */
export function recordedFootprint(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(root, RECORDED_CONFIG_PATH), 'utf8'));
    return parsed?.governanceFootprint === 'preserve' ? 'preserve' : 'compact';
  } catch {
    return 'compact';
  }
}

/**
 * Resolve the actual location of a generated artifact: the footprint-preferred path first, then
 * the other known layout. Read-only callers accept both so a compact tree and a preserve tree are
 * both visible without the caller knowing which layout the repository recorded.
 */
export function readCanonicalPath(root, legacyPath, footprint = null) {
  const preferred = canonicalPath(legacyPath, footprint ?? recordedFootprint(root));
  if (fs.existsSync(path.join(root, preferred))) return preferred;
  for (const variant of canonicalPathVariants(legacyPath)) {
    if (variant !== preferred && fs.existsSync(path.join(root, variant))) return variant;
  }
  return preferred;
}

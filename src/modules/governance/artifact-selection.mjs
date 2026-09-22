import { canonicalPathVariants } from './layout.mjs';

const EVIDENCE_PATHS = {
  release: ['docs/ai/release-acceptance-policy.json'],
  surface: ['docs/ai/surface-verification-profiles.json', 'docs/ai/surface-results.json'],
  acceptance: ['docs/ai/acceptance-contract.json', 'docs/ai/acceptance-results.json'],
  certification: ['docs/ai/certification-evidence.json'],
};

export function hasArtifactEvidence(scan, relative) {
  // A preserve tree keeps the historical path; a compact tree moves the same artifact. Accept
  // either so evidence detection never depends on which footprint the caller reads.
  const variants = new Set(canonicalPathVariants(relative));
  return (scan?.files ?? []).some((file) => file.type === 'file' && variants.has(file.relative));
}

// Usage is a caller-supplied first-use request, never inferred from task text.
export function hasGovernanceUsage(scan, usage) {
  return (scan?.governanceUsage ?? []).includes(usage)
    || (EVIDENCE_PATHS[usage] ?? []).some((relative) => hasArtifactEvidence(scan, relative));
}

export function resolveGovernanceCapabilities(config, scan) {
  const active = new Set(['core']);
  if (config.governanceDepth !== 'minimal') active.add('routing');
  if (config.governanceDepth !== 'minimal' && (
    ['approved', 'active', 'advisory'].includes(config.architecture?.status)
    || (config.domainConstraints?.length ?? 0) > 0
    || (config.stacks?.length ?? 0) > 0
  )) active.add('policy');
  if ((config.clients?.length ?? 0) > 0 || config.features?.hooks || config.features?.externalWorkflows || config.features?.ciIntegration) active.add('integration');
  if (config.features?.taskRuntime || (config.projectCapabilities?.length ?? 0) > 0 || config.capabilityEvolution) active.add('lifecycle');
  if (Object.keys(EVIDENCE_PATHS).some((usage) => hasGovernanceUsage(scan, usage))) active.add('evidence');
  if (config.governanceDepth !== 'minimal' && config.skillDiscovery?.enabled === true && config.agentTeam?.enabled === true) active.add('skill-management');
  return active;
}

/** Select metadata only; builders and filesystem access belong to the compiler. */
export function selectArtifactDefinitions(config, scan, definitions) {
  const active = resolveGovernanceCapabilities(config, scan);
  return definitions.filter((definition) => {
    if (!active.has(definition.capability)) return false;
    if (!definition.requires.every((requirement) => requirement(config, scan))) return false;
    if (definition.activation === 'evidence-produced') return hasArtifactEvidence(scan, definition.path);
    if (definition.activation === 'first-use') return definition.requires.length > 0;
    return ['eager-core', 'selected'].includes(definition.activation);
  });
}

export function conditionalArtifactRoutes(definitions, profile) {
  const routes = new Map();
  for (const definition of definitions) {
    for (const route of definition.routeProfiles) {
      const [name, condition] = route.split(':');
      if (name !== profile || !condition) continue;
      if (!routes.has(condition)) routes.set(condition, []);
      routes.get(condition).push(definition.path);
    }
  }
  return routes;
}

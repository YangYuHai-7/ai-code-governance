import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/index.mjs';
import { validateArchitectureIr, validateRequirementIr } from './contracts.mjs';

function boundedRecords(value, name) {
  if (!Array.isArray(value) || value.length > 10000) throw usageError(`Traceability ${name} must be a bounded array.`);
  const seen = new Set();
  for (const [index, entry] of value.entries()) {
    if (!entry || typeof entry !== 'object' || typeof entry.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(entry.id)) throw usageError(`Traceability ${name}[${index}] has an invalid id.`);
    if (seen.has(entry.id)) throw usageError(`Traceability ${name} contains duplicate id ${entry.id}.`);
    seen.add(entry.id);
    if (entry.path !== undefined && (typeof entry.path !== 'string' || !isSafeRelative(normalizeRelative(entry.path)))) throw usageError(`Traceability ${name}[${index}].path must be a safe repository-relative path.`);
  }
  return value.map((entry) => Object.freeze({ ...entry }));
}

export function buildTraceabilityGraph({ requirement, architecture, patches = [], tests = [], evidence = [] }) {
  const normalizedRequirement = validateRequirementIr(requirement);
  const normalizedArchitecture = validateArchitectureIr(architecture);
  const requirementNodes = [
    ...normalizedRequirement.goals.map((entry) => ({ id: entry.id, kind: 'goal' })),
    ...normalizedRequirement.businessRules.map((entry) => ({ id: entry.id, kind: 'business-rule' })),
    ...normalizedRequirement.acceptanceScenarios.map((entry) => ({ id: entry.id, kind: 'acceptance' })),
  ];
  return Object.freeze({
    requirement: normalizedRequirement,
    architecture: normalizedArchitecture,
    requirementNodes: Object.freeze(requirementNodes.map(Object.freeze)),
    architectureIds: Object.freeze(normalizedArchitecture.decisions.map((entry) => entry.id)),
    patches: Object.freeze(boundedRecords(patches, 'patches')),
    tests: Object.freeze(boundedRecords(tests, 'tests')),
    evidence: Object.freeze(boundedRecords(evidence, 'evidence')),
  });
}

export function evaluateTraceability(graph) {
  if (!graph || typeof graph !== 'object' || !Array.isArray(graph.requirementNodes)) throw usageError('A traceability graph is required.');
  const requirementIds = new Set(graph.requirementNodes.map((entry) => entry.id));
  const architectureIds = new Set(graph.architectureIds);
  const evidenceById = new Map(graph.evidence.map((entry) => [entry.id, entry]));
  const gaps = [];
  for (const test of graph.tests) for (const requirementId of test.requirementIds ?? []) if (!requirementIds.has(requirementId)) gaps.push(`Test ${test.id} references unknown requirement ${requirementId}.`);
  const orphanChanges = graph.patches.filter((patch) => !(patch.requirementIds ?? []).some((id) => requirementIds.has(id)) || !(patch.architectureIds ?? []).some((id) => architectureIds.has(id))).map((patch) => patch.path).sort();
  for (const relative of orphanChanges) gaps.push(`Orphan changed path ${relative} has no approved requirement and architecture owner.`);
  const unverifiedNodes = graph.evidence.filter((entry) => entry.status !== 'passed' || entry.verificationLevel !== 'verified').map((entry) => entry.id).sort();
  const requirementCoverage = graph.requirementNodes.map((node) => {
    const ownedPatches = graph.patches.filter((patch) => (patch.requirementIds ?? []).includes(node.id) && (patch.architectureIds ?? []).some((id) => architectureIds.has(id)));
    const ownedTests = graph.tests.filter((entry) => (entry.requirementIds ?? []).includes(node.id));
    const evidenceIds = [...new Set(ownedTests.flatMap((entry) => entry.evidenceIds ?? []))];
    const verified = evidenceIds.filter((id) => { const item = evidenceById.get(id); return item?.status === 'passed' && item?.verificationLevel === 'verified'; });
    const missing = [];
    if (!ownedPatches.length) missing.push('implementation ownership');
    if (!ownedTests.length) missing.push('test coverage');
    if (!verified.length) missing.push('current verified evidence');
    if (missing.length) gaps.push(`Requirement ${node.id} is missing ${missing.join(', ')}.`);
    return Object.freeze({ id: node.id, kind: node.kind, status: missing.length ? 'missing' : 'covered', paths: Object.freeze(ownedPatches.map((entry) => entry.path)), tests: Object.freeze(ownedTests.map((entry) => entry.id)), evidenceIds: Object.freeze(verified), missing: Object.freeze(missing) });
  });
  return Object.freeze({ status: gaps.length ? 'incomplete' : 'complete', requirementCoverage: Object.freeze(requirementCoverage), orphanChanges: Object.freeze(orphanChanges), unverifiedNodes: Object.freeze(unverifiedNodes), gaps: Object.freeze(gaps) });
}

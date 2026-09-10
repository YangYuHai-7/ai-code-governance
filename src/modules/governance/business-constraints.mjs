import { GENERATED_MARKER } from '../../constants.mjs';
import { sha256, stableJson } from '../../shared/index.mjs';

export const BUSINESS_CONSTRAINTS_PATH = 'docs/ai/business-constraints.json';
export const BUSINESS_CONSTRAINT_SKILL_PATH = 'docs/ai/skills/business-constraints/SKILL.md';
export const BUSINESS_ACCEPTANCE_RESULTS_PATH = 'docs/ai/business-acceptance-results.json';

const RISK_CHECKLISTS = Object.freeze({
  authentication: [
    'Reject missing, forged, expired, and revoked identities before business authorization runs.',
    'Bind the application principal to a trusted authentication mechanism; do not accept identity claims solely from request-controlled fields.',
  ],
  authorization: [
    'Treat untrusted client-supplied identity headers as attacker-controlled unless a trusted authentication boundary verifies and replaces them.',
    'Exercise least-privilege allow and deny paths, including inactive, suspended, or revoked membership.',
  ],
  payment: [
    'Verify amount and currency boundaries, allowed state transitions, duplicate payment references, and rollback or compensation after failure.',
    'Exercise idempotent replay and conflicting replay without double settlement or duplicate audit success.',
  ],
  'sensitive-data': [
    'Fail closed when a secret or encryption key is absent; never ship a default credential.',
    'Verify key lifecycle, rotation and revocation, unauthorized reads, and secret redaction from logs, errors, and audit records.',
  ],
  'external-side-effect': [
    'Verify persistent idempotency across replay, restart, concurrent workers, and crash recovery.',
    'Record or coordinate the side effect atomically through an inbox, outbox, target idempotency key, or an explicitly evidenced equivalent.',
  ],
  'multi-tenancy': [
    'Derive the tenant boundary from a trusted principal rather than accepting an unchecked request value.',
    'Exercise cross-tenant read and write attempts plus inactive, suspended, or revoked membership paths.',
  ],
  'data-consistency': [
    'Exercise concurrent lost updates, duplicate requests, and unique constraints at the authoritative persistence boundary.',
    'Verify atomicity, rollback, crash recovery and multi-instance execution without relying on one process memory.',
  ],
  'public-api': [
    'Enforce request size and rate limits plus input schema validation before expensive work.',
    'Verify authentication and authorization boundaries and a stable error contract across success, denial, malformed input, and internal failure.',
  ],
});

export function businessConstraintRecords(config) {
  return (config.domainConstraints ?? []).map((value) => {
    const constraint = value.trim();
    const constraintHash = sha256(constraint);
    return {
      id: `constraint-${constraintHash}`,
      constraint,
      constraintHash,
      owner: 'product-owner',
      source: 'owner-confirmed',
      evidenceRequirements: ['success-evidence', 'negative-or-boundary-evidence'],
    };
  });
}

export function businessConstraintRegistry(config) {
  return {
    schemaVersion: 1,
    generatedMarker: GENERATED_MARKER,
    owner: 'product-owner',
    source: 'owner-confirmed',
    confirmedRiskSignals: [...(config.confirmedRiskSignals ?? [])],
    constraints: businessConstraintRecords(config),
    acceptanceResultsPath: BUSINESS_ACCEPTANCE_RESULTS_PATH,
    boundary: 'Constraint text and risk signals come only from explicit owner-confirmed configuration. No keyword-based risk inference is performed.',
  };
}

function riskChecklist(config) {
  const signals = config.confirmedRiskSignals ?? [];
  if (signals.length === 0) return 'No structured risk signal was confirmed. Do not infer one from constraint wording; ask the owner before adding a risk-specific checklist.';
  return signals.map((signal) => `### ${signal}\n\n${RISK_CHECKLISTS[signal].map((check) => `- ${check}`).join('\n')}`).join('\n\n');
}

export function businessConstraintSkill(config) {
  const constraints = businessConstraintRecords(config).map((record) => `### ${record.id}\n\n- Owner: \`${record.owner}\`\n- Source: \`${record.source}\`\n- Constraint hash: \`${record.constraintHash}\`\n- Constraint: ${JSON.stringify(record.constraint)}\n- Required evidence: one concrete success evidence item and one concrete negative or boundary evidence item bound to this exact id, text, and hash.`).join('\n\n');
  return `---
name: business-constraints
description: Apply owner-confirmed project invariants and require evidence for every affected constraint.
---

# Owner-confirmed business constraints

<!-- ${GENERATED_MARKER} -->

This Skill is routed from explicit owner-confirmed configuration. Do not infer additional constraints or risk signals from keywords.

## Required workflow

1. Identify every constraint below affected by the requested behavior.
2. Preserve its stable id, exact text, and SHA-256 binding from \`${BUSINESS_CONSTRAINTS_PATH}\`.
3. Define and run at least one success case for each affected constraint.
4. Define and run at least one negative or boundary case for each affected constraint.
5. Record evidence in \`${BUSINESS_ACCEPTANCE_RESULTS_PATH}\`; a passing item binds \`id\`, \`constraint\`, and \`constraintHash\` and includes non-empty \`successEvidence\` and \`failureOrBoundaryEvidence\`.
6. Report production readiness as blocked while evidence is missing, incomplete, or mismatched. Even after every item is recorded against the current id, text, and hash, report only unverified and eligible-for-review; a completion command does not replay or certify arbitrary business evidence.

## Constraints

${constraints}

## Owner-confirmed risk signals

${(config.confirmedRiskSignals ?? []).join(', ') || 'none'}

${riskChecklist(config)}
`;
}

export function businessConstraintRegistryContent(config) {
  return stableJson(businessConstraintRegistry(config));
}

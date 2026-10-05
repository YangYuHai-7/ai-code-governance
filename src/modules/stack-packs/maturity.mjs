const RECEIPT_LEVELS = new Set([
  'E0-generated',
  'E1-deterministic',
  'E2-integrated',
  'E3-agent-executable',
  'E4-golden-path-certified',
]);

const MISSING_EVIDENCE = Object.freeze([
  ['missing-evaluation-receipt', 'A current evaluation receipt bound to this Pack and exact facts is required.'],
  ['missing-e2-integrated-evidence', 'Controlled full-application and PostgreSQL matrix evidence is required.'],
  ['missing-e3-agent-evidence', 'A real supported Agent must complete the exact matrix through the Core runtime.'],
  ['missing-e4-held-out-evidence', 'Held-out structurally distinct repository evidence is required.'],
  ['missing-current-os-evidence', 'Current claimed operating-system matrix evidence is required.'],
  ['missing-qualified-user-evidence', 'Qualified-user acceptance evidence is required.'],
]);

function freeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) freeze(entry);
  return value;
}

function gap(code, message) {
  return { code, message };
}

function receiptMatches(evaluation, compatibility) {
  if (!evaluation || typeof evaluation !== 'object' || Array.isArray(evaluation)) return { valid: false, stale: false, level: null };
  const level = RECEIPT_LEVELS.has(evaluation.evidenceLevel) ? evaluation.evidenceLevel : null;
  const exact = evaluation.packDigest === compatibility.packDigest && evaluation.factsDigest === compatibility.factsDigest;
  return { valid: Boolean(level && exact && evaluation.current === true), stale: Boolean(level && !exact || evaluation.current === false), level };
}

function evidenceGaps(level, stale) {
  if (level === 'E4-golden-path-certified' && !stale) return [];
  const missing = [];
  if (stale) missing.push(gap('stale-evaluation-receipt', 'The evaluation receipt is stale for this Pack or exact dependency facts.'));
  const start = level === 'E3-agent-executable' && !stale ? 3 : level === 'E2-integrated' && !stale ? 2 : 0;
  for (const [code, message] of MISSING_EVIDENCE.slice(start)) missing.push(gap(code, message));
  return missing;
}

/**
 * Derive the only public maturity declaration permitted by the current exact evidence.
 *
 * Legacy registry lifecycle and evidence fields are deliberately excluded from the decision:
 * they describe detection availability, not executable or certified Golden Path support.
 */
export function derivePackMaturity({ registryEntry, pack, compatibility, evaluation = null }) {
  const linked = registryEntry?.contract?.goldenPathPackId === pack?.id;
  const compatible = compatibility?.status === 'compatible';
  const receipt = receiptMatches(evaluation, compatibility ?? {});
  if (!linked) return freeze({
    maturity: 'legacy-unverified',
    evidenceLevel: 'legacy-unverified',
    claim: 'Legacy stack detection is available; no Golden Path maturity claim is published.',
    gaps: [gap('missing-contract-link', 'This legacy registry entry has no matching Golden Path contract link.')],
  });

  const gaps = [];
  if (!compatible) {
    gaps.push(gap('pack-compatibility-not-current', 'Exact repository facts are not currently compatible with the Golden Path Pack.'));
    for (const item of compatibility?.gaps ?? []) gaps.push(gap(`compatibility-${item.code}`, item.message));
  }
  // A current E2/E3 receipt still leaves later evidence dimensions unsatisfied. E4 is the
  // only level whose complete validated receipt closes every published maturity gap.
  gaps.push(...evidenceGaps(receipt.level, receipt.stale));

  if (compatible && receipt.valid && receipt.level === 'E4-golden-path-certified') return freeze({
    maturity: 'certified',
    evidenceLevel: receipt.level,
    claim: `Golden Path ${pack.id} is certified for the exact current evaluated matrix.`,
    gaps: [],
  });
  if (compatible && receipt.valid && receipt.level === 'E3-agent-executable') return freeze({
    maturity: 'executable',
    evidenceLevel: receipt.level,
    claim: `Golden Path ${pack.id} is executable by a supported Agent for the exact evaluated matrix; it is not certified.`,
    gaps,
  });
  if (compatible && receipt.valid && receipt.level === 'E2-integrated') return freeze({
    maturity: 'executable-candidate',
    evidenceLevel: receipt.level,
    claim: `Golden Path ${pack.id} has integrated evidence for the exact matrix; it remains an executable candidate, not certified.`,
    gaps,
  });
  return freeze({
    maturity: 'guided',
    evidenceLevel: receipt.valid ? receipt.level : 'E0-generated',
    claim: `Golden Path ${pack.id} provides guided generation only; executable and certified claims require current evidence.`,
    gaps,
  });
}

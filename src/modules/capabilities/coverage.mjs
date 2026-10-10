import { usageError } from '../../kernel/index.mjs';

// The registry vocabulary carries an explicit unverified state for every coverage dimension.
export const DETECTION_STATES = Object.freeze(['supported', 'partial', 'none', 'unverified']);
export const SKILL_COVERAGE_STATES = Object.freeze(['full', 'partial', 'none', 'unverified']);
export const SCENARIO_STATES = Object.freeze(['real-project', 'synthetic-only', 'none', 'unverified']);
const MATURITY_CANDIDATES = Object.freeze(['unverified', 'detected', 'guided', 'executable', 'certified']);

function fail(path, message) { throw usageError(`${path}: ${message}`); }
function object(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object'); return value; }

function detectionPackages(entry) {
  const found = new Set();
  const visit = (value) => {
    if (typeof value === 'string') { found.add(value); return; }
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (value && typeof value === 'object') Object.values(value).forEach(visit);
  };
  visit(entry.detect ?? {});
  return found;
}

// Coverage claims are derived and checked against the evaluation records; nothing here trusts the
// hand-written fields alone, so a pack cannot advertise support the records do not back.
export function validateCapabilityCoverage({ registry, evaluationRecords = [] } = {}) {
  object(registry, 'capabilityRegistry');
  if (!Array.isArray(registry.packs)) fail('capabilityRegistry.packs', 'expected an array');
  const evidenceLevels = new Set([...(registry.evidence_levels ?? []), 'unverified', 'verified', 'detected', 'guided', 'executable', 'certified']);
  const records = Array.isArray(evaluationRecords) ? evaluationRecords : [];
  const findings = [];

  for (const entry of registry.packs) {
    if (!entry || typeof entry.id !== 'string') fail('capabilityRegistry.packs[].id', 'expected a pack id');
    const coverage = entry.coverage ?? {};
    const add = (code, detail) => findings.push({ code, packId: entry.id, detail });
    if (!evidenceLevels.has(entry.evidence)) add('unsupported-evidence-level', `evidence ${entry.evidence} is not declared by the registry`);
    if (coverage.detectionSupport !== undefined && !DETECTION_STATES.includes(coverage.detectionSupport)) add('unsupported-detection-state', String(coverage.detectionSupport));
    if (coverage.standardSkillCoverage !== undefined && !SKILL_COVERAGE_STATES.includes(coverage.standardSkillCoverage)) add('unsupported-skill-coverage', String(coverage.standardSkillCoverage));
    if (coverage.scenarioEvidence !== undefined && !SCENARIO_STATES.includes(coverage.scenarioEvidence)) add('unsupported-scenario-evidence', String(coverage.scenarioEvidence));
    if (coverage.scenarioEvidence === 'real-project' && entry.evidence !== 'verified') {
      add('coverage-evidence-drift', 'real-project scenario evidence requires verified evidence');
    }
    if (entry.evidence === 'verified') {
      const backing = records.filter((record) => record?.packId === entry.id && ['E3-agent-executable', 'E4-golden-path-certified'].includes(record.level));
      if (backing.length === 0) add('missing-evaluation-record', 'verified evidence requires a current E3 or E4 evaluation record');
    }
    const known = detectionPackages(entry);
    for (const pkg of coverage.coveredPackages ?? []) {
      if (known.size > 0 && !known.has(pkg)) add('coverage-detection-drift', `covered package ${pkg} is not declared by detection`);
    }
    const partial = coverage.scenarioEvidence !== undefined && coverage.scenarioEvidence !== 'real-project';
    if (partial && (coverage.gaps ?? []).length === 0) add('undeclared-coverage-gaps', 'partial or synthetic coverage must declare its gaps');
  }
  return Object.freeze({ status: findings.length === 0 ? 'clean' : 'drifted', findings: Object.freeze(findings.map((finding) => Object.freeze(finding))) });
}

// The published coverage summary is generated, never hand-maintained: the drift test compares the
// document block with this renderer byte for byte.
export const COVERAGE_SUMMARY_START = '<!-- GENERATED: capability-coverage-summary -->';
export const COVERAGE_SUMMARY_END = '<!-- END GENERATED: capability-coverage-summary -->';

export function renderCapabilityCoverageSummary({ registry, evaluationRecords = [] } = {}) {
  const summary = summarizeCapabilityCoverage({ registry, evaluationRecords });
  const rows = summary.map((entry) => `| \`${entry.id}\` | \`${entry.maturityCandidate}\` | \`${entry.claimedEvidence}\` | \`${entry.evaluationLevel ?? 'none'}\` | \`${entry.standardSkillCoverage}\` | \`${entry.scenarioEvidence}\` | ${entry.gaps.length} |`);
  return [
    COVERAGE_SUMMARY_START,
    '',
    '| 能力包 | 成熟度候选 | 声明证据 | 评估记录 | 标准技能覆盖 | 场景证据 | 未决缺口数 |',
    '| --- | --- | --- | --- | --- | --- | --- |',
    ...rows,
    '',
    COVERAGE_SUMMARY_END,
    '',
  ].join('\n');
}

export function summarizeCapabilityCoverage({ registry, evaluationRecords = [] } = {}) {
  object(registry, 'capabilityRegistry');
  if (!Array.isArray(registry.packs)) fail('capabilityRegistry.packs', 'expected an array');
  const records = Array.isArray(evaluationRecords) ? evaluationRecords : [];
  return Object.freeze(registry.packs.map((entry) => {
    const backing = records.filter((record) => record?.packId === entry.id);
    const best = backing.map((record) => record.level).find((level) => level === 'E4-golden-path-certified')
      ?? backing.map((record) => record.level).find((level) => level === 'E3-agent-executable')
      ?? backing[0]?.level ?? null;
    const maturityCandidate = best === 'E4-golden-path-certified' ? 'certified'
      : best === 'E3-agent-executable' ? 'executable'
        : best === 'E2-integrated' || best === 'E1-deterministic' ? 'guided'
          : entry.coverage?.detectionSupport === 'supported' ? 'detected' : 'unverified';
    return Object.freeze({
      id: entry.id,
      maturityCandidate,
      claimedEvidence: entry.evidence ?? 'unverified',
      evaluationLevel: best,
      standardSkillCoverage: entry.coverage?.standardSkillCoverage ?? 'none',
      scenarioEvidence: entry.coverage?.scenarioEvidence ?? 'none',
      coveredPackages: Object.freeze([...(entry.coverage?.coveredPackages ?? [])]),
      gaps: Object.freeze([...(entry.coverage?.gaps ?? [])]),
    });
  }));
}
import { usageError } from '../../kernel/index.mjs';
import { sha256 } from '../../shared/index.mjs';
import { canonicalContractDigest, validateRequirementIr } from './contracts.mjs';

const SCHEMA_PATH = 'assets/contracts/requirement-ir-v2-schema.json';
const BOUNDARIES = Object.freeze([
  'Return one JSON object that conforms to Requirement IR v2.',
  'Do not invent owner decisions.',
  'Keep assumptions stated until repository evidence or an owner confirms them.',
  'Represent missing material information as an open question.',
  'Process success is not semantic approval.',
]);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

function normalizedInputs(repositoryEvidence, ownerDecisions) {
  if (!Array.isArray(repositoryEvidence) || !Array.isArray(ownerDecisions)) throw usageError('Requirement compilation evidence and owner decisions must be arrays.');
  return {
    repositoryEvidence: [...repositoryEvidence].sort((left, right) => canonical(left).localeCompare(canonical(right))),
    ownerDecisions: [...ownerDecisions].sort((left, right) => canonical(left).localeCompare(canonical(right))),
  };
}

export function prepareRequirementCompilation({ requestText, repositoryEvidence = [], ownerDecisions = [] }) {
  if (typeof requestText !== 'string' || requestText.trim().length === 0 || Buffer.byteLength(requestText) > 128 * 1024) throw usageError('Requirement requestText must be a non-empty bounded string.');
  const normalized = normalizedInputs(repositoryEvidence, ownerDecisions);
  const semanticInput = { requestText: requestText.trim(), ...normalized };
  const inputDigest = sha256(canonical(semanticInput));
  const prompt = [
    'Compile the request into AICG Requirement IR v2.',
    ...BOUNDARIES.map((entry) => `- ${entry}`),
    `Schema path: ${SCHEMA_PATH}`,
    `Input digest: ${inputDigest}`,
    'Request:', semanticInput.requestText,
    'Repository evidence:', JSON.stringify(normalized.repositoryEvidence),
    'Owner decisions:', JSON.stringify(normalized.ownerDecisions),
  ].join('\n');
  return Object.freeze({ inputDigest, prompt, schemaPath: SCHEMA_PATH, boundaries: BOUNDARIES });
}

function contradictoryTransitions(candidate) {
  const byTrigger = new Map();
  for (const transition of candidate?.stateTransitions ?? []) {
    const key = `${transition?.from}\0${transition?.event}\0${transition?.guard ?? ''}`;
    if (byTrigger.has(key) && byTrigger.get(key) !== transition?.to) return true;
    byTrigger.set(key, transition?.to);
  }
  return false;
}

export function acceptRequirementCandidate({ compilation, candidate }) {
  if (!compilation || typeof compilation.inputDigest !== 'string') throw usageError('Requirement compilation binding is required.');
  const materialQuestions = Array.isArray(candidate?.openQuestions)
    ? candidate.openQuestions.filter((entry) => entry?.material === true && entry?.status === 'open').map((entry) => ({ id: entry.id, question: entry.question }))
    : [];
  const validationCandidate = materialQuestions.length
    ? { ...candidate, openQuestions: candidate.openQuestions.map((entry) => entry?.material === true && entry?.status === 'open' ? { ...entry, status: 'deferred' } : entry) }
    : candidate;
  let requirement;
  try { requirement = validateRequirementIr(validationCandidate); }
  catch (error) {
    return Object.freeze({ status: 'rejected', requirement: null, requirementDigest: null, materialQuestions: Object.freeze(materialQuestions), findings: Object.freeze([error.message]) });
  }
  if (contradictoryTransitions(requirement)) return Object.freeze({ status: 'rejected', requirement: null, requirementDigest: null, materialQuestions: Object.freeze([]), findings: Object.freeze(['Contradictory state transitions share one source, event, and guard but lead to different targets.']) });
  if (materialQuestions.length) return Object.freeze({ status: 'questions-required', requirement: null, requirementDigest: null, materialQuestions: Object.freeze(materialQuestions), findings: Object.freeze(['Material questions require owner decisions before approval.']) });
  return Object.freeze({ status: 'accepted', requirement, requirementDigest: canonicalContractDigest('requirement', requirement), materialQuestions: Object.freeze([]), findings: Object.freeze([]) });
}

export async function compileRequirement({ requestText, repositoryEvidence = [], ownerDecisions = [], adapter }) {
  if (!adapter || typeof adapter.generateStructured !== 'function') throw usageError('Requirement compilation requires a structured Agent adapter.');
  const compilation = prepareRequirementCompilation({ requestText, repositoryEvidence, ownerDecisions });
  const generated = await adapter.generateStructured({ prompt: compilation.prompt, schemaPath: compilation.schemaPath, maxInputBytes: 256 * 1024, maxOutputBytes: 2 * 1024 * 1024, timeoutMs: 120_000 });
  const accepted = acceptRequirementCandidate({ compilation, candidate: generated.candidate });
  return Object.freeze({ ...accepted, compilation, processEvidence: generated.processEvidence ?? null });
}

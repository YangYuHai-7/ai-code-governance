import { usageError } from '../../kernel/index.mjs';

export const QUALIFIED_USER_ACCEPTANCE_VERSION = 1;
export const PARTICIPANT_CLASSES = Object.freeze(['qualified-human', 'implementer', 'ai']);
export const OBSERVER_CLASSES = Object.freeze(['independent-human', 'implementer', 'ai']);
const DIGEST = /^[a-f0-9]{64}$/;
const ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function fail(path, message) { throw usageError(`${path}: ${message}`); }
function object(value, path) { if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object'); return value; }
function string(value, path, { max = 512, nullable = false } = {}) {
  if (nullable && value === undefined) return;
  if (typeof value !== 'string' || value.length < 1 || value.length > max) fail(path, 'expected a non-empty string');
}

// Identity is recorded as a synthetic label only: no personal data enters the receipt.
export function evaluateQualifiedUserAcceptance(value, options = {}) {
  const gaps = [];
  const add = (code, detail) => gaps.push({ code, detail });
  const record = value ?? {};
  const participant = record.participant ?? {};
  const observer = record.observer ?? {};
  const implementer = record.implementerIdentity ?? null;

  if (participant.class === 'ai') add('ai-identity', 'the participant is an AI agent, which is not qualified-human evidence');
  else if (participant.class === 'implementer' || (implementer !== null && participant.identity === implementer)) add('implementer-self-acceptance', 'the implementer cannot accept their own work');
  else if (participant.class !== 'qualified-human') add('participant-not-qualified-human', 'the participant class must be qualified-human');
  if (participant.stackFamiliarity !== 'unfamiliar') add('participant-not-unfamiliar', 'the participant must declare unfamiliarity with the selected stack');
  if (observer.class === 'ai') add('ai-observer', 'AI review is not independent qualified-human observation');
  else if (observer.class === 'implementer' || (implementer !== null && observer.identity === implementer)) add('implementer-observer', 'the observer is the implementer');
  else if (observer.class !== 'independent-human') add('observer-not-independent', 'the observer must be an independent human');

  const runDigest = record.digests?.run;
  if (!DIGEST.test(runDigest ?? '')) add('unbound-run-digest', 'the acceptance is not bound to a concrete run digest');
  else if (typeof options.expectedRunDigest === 'string' && runDigest !== options.expectedRunDigest) add('stale-run-digest', 'the run digest does not match the evaluated run');
  if ((record.ownerQuestions ?? []).some((question) => question?.material === true && question.status !== 'resolved')) add('unresolved-owner-question', 'a material owner question is unresolved');
  if (record.localRun?.status !== 'passed') add('local-run-failed', 'the participant did not run the result locally');
  if ((record.recoveryActions ?? []).some((action) => action?.hidden === true)) add('hidden-recovery', 'a recovery intervention was hidden from the record');
  if (!Array.isArray(record.residualGaps)) add('missing-residual-gaps', 'residual gaps must be declared, even when empty');
  if (record.outcome !== 'accepted') add('outcome-not-accepted', 'the recorded outcome is not acceptance');
  return Object.freeze({ status: gaps.length === 0 ? 'accepted' : 'rejected', gaps: Object.freeze(gaps.map((gap) => Object.freeze(gap))) });
}

export function validateQualifiedUserAcceptance(value) {
  const allowed = ['schemaVersion', 'id', 'participant', 'observer', 'implementerIdentity', 'digests', 'decisionsRequested', 'ownerQuestions', 'elapsedMinutes', 'recoveryActions', 'localRun', 'residualGaps', 'outcome', 'recordedAt', 'evaluation'];
  object(value, 'qualifiedUserAcceptance');
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(`qualifiedUserAcceptance.${key}`, 'unknown field');
  for (const key of allowed) if (!Object.hasOwn(value, key)) fail(`qualifiedUserAcceptance.${key}`, 'required field is missing');
  if (value.schemaVersion !== QUALIFIED_USER_ACCEPTANCE_VERSION) fail('qualifiedUserAcceptance.schemaVersion', `unsupported version ${value.schemaVersion}`);
  if (!ID.test(value.id)) fail('qualifiedUserAcceptance.id', 'invalid id');
  object(value.participant, 'qualifiedUserAcceptance.participant');
  if (!PARTICIPANT_CLASSES.includes(value.participant.class)) fail('qualifiedUserAcceptance.participant.class', 'unsupported participant class');
  if (value.participant.stackFamiliarity !== undefined && !['unfamiliar', 'familiar'].includes(value.participant.stackFamiliarity)) fail('qualifiedUserAcceptance.participant.stackFamiliarity', 'unsupported familiarity');
  string(value.participant.identity, 'qualifiedUserAcceptance.participant.identity', { max: 64 });
  object(value.observer, 'qualifiedUserAcceptance.observer');
  if (!OBSERVER_CLASSES.includes(value.observer.class)) fail('qualifiedUserAcceptance.observer.class', 'unsupported observer class');
  string(value.observer.identity, 'qualifiedUserAcceptance.observer.identity', { max: 64 });
  string(value.implementerIdentity, 'qualifiedUserAcceptance.implementerIdentity', { max: 64 });
  object(value.digests, 'qualifiedUserAcceptance.digests');
  for (const key of ['requirement', 'pack', 'run', 'repository']) if (!DIGEST.test(value.digests[key] ?? '')) fail(`qualifiedUserAcceptance.digests.${key}`, 'expected a canonical digest');
  for (const key of ['decisionsRequested', 'residualGaps']) {
    if (!Array.isArray(value[key])) fail(`qualifiedUserAcceptance.${key}`, 'expected an array');
    value[key].forEach((entry, index) => string(entry, `qualifiedUserAcceptance.${key}[${index}]`, { max: 4096 }));
  }
  if (!Array.isArray(value.ownerQuestions)) fail('qualifiedUserAcceptance.ownerQuestions', 'expected an array');
  value.ownerQuestions.forEach((question, index) => {
    const path = `qualifiedUserAcceptance.ownerQuestions[${index}]`;
    object(question, path);
    string(question.id, `${path}.id`, { max: 128 });
    if (typeof question.material !== 'boolean') fail(`${path}.material`, 'expected a boolean');
    if (!['resolved', 'open'].includes(question.status)) fail(`${path}.status`, 'unsupported status');
  });
  if (!Number.isSafeInteger(value.elapsedMinutes) || value.elapsedMinutes < 0) fail('qualifiedUserAcceptance.elapsedMinutes', 'expected a non-negative integer');
  if (!Array.isArray(value.recoveryActions)) fail('qualifiedUserAcceptance.recoveryActions', 'expected an array');
  value.recoveryActions.forEach((action, index) => {
    const path = `qualifiedUserAcceptance.recoveryActions[${index}]`;
    object(action, path);
    string(action.id, `${path}.id`, { max: 128 });
    string(action.intervention, `${path}.intervention`, { max: 512 });
    if (typeof action.hidden !== 'boolean') fail(`${path}.hidden`, 'expected a boolean');
  });
  object(value.localRun, 'qualifiedUserAcceptance.localRun');
  if (!['passed', 'failed'].includes(value.localRun.status)) fail('qualifiedUserAcceptance.localRun.status', 'unsupported status');
  string(value.localRun.entrypoint, 'qualifiedUserAcceptance.localRun.entrypoint', { max: 512 });
  if (!['accepted', 'rejected'].includes(value.outcome)) fail('qualifiedUserAcceptance.outcome', 'unsupported outcome');
  string(value.recordedAt, 'qualifiedUserAcceptance.recordedAt', { max: 64 });
  if (Number.isNaN(Date.parse(value.recordedAt))) fail('qualifiedUserAcceptance.recordedAt', 'expected an ISO date-time');
  object(value.evaluation, 'qualifiedUserAcceptance.evaluation');
  if (!['accepted', 'rejected'].includes(value.evaluation.status)) fail('qualifiedUserAcceptance.evaluation.status', 'unsupported status');
  if (!Array.isArray(value.evaluation.gaps)) fail('qualifiedUserAcceptance.evaluation.gaps', 'expected an array');
  value.evaluation.gaps.forEach((gap, index) => {
    string(gap?.code, `qualifiedUserAcceptance.evaluation.gaps[${index}].code`, { max: 128 });
    string(gap?.detail, `qualifiedUserAcceptance.evaluation.gaps[${index}].detail`, { max: 4096 });
  });
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

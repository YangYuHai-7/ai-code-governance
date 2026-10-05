import fs from 'node:fs';
import path from 'node:path';
import { usageError } from '../../kernel/index.mjs';
import { canonicalValueDigest, isSafeRelative, matchSimpleGlob, normalizeRelative, sha256 } from '../../shared/index.mjs';
import { validateEvidenceIr } from './contracts.mjs';

const HASH = /^[a-f0-9]{64}$/;
const TRUSTED = new Set(['structurally-trusted', 'execution-verified']);

function shellComposed(argv) {
  return argv.some((argument) => /^(?:&&|\|\||[;|<>])$/.test(argument) || /[`\r\n]|\$\(/.test(argument));
}

function relevant(command, purposes, paths) {
  if (!command.purpose?.some((purpose) => purposes.includes(purpose))) return false;
  if (!paths.length || !command.scopeGlobs?.length) return true;
  return paths.some((changed) => command.scopeGlobs.some((glob) => matchSimpleGlob(changed, glob)));
}

function commandGap(command, production) {
  const reasons = [];
  if (!Array.isArray(command.argv) || command.argv.length === 0 || command.argv.some((entry) => typeof entry !== 'string' || !entry)) reasons.push('invalid argv');
  if (shellComposed(command.argv ?? [])) reasons.push('shell composition');
  if (!TRUSTED.has(command.trust?.level)) reasons.push(`trust is ${command.trust?.level ?? 'missing'}`);
  if (!HASH.test(command.source?.sha256 ?? '')) reasons.push('source digest is missing');
  if ((command.sideEffects ?? []).length) reasons.push(`side effects: ${(command.sideEffects ?? []).join(', ')}`);
  return production || reasons.length ? reasons : [];
}

export function selectVerificationCommands({ discovered, requiredPurposes, changedPaths = [], production = false }) {
  if (!Array.isArray(discovered) || !Array.isArray(requiredPurposes) || !Array.isArray(changedPaths)) throw usageError('Verification selection inputs must be arrays.');
  const candidates = discovered.filter((command) => relevant(command, requiredPurposes, changedPaths)).sort((left, right) => left.id.localeCompare(right.id));
  const gaps = candidates.flatMap((command) => commandGap(command, production).map((reason) => Object.freeze({ commandId: command.id, reason })));
  const rejected = new Set(gaps.map((gap) => gap.commandId));
  const selected = production ? candidates.filter((command) => !rejected.has(command.id)) : candidates;
  return Object.freeze({ selected: Object.freeze(selected), gaps: Object.freeze(gaps), status: production && (selected.length === 0 || gaps.length) ? 'blocked' : 'ready' });
}

export function createVerificationPolicy({ production = false, timeoutMs, maxOutputBytes, allowedSideEffects = [], sessionId = 'session.verification', semanticDigest = '0'.repeat(64), repositoryDigest = '0'.repeat(64) }) {
  if (typeof production !== 'boolean' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 24 * 60 * 60 * 1000) throw usageError('Verification policy timeoutMs is invalid.');
  if (!Number.isSafeInteger(maxOutputBytes) || maxOutputBytes < 1 || maxOutputBytes > 64 * 1024 * 1024) throw usageError('Verification policy maxOutputBytes is invalid.');
  if (!Array.isArray(allowedSideEffects) || allowedSideEffects.some((entry) => typeof entry !== 'string')) throw usageError('Verification policy allowedSideEffects is invalid.');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/.test(sessionId) || !HASH.test(semanticDigest) || !HASH.test(repositoryDigest)) throw usageError('Verification policy evidence bindings are invalid.');
  return Object.freeze({ production, timeoutMs, maxOutputBytes, allowedSideEffects: Object.freeze([...new Set(allowedSideEffects)].sort()), sessionId, semanticDigest, repositoryDigest });
}

function containedCwd(root, cwd) {
  if (cwd !== '.' && (typeof cwd !== 'string' || !isSafeRelative(normalizeRelative(cwd)))) throw usageError('Verification command cwd must be repository-contained.');
  const realRoot = fs.realpathSync(root);
  const absolute = path.resolve(realRoot, cwd);
  if (absolute !== realRoot && !absolute.startsWith(`${realRoot}${path.sep}`)) throw usageError('Verification command cwd escapes the repository.');
  return absolute;
}

function preflight(root, command, policy) {
  containedCwd(root, command.cwd);
  if (!Array.isArray(command.argv) || command.argv.length === 0 || shellComposed(command.argv)) throw usageError('Verification command contains shell composition or invalid argv.');
  if (policy.production && !TRUSTED.has(command.trust?.level)) throw usageError(`Verification command trust ${command.trust?.level ?? 'missing'} is insufficient for production.`);
  const disallowed = (command.sideEffects ?? []).filter((effect) => !policy.allowedSideEffects.includes(effect));
  if (disallowed.length) throw usageError(`Verification command side effect is not allowed: ${disallowed.join(', ')}.`);
  if (typeof command.source?.path !== 'string' || !isSafeRelative(normalizeRelative(command.source.path))) throw usageError('Verification command source path is unsafe.');
  const source = path.join(fs.realpathSync(root), normalizeRelative(command.source.path));
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) throw usageError('Verification command source is unavailable.');
  const actual = sha256(fs.readFileSync(source));
  if (command.source.sha256 !== actual) throw usageError('Verification command source digest is stale.');
}

export function runVerificationCommand(root, command, policy, executor) {
  if (typeof executor !== 'function') throw usageError('Verification command executor is required.');
  preflight(root, command, policy);
  const result = executor(root, command, policy);
  if (!result || typeof result !== 'object') throw usageError('Verification executor returned no result.');
  const stdout = String(result.stdout ?? ''), stderr = String(result.stderr ?? '');
  const outputBytes = Buffer.byteLength(stdout) + Buffer.byteLength(stderr);
  const overflow = result.outputOverflow === true || outputBytes > policy.maxOutputBytes;
  const status = result.missingExecutable ? 'unsupported' : result.timedOut || overflow ? 'blocked' : result.exitCode === 0 ? 'passed' : 'failed';
  const trusted = TRUSTED.has(command.trust?.level);
  return validateEvidenceIr({
    schemaVersion: 1,
    id: `evidence.${canonicalValueDigest({ sessionId: policy.sessionId, commandId: command.id, result: { status, exitCode: result.exitCode ?? null, stdout: sha256(stdout), stderr: sha256(stderr) } }).slice(0, 32)}`,
    sessionId: policy.sessionId,
    source: 'automated-test',
    verificationLevel: status === 'passed' && trusted ? 'verified' : trusted ? 'enforced' : 'reachable',
    semanticDigest: policy.semanticDigest,
    repositoryDigest: policy.repositoryDigest,
    commandDigest: canonicalValueDigest({ id: command.id, cwd: command.cwd, argv: command.argv, source: command.source }),
    resultDigest: canonicalValueDigest({ status, exitCode: result.exitCode ?? null, stdout: sha256(stdout), stderr: sha256(stderr), timedOut: result.timedOut === true, overflow }),
    artifactDigests: [],
    status,
    recordedAt: new Date().toISOString(),
  });
}

export function runVerificationPlan(root, commands, policy, executor) {
  if (!Array.isArray(commands)) throw usageError('Verification plan commands must be an array.');
  const results = [];
  for (const command of [...commands].sort((left, right) => left.id.localeCompare(right.id))) {
    const evidence = runVerificationCommand(root, command, policy, executor);
    results.push(evidence);
    if (policy.production && evidence.status !== 'passed') break;
  }
  const status = results.length === commands.length && results.every((entry) => entry.status === 'passed') ? 'passed' : results.some((entry) => entry.status === 'failed') ? 'failed' : 'blocked';
  return Object.freeze({ status, results: Object.freeze(results) });
}

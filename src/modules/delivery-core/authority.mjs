import { usageError } from '../../kernel/index.mjs';
import { isSafeRelative, normalizeRelative } from '../../shared/index.mjs';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}

function positive(value, name, maximum) {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw usageError(`Delivery authority ${name} must be an integer from 1 to ${maximum}.`);
  return value;
}

function authorityPath(value, index) {
  if (typeof value !== 'string') throw usageError(`Delivery authority allowedPaths[${index}] is invalid.`);
  const directory = value.endsWith('/');
  const normalized = normalizeRelative(directory ? value.slice(0, -1) : value);
  if (!isSafeRelative(normalized) || normalized.split('/').some((part) => part.toLowerCase() === '.git')) throw usageError(`Delivery authority allowedPaths[${index}] is unsafe.`);
  return directory ? `${normalized}/` : normalized;
}

function command(value, index) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw usageError(`Delivery authority allowedCommands[${index}] must be an object.`);
  const keys = Object.keys(value);
  if (keys.some((key) => !['argv', 'cwd', 'sideEffects'].includes(key))) throw usageError(`Delivery authority allowedCommands[${index}] has an unknown field.`);
  if (!Array.isArray(value.argv) || value.argv.length === 0 || value.argv.some((entry) => typeof entry !== 'string' || entry.length === 0 || /[\0\r\n]/.test(entry)) || /\s/.test(value.argv[0])) throw usageError(`Delivery authority allowedCommands[${index}] must use a shell-free argv record.`);
  const cwd = value.cwd ?? '.';
  if (cwd !== '.' && (typeof cwd !== 'string' || !isSafeRelative(normalizeRelative(cwd)))) throw usageError(`Delivery authority allowedCommands[${index}].cwd is unsafe.`);
  if (!Array.isArray(value.sideEffects ?? []) || (value.sideEffects ?? []).some((entry) => typeof entry !== 'string' || entry.length === 0)) throw usageError(`Delivery authority allowedCommands[${index}].sideEffects is invalid.`);
  return { argv: [...value.argv], cwd, sideEffects: [...(value.sideEffects ?? [])] };
}

export function normalizeDeliveryAuthority({ allowedPaths, allowedCommands, allowNetwork = false, allowExternalEffects = false, maxChangedFiles, maxChangedBytes }) {
  if (!Array.isArray(allowedPaths) || !Array.isArray(allowedCommands)) throw usageError('Delivery authority allowedPaths and allowedCommands must be arrays.');
  if (typeof allowNetwork !== 'boolean' || typeof allowExternalEffects !== 'boolean') throw usageError('Delivery authority effect flags must be boolean.');
  const paths = allowedPaths.map(authorityPath);
  if (new Set(paths).size !== paths.length) throw usageError('Delivery authority contains duplicate allowed paths.');
  const commands = allowedCommands.map(command);
  return deepFreeze({ allowedPaths: paths, allowedCommands: commands, allowNetwork, allowExternalEffects, maxChangedFiles: positive(maxChangedFiles, 'maxChangedFiles', 100000), maxChangedBytes: positive(maxChangedBytes, 'maxChangedBytes', 1024 * 1024 * 1024) });
}

function pathAllowed(authority, value) {
  if (typeof value !== 'string') return false;
  const normalized = normalizeRelative(value);
  if (!isSafeRelative(normalized)) return false;
  return authority.allowedPaths.some((allowed) => allowed.endsWith('/') ? normalized.startsWith(allowed) : normalized === allowed);
}

function commandAllowed(authority, action) {
  if (!Array.isArray(action.argv) || typeof action.cwd !== 'string' || !Array.isArray(action.sideEffects ?? [])) return false;
  return authority.allowedCommands.some((allowed) => JSON.stringify(allowed.argv) === JSON.stringify(action.argv) && allowed.cwd === action.cwd && JSON.stringify(allowed.sideEffects) === JSON.stringify(action.sideEffects ?? []));
}

export function authorizeDeliveryAction(authority, action) {
  const reasons = [];
  if (!authority || typeof authority !== 'object' || !action || typeof action !== 'object') reasons.push('invalid authority or action');
  else if (action.type === 'write' || action.type === 'delete') {
    if (!pathAllowed(authority, action.path)) reasons.push(`${action.path ?? 'unknown'} is outside approved paths`);
  } else if (action.type === 'command') {
    if (!commandAllowed(authority, action)) reasons.push('command is not an approved shell-free argv record');
    if ((action.sideEffects ?? []).length && !authority.allowExternalEffects) reasons.push('external effects are not allowed');
  } else if (action.type === 'network') {
    if (!authority.allowNetwork) reasons.push('network access is not allowed');
  } else if (action.type === 'external-effect') {
    if (!authority.allowExternalEffects) reasons.push('external effects are not allowed');
  } else reasons.push(`unsupported action type ${action.type ?? 'unknown'}`);
  return Object.freeze({ allowed: reasons.length === 0, reasons: Object.freeze(reasons) });
}

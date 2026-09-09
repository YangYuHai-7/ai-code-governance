import path from 'node:path';
import { isSafeRelative, readText, sha256, stableJson } from '../../utils.mjs';
import { isArchitectureNonSourcePath } from '../architecture/index.mjs';
import { sourceTokens } from './source-tokenizer.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']);

export function reviewDueDate() {
  const due = new Date();
  due.setUTCDate(due.getUTCDate() + 14);
  return due.toISOString().slice(0, 10);
}

export function isSafeCapabilityPath(value) {
  return typeof value === 'string' && isSafeRelative(value) && !value.includes('`');
}

function tokenIs(tokens, index, value, kind = null) {
  const token = tokens[index];
  return token?.value === value && (!kind || token.kind === kind);
}

function axiosBindings(tokens) {
  const bindings = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (tokenIs(tokens, index, 'import', 'identifier') && tokens[index + 1]?.kind === 'identifier') {
      const binding = tokens[index + 1].value;
      for (let cursor = index + 2; cursor < Math.min(tokens.length - 1, index + 20); cursor += 1) {
        if (tokenIs(tokens, cursor, ';')) break;
        if (tokenIs(tokens, cursor, 'from', 'identifier') && tokenIs(tokens, cursor + 1, 'axios', 'string')) {
          bindings.add(binding);
          break;
        }
      }
    }
    if (['const', 'let', 'var'].includes(tokens[index]?.value) && tokens[index + 1]?.kind === 'identifier'
      && tokenIs(tokens, index + 2, '=') && tokenIs(tokens, index + 3, 'require', 'identifier')
      && tokenIs(tokens, index + 4, '(') && tokenIs(tokens, index + 5, 'axios', 'string')) {
      bindings.add(tokens[index + 1].value);
    }
  }
  return bindings;
}

function isAxiosCreateCall(tokens, index, bindings) {
  return bindings.has(tokens[index]?.value)
    && tokenIs(tokens, index + 1, '.')
    && tokenIs(tokens, index + 2, 'create', 'identifier')
    && tokenIs(tokens, index + 3, '(');
}

function declaredAxiosClients(tokens, bindings) {
  const clients = new Set();
  for (let index = 0; index < tokens.length - 2; index += 1) {
    if (!['const', 'let', 'var'].includes(tokens[index]?.value) || tokens[index + 1]?.kind !== 'identifier') continue;
    const name = tokens[index + 1].value;
    for (let cursor = index + 2; cursor < Math.min(tokens.length, index + 24); cursor += 1) {
      if (tokenIs(tokens, cursor, ';') || tokenIs(tokens, cursor, ',')) break;
      if (tokenIs(tokens, cursor, '=') && isAxiosCreateCall(tokens, cursor + 1, bindings)) {
        clients.add(name);
        break;
      }
    }
  }
  return clients;
}

function exportsAxiosClient(content) {
  const tokens = sourceTokens(content);
  const bindings = axiosBindings(tokens);
  if (bindings.size === 0) return false;
  const clients = declaredAxiosClients(tokens, bindings);
  for (let index = 0; index < tokens.length; index += 1) {
    if (!tokenIs(tokens, index, 'export', 'identifier')) continue;
    if (tokenIs(tokens, index + 1, 'default', 'identifier') && (isAxiosCreateCall(tokens, index + 2, bindings) || clients.has(tokens[index + 2]?.value))) return true;
    if (['const', 'let', 'var'].includes(tokens[index + 1]?.value) && clients.has(tokens[index + 2]?.value)) return true;
    if (tokenIs(tokens, index + 1, '{')) {
      for (let cursor = index + 2; cursor < tokens.length && !tokenIs(tokens, cursor, '}'); cursor += 1) {
        if (clients.has(tokens[cursor]?.value)) return true;
      }
    }
  }
  return false;
}

function isAuthorizationBoundaryPath(relative) {
  if (/(^|\/)(?:ui|components?|views?|pages?)\//i.test(relative)) return false;
  return /(^|\/)(?:auth(?:orization)?|security|access-control|guards?|policies|abilities)(?:\/|$)/i.test(relative)
    || /(?:permission|authorization|authorize|policy|guard|ability)(?:[._-]|$)/i.test(path.basename(relative));
}

function hasAuthorizationSyntax(content) {
  const tokens = sourceTokens(content);
  const hasGuardSyntax = tokens.some((token, index) => (
    ['CanActivate', 'canActivate', 'UseGuards', 'SetMetadata'].includes(token.value)
    || (token.value === '@' && ['Roles', 'Permissions', 'UseGuards', 'SetMetadata'].includes(tokens[index + 1]?.value))
  ));
  const hasExplicitBoundary = tokens.some((token, index) => /^(?:Permission|Authorization|Authorize|Policy|Ability)\w*$/.test(token.value)
    && ['class', 'function', 'const', 'let', 'var'].includes(tokens[index - 1]?.value));
  const hasDecisionMethod = tokens.some((token) => ['can', 'authorize', 'check', 'enforce', 'permit', 'deny'].includes(token.value));
  return hasGuardSyntax || (hasExplicitBoundary && hasDecisionMethod);
}

export function sourceFiles(scan, { includeTests = false } = {}) {
  return scan.files.filter((file) => {
    if (file.type !== 'file' || /^(?:docs\/ai\/|\.ai-governance\/|\.agents\/|\.claude\/|\.cursor\/)/.test(file.relative)) return false;
    if (isArchitectureNonSourcePath(file.relative)) return false;
    if (!isSafeCapabilityPath(file.relative)) return false;
    if (!SOURCE_EXTENSIONS.has(path.extname(file.relative))) return false;
    if (!includeTests && /(^|\/)(?:test|tests|__tests__)\/|\.(?:test|spec)\.[^/]+$/.test(file.relative)) return false;
    return true;
  });
}

export function productFingerprint(scan) {
  const files = sourceFiles(scan, { includeTests: true })
    .map((file) => ({ path: file.relative, sha256: sha256(readText(file.absolute)) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  return sha256(stableJson(files));
}

export function commandEvidence(scan) {
  return scan.commands
    .filter((command) => /(?:test|typecheck|lint|build)/i.test(command.name))
    .map((command) => command.command)
    .slice(0, 4);
}

export function implementationFingerprint(scan, paths) {
  return sha256(stableJson(paths
    .map((relative) => ({ path: relative, sha256: sha256(readText(path.join(scan.root, relative))) }))
    .sort((left, right) => left.path.localeCompare(right.path))));
}

function candidate({ id, kind, title, skillName, owner, implementationPaths, scan, detection }) {
  const paths = [...new Set(implementationPaths)].sort((left, right) => left.localeCompare(right));
  return {
    id,
    kind,
    title,
    status: 'candidate',
    owner,
    implementationPaths: paths,
    publicEntrypoints: [],
    consumerPaths: [],
    verification: commandEvidence(scan),
    capabilityVersion: 1,
    implementationFingerprint: implementationFingerprint(scan, paths),
    skill: `docs/ai/skills/project/${skillName}/SKILL.md`,
    detection,
    review: {
      status: 'required',
      dueDate: reviewDueDate(),
    },
    gaps: [
      'Confirm the owning module and public entrypoint.',
      'Run and record the relevant project verification before promotion to adopted.',
      'Confirm governed consumers before enforcing reuse or blocking bypasses.',
    ],
  };
}

export function detectCapabilityCandidates(scan) {
  const sources = sourceFiles(scan).map((file) => ({ ...file, content: readText(file.absolute) }));
  const candidates = [];
  const axiosWrappers = scan.packageDependencies?.axios
    ? sources.filter((file) => exportsAxiosClient(file.content)).map((file) => file.relative)
    : [];
  if (axiosWrappers.length > 0) {
    candidates.push(candidate({
      id: 'project-http-client',
      kind: 'platform-adapter',
      title: 'Use the project HTTP client',
      skillName: 'use-project-http-client',
      owner: 'platform',
      implementationPaths: axiosWrappers,
      scan,
      detection: 'exported-axios-create-wrapper-v1',
    }));
  }

  const authorizationPaths = sources
    .filter((file) => !['.tsx', '.jsx'].includes(path.extname(file.relative)) && isAuthorizationBoundaryPath(file.relative) && hasAuthorizationSyntax(file.content))
    .map((file) => file.relative);
  if (authorizationPaths.length > 0) {
    candidates.push(candidate({
      id: 'project-authorization',
      kind: 'security-policy',
      title: 'Authorize project operations',
      skillName: 'authorize-project-operation',
      owner: 'authorization',
      implementationPaths: authorizationPaths,
      scan,
      detection: 'exported-authorization-boundary-v1',
    }));
  }
  return candidates;
}

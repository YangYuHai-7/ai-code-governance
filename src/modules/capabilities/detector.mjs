import path from 'node:path';
import { LOCAL_OUTPUT_PREFIXES } from '../../constants.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative, sha256, stableJson } from '../../shared/index.mjs';
import { clientGovernanceMatchers } from '../../catalogs/index.mjs';
import { isArchitectureNonSourcePath } from '../architecture/index.mjs';
import { implementationBodyAfter, publicDeclarations } from './public-declarations.mjs';

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

function axiosBindings(tokens, depths) {
  const bindings = new Set();
  for (let index = 0; index < tokens.length; index += 1) {
    if (depths[index] !== 0) continue;
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

function exportedAxiosClients(model) {
  const bindings = axiosBindings(model.tokens, model.depths);
  return [...model.declarations, ...model.defaultExpressions].filter((declaration) => {
    const start = declaration.initializer;
    return start !== null && isAxiosCreateCall(model.tokens, start, bindings)
      && model.closes?.get(start + 3) === declaration.endIndex - 1;
  });
}

function isAuthorizationBoundaryPath(relative) {
  if (/(^|\/)(?:ui|components?|views?|pages?)\//i.test(relative)) return false;
  return /(^|\/)(?:auth(?:orization)?|security|access-control|guards?|policies|abilities)(?:\/|$)/i.test(relative)
    || /(?:permission|authorization|authorize|policy|guard|ability)(?:[._-]|$)/i.test(path.basename(relative));
}

function completeReturnedObject(model, start, end) {
  const unparenthesized = (first, last) => {
    while (tokenIs(model.tokens, first, '(') && model.closes.get(first) === last - 1) { first += 1; last -= 1; }
    return [first, last];
  };
  [start, end] = unparenthesized(start, end);
  if (['Promise', '.', 'resolve', '('].every((value, offset) => tokenIs(model.tokens, start + offset, value))) {
    if (model.closes.get(start + 3) !== end - 1) return null;
    [start, end] = unparenthesized(start + 4, end - 1);
  }
  // Exact extent rejects chaining, extra arguments, comma/conditional/binary
  // expressions, and wrappers whose resulting value cannot be proven here.
  return tokenIs(model.tokens, start, '{') && model.closes.get(start) === end - 1 ? start : null;
}

function exportedAuthorizationBoundaries(model) {
  return model.declarations.filter((declaration) => {
    if (declaration.bodyStartIndex === null) return false;
    const own = model.tokens.slice(declaration.bodyStartIndex + 1, declaration.endIndex - 1)
      .map((token, offset) => ({ ...token, index: declaration.bodyStartIndex + 1 + offset }));
    const methodScopes = declaration.kind === 'class' ? [declaration.bodyStartIndex] : own.flatMap((token) => {
      if (token.value !== 'return' || model.depths[token.index] !== 1 || model.tokens[token.index + 1]?.lineBreakBefore) return [];
      let end = token.index + 1;
      while (end < declaration.endIndex - 1 && !(model.depths[end] === 1 && tokenIs(model.tokens, end, ';'))) end += 1;
      const object = completeReturnedObject(model, token.index + 1, end);
      return object === null ? [] : [object];
    });
    const implementedMethod = (token) => {
      if (token.kind !== 'identifier' || !tokenIs(model.tokens, token.index + 1, '(')) return false;
      if (!methodScopes.some((scope) => token.index > scope && token.index < model.closes.get(scope)
        && model.depths[token.index] === model.depths[scope] + 1)) return false;
      const parametersEnd = model.closes.get(token.index + 1);
      if (parametersEnd === undefined) return false;
      const body = implementationBodyAfter(model.tokens, model.closes, parametersEnd + 1);
      return body >= 0 && model.closes.get(body) < declaration.endIndex - 1;
    };
    const hasDecision = own.some((token) => ['can', 'authorize', 'check', 'enforce', 'permit', 'deny'].includes(token.value) && implementedMethod(token));
    const hasGuard = declaration.kind === 'class' && own.some((token) => token.value === 'canActivate' && implementedMethod(token));
    return hasGuard || (/^(?:Permission|Authorization|Authorize|Policy|Ability)\w*$/.test(declaration.symbol) && hasDecision);
  });
}

function declarationEvidence(file, declaration) {
  return {
    path: file.relative, symbol: declaration.symbol, exportedAs: declaration.exportedAs,
    declarationRange: declaration.declarationRange, exportRange: declaration.exportRange,
  };
}

const CLIENT_GOVERNANCE = clientGovernanceMatchers();

function isGovernanceSourcePath(relative) {
  return relative.startsWith('docs/ai/') || relative.startsWith('.ai-governance/') || CLIENT_GOVERNANCE.isPath(relative);
}

export function sourceFiles(scan, { includeTests = false } = {}) {
  return scan.files.filter((file) => {
    if (file.type !== 'file' || file.contentScannable === false || isGovernanceSourcePath(file.relative)) return false;
    if (LOCAL_OUTPUT_PREFIXES.some((prefix) => file.relative.startsWith(prefix))) return false;
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

function candidate({ id, kind, title, skillName, owner, implementationPaths, discoveryEvidence, scan, detection }) {
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
    discoveryEvidence,
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
  const sources = sourceFiles(scan)
    .filter((file) => scan.packageDependencies?.axios || isAuthorizationBoundaryPath(file.relative))
    .sort((left, right) => left.relative.localeCompare(right.relative))
    .map((file) => ({ ...file, model: publicDeclarations(readText(file.absolute)) }));
  const candidates = [];
  const axiosEvidence = scan.packageDependencies?.axios
    ? sources.flatMap((file) => exportedAxiosClients(file.model).map((declaration) => declarationEvidence(file, declaration)))
    : [];
  if (axiosEvidence.length > 0) {
    candidates.push(candidate({
      id: 'project-http-client',
      kind: 'platform-adapter',
      title: 'Use the project HTTP client',
      skillName: 'use-project-http-client',
      owner: 'platform',
      implementationPaths: axiosEvidence.map((entry) => entry.path),
      discoveryEvidence: axiosEvidence,
      scan,
      detection: 'exported-axios-create-wrapper-v1',
    }));
  }

  const authorizationEvidence = sources
    .filter((file) => !['.tsx', '.jsx'].includes(path.extname(file.relative)) && isAuthorizationBoundaryPath(file.relative))
    .flatMap((file) => exportedAuthorizationBoundaries(file.model).map((declaration) => declarationEvidence(file, declaration)));
  if (authorizationEvidence.length > 0) {
    candidates.push(candidate({
      id: 'project-authorization',
      kind: 'security-policy',
      title: 'Authorize project operations',
      skillName: 'authorize-project-operation',
      owner: 'authorization',
      implementationPaths: authorizationEvidence.map((entry) => entry.path),
      discoveryEvidence: authorizationEvidence,
      scan,
      detection: 'exported-authorization-boundary-v1',
    }));
  }
  return candidates;
}

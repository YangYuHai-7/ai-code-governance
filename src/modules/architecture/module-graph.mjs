import path from 'node:path';
import { GENERATED_MARKER } from '../../constants.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative } from '../../shared/index.mjs';

const JS_TS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

function tokenizeModules(content) {
  const tokens = [];
  let index = 0;
  let incomplete = false;
  let lineBreakBefore = false;
  const pushToken = (type, value) => {
    tokens.push({ type, value, lineBreakBefore });
    lineBreakBefore = false;
  };
  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];
    if (/\s/.test(char)) {
      if (char === '\n' || char === '\r') lineBreakBefore = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '/') {
      index += 2;
      while (index < content.length && content[index] !== '\n') index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      const end = content.indexOf('*/', index + 2);
      if (end < 0) {
        incomplete = true;
        break;
      }
      if (/\r|\n/.test(content.slice(index, end + 2))) lineBreakBefore = true;
      index = end + 2;
      continue;
    }
    if (char === '`') {
      index += 1;
      let closed = false;
      while (index < content.length) {
        if (content[index] === '\\') index += 2;
        else if (content[index] === '`') {
          index += 1;
          closed = true;
          break;
        } else index += 1;
      }
      if (!closed) incomplete = true;
      continue;
    }
    if (char === '"' || char === "'") {
      const quote = char;
      let value = '';
      let closed = false;
      index += 1;
      while (index < content.length) {
        if (content[index] === '\\' && index + 1 < content.length) {
          value += content[index + 1];
          index += 2;
        } else if (content[index] === quote) {
          index += 1;
          closed = true;
          break;
        } else {
          value += content[index];
          index += 1;
        }
      }
      if (!closed) incomplete = true;
      pushToken('string', value);
      continue;
    }
    if (/[A-Za-z_$]/.test(char)) {
      const start = index;
      index += 1;
      while (index < content.length && /[A-Za-z0-9_$]/.test(content[index])) index += 1;
      pushToken('identifier', content.slice(start, index));
      continue;
    }
    pushToken('punctuation', char);
    index += 1;
  }
  return { tokens, incomplete };
}

function isStatementStart(tokens, index) {
  if (index === 0) return true;
  return tokens[index].lineBreakBefore || [';', '}'].includes(tokens[index - 1].value);
}

function moduleReferences(content) {
  const { tokens, incomplete } = tokenizeModules(content);
  const specifiers = [];
  let unsupported = incomplete;
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== 'identifier') continue;
    if (token.value === 'require' && tokens[index + 1]?.value === '(' && tokens[index + 2]?.type === 'string') {
      if (tokens[index + 2].value.startsWith('.')) unsupported = true;
      continue;
    }
    if (token.value === 'import' && tokens[index + 1]?.value === '(') {
      if (tokens[index + 2]?.type === 'string' && tokens[index + 2].value.startsWith('.')) unsupported = true;
      continue;
    }
    if (!['import', 'export'].includes(token.value) || !isStatementStart(tokens, index)) continue;
    if (token.value === 'import' && tokens[index + 1]?.type === 'string') {
      specifiers.push(tokens[index + 1].value);
      continue;
    }
    for (let cursor = index + 1; cursor < tokens.length && tokens[cursor].value !== ';'; cursor += 1) {
      if (
        cursor > index + 1
        && tokens[cursor].lineBreakBefore
        && tokens[cursor].type === 'identifier'
        && ['import', 'export'].includes(tokens[cursor].value)
      ) break;
      if (tokens[cursor].value === 'from' && tokens[cursor + 1]?.type === 'string') {
        specifiers.push(tokens[cursor + 1].value);
        break;
      }
    }
  }
  return { specifiers, unsupported };
}

function potentialProjectAlias(specifier) {
  return /^(?:@\/|~\/|#\/|src\/)/.test(specifier);
}

export function moduleGraphDeclaration(config) {
  if (config?.architecture?.status !== 'active' || config.architecture.verification?.dependencyDirection !== 'aicg-check-js-ts-module-graph') return null;
  return {
    schemaVersion: 1,
    generatedMarker: GENERATED_MARKER,
    status: 'active',
    language: 'js-ts',
    scope: {
      appliesTo: config.architecture.scope?.appliesTo ?? 'future-code',
      baselineSourcePaths: [...(config.architecture.scope?.baselineSourcePaths ?? [])],
    },
    layers: [
      { id: 'app', roots: ['src/app'], allowedDependencies: ['modules', 'shared'] },
      { id: 'modules', roots: ['src/modules'], allowedDependencies: ['shared'], publicEntrypoints: ['index'] },
      { id: 'shared', roots: ['src/shared'], allowedDependencies: [] },
    ],
    crossModulePrivateImports: 'forbidden',
    internalPathAllowlist: [],
    claimBoundary: 'Only statically analyzable relative JS/TS imports and exports are checked. Dynamic imports, aliases, runtime resolution, cohesion, and single responsibility remain unverified.',
  };
}

export function validateModuleGraphDeclaration(declaration) {
  if (!declaration || declaration.schemaVersion !== 1 || declaration.status !== 'active' || declaration.language !== 'js-ts') {
    throw new Error('Module graph declaration must be an active js-ts schemaVersion 1 document.');
  }
  const layers = new Map((declaration.layers ?? []).map((layer) => [layer.id, layer]));
  if (!declaration.scope || !['future-code', 'new-modules-only'].includes(declaration.scope.appliesTo) || !Array.isArray(declaration.scope.baselineSourcePaths)) {
    throw new Error('Module graph declaration requires a future-code or new-modules-only scope with baselineSourcePaths.');
  }
  if (declaration.scope.baselineSourcePaths.some((relative) => !isSafeRelative(relative)) || new Set(declaration.scope.baselineSourcePaths).size !== declaration.scope.baselineSourcePaths.length) {
    throw new Error('Module graph baselineSourcePaths must be unique safe repository-relative paths.');
  }
  for (const id of ['app', 'modules', 'shared']) {
    const layer = layers.get(id);
    if (!layer || !Array.isArray(layer.roots) || layer.roots.length === 0 || !Array.isArray(layer.allowedDependencies)) {
      throw new Error(`Module graph declaration is missing the ${id} layer contract.`);
    }
    for (const root of layer.roots) {
      if (!isSafeRelative(root) || !root.startsWith('src/')) throw new Error(`Module graph root is unsafe: ${root}.`);
    }
  }
  if (declaration.crossModulePrivateImports !== 'forbidden') throw new Error('Cross-module private imports must remain forbidden.');
  if (!Array.isArray(declaration.internalPathAllowlist)) throw new Error('Module graph internalPathAllowlist must be an array.');
  return declaration;
}

function boundary(relative) {
  const parts = relative.split('/');
  if (parts[0] !== 'src') return null;
  if (parts[1] === 'app') return { layer: 'app', module: null };
  if (parts[1] === 'shared') return { layer: 'shared', module: null };
  if (parts[1] === 'modules' && parts[2]) return { layer: 'modules', module: parts[2] };
  return null;
}

function resolveTarget(source, specifier, files) {
  if (!specifier.startsWith('.')) return null;
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(source), specifier));
  if (!isSafeRelative(base)) return null;
  const candidates = [base];
  if (!path.posix.extname(base)) {
    for (const extension of JS_TS_EXTENSIONS) candidates.push(`${base}${extension}`);
    for (const extension of JS_TS_EXTENSIONS) candidates.push(`${base}/index${extension}`);
  }
  return candidates.find((candidate) => files.has(candidate)) ?? base;
}

function allowlisted(declaration, source, target) {
  return declaration.internalPathAllowlist.some((entry) => (
    entry && entry.source === source && entry.target === target
  ));
}

export function evaluateModuleGraph(scan, declaration) {
  if (!declaration) return { status: 'stated-only', issues: [], inspectedFiles: [], unsupportedFiles: [] };
  validateModuleGraphDeclaration(declaration);
  const fileSet = new Set(scan.files.filter((file) => file.type === 'file').map((file) => file.relative));
  const baseline = declaration.scope.appliesTo === 'new-modules-only'
    ? new Set(declaration.scope.baselineSourcePaths)
    : new Set();
  const sourceFiles = scan.files
    .filter((file) => file.type === 'file' && JS_TS_EXTENSIONS.includes(path.extname(file.relative).toLowerCase()) && boundary(file.relative) && !baseline.has(file.relative))
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const layers = new Map(declaration.layers.map((layer) => [layer.id, layer]));
  const issues = [];
  const unsupportedFiles = [];
  for (const source of sourceFiles) {
    let content;
    try {
      content = readText(source.absolute);
    } catch {
      unsupportedFiles.push(source.relative);
      continue;
    }
    const references = moduleReferences(content);
    if (references.unsupported || references.specifiers.some(potentialProjectAlias)) unsupportedFiles.push(source.relative);
    for (const specifier of references.specifiers) {
      const target = resolveTarget(source.relative, specifier, fileSet);
      if (!target || allowlisted(declaration, source.relative, target)) continue;
      const sourceBoundary = boundary(source.relative);
      const targetBoundary = boundary(target);
      if (!targetBoundary) continue;
      const allowed = layers.get(sourceBoundary.layer)?.allowedDependencies ?? [];
      if (sourceBoundary.layer !== targetBoundary.layer && !allowed.includes(targetBoundary.layer)) {
        issues.push({
          source: source.relative,
          target,
          rule: `dependency-direction: ${sourceBoundary.layer} may not depend on ${targetBoundary.layer}`,
        });
        continue;
      }
      if (
        declaration.crossModulePrivateImports === 'forbidden'
        && sourceBoundary.layer === 'modules'
        && targetBoundary.layer === 'modules'
        && sourceBoundary.module !== targetBoundary.module
      ) {
        const publicNames = layers.get('modules')?.publicEntrypoints ?? ['index'];
        const targetBase = path.posix.basename(target).replace(path.posix.extname(target), '');
        if (!publicNames.includes(targetBase)) {
          issues.push({
            source: source.relative,
            target,
            rule: 'public-api: cross-module imports must target the module public entrypoint',
          });
        }
      }
    }
  }
  issues.sort((left, right) => `${left.source}\0${left.target}\0${left.rule}`.localeCompare(`${right.source}\0${right.target}\0${right.rule}`));
  return {
    status: issues.length > 0 ? 'failed' : unsupportedFiles.length > 0 ? 'stated-only' : 'passed',
    issues,
    inspectedFiles: sourceFiles.map((file) => file.relative),
    unsupportedFiles: [...new Set(unsupportedFiles)].sort((left, right) => left.localeCompare(right)),
  };
}

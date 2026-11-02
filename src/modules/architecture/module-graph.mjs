import path from 'node:path';
import { projectSourcePaths } from '../repository/index.mjs';
import { isArchitectureNonSourcePath } from './source-classification.mjs';
import { GENERATED_MARKER } from '../../constants.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative } from '../../shared/index.mjs';
import { extractTypeScriptReferences, resolveTypeScriptReference } from './typescript-imports.mjs';

const JS_TS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

export function moduleGraphDeclaration(config) {
  if (config?.architecture?.status !== 'active' || config.architecture.verification?.dependencyDirection !== 'aicg-check-js-ts-module-graph') return null;
  const roots = config.architecture.scope?.roots ?? ['src'];
  return {
    schemaVersion: 1,
    generatedMarker: GENERATED_MARKER,
    status: 'active',
    language: 'js-ts',
    scope: {
      roots: [...roots],
      appliesTo: config.architecture.scope?.appliesTo ?? 'future-code',
      baselineSourcePaths: [...(config.architecture.scope?.baselineSourcePaths ?? [])],
    },
    layers: [
      { id: 'app', roots: roots.map((root) => `${root}/app`), allowedDependencies: ['modules', 'shared'] },
      { id: 'modules', roots: roots.map((root) => `${root}/modules`), allowedDependencies: ['shared'], publicEntrypoints: ['index'] },
      { id: 'shared', roots: roots.map((root) => `${root}/shared`), allowedDependencies: [] },
    ],
    crossModulePrivateImports: 'forbidden',
    internalPathAllowlist: [],
    claimBoundary: config.artifactLanguage === 'zh-CN' ? '仅检查可静态分析的相对 JS/TS 导入和导出。动态导入、别名、运行时解析、内聚性和单一职责仍未经验证。' : 'Only statically analyzable relative JS/TS imports and exports are checked. Dynamic imports, aliases, runtime resolution, cohesion, and single responsibility remain unverified.',
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
  const sourceRoots = declaration.scope.roots ?? ['src'];
  if (!Array.isArray(sourceRoots) || !sourceRoots.length || sourceRoots.some(root => !isSafeRelative(root) || path.posix.normalize(root) !== root || root === '.' || root.includes('\\')) || new Set(sourceRoots).size !== sourceRoots.length || sourceRoots.some((root, i) => sourceRoots.some((other, j) => i !== j && root.startsWith(`${other}/`)))) throw new Error('Module graph requires safe, non-overlapping source roots.');
  for (const id of ['app', 'modules', 'shared']) {
    const layer = layers.get(id);
    if (!layer || !Array.isArray(layer.roots) || layer.roots.length === 0 || !Array.isArray(layer.allowedDependencies)) {
      throw new Error(`Module graph declaration is missing the ${id} layer contract.`);
    }
    for (const root of layer.roots) {
      if (!isSafeRelative(root) || !sourceRoots.some(sourceRoot => root === `${sourceRoot}/${id}`)) throw new Error(`Module graph root is unsafe: ${root}.`);
    }
  }
  if (declaration.crossModulePrivateImports !== 'forbidden') throw new Error('Cross-module private imports must remain forbidden.');
  if (!Array.isArray(declaration.internalPathAllowlist)) throw new Error('Module graph internalPathAllowlist must be an array.');
  return declaration;
}

function boundary(relative, declaration) {
  const root = (declaration.scope.roots ?? ['src']).find(candidate => relative.startsWith(`${candidate}/`));
  if (!root) return null;
  const parts = relative.slice(root.length + 1).split('/');
  if (parts.length === 1 && /^(main|index|app|bootstrap)\./i.test(parts[0])) return { layer: 'app', module: null, root };
  if (parts[0] === 'app') return { layer: 'app', module: null, root };
  if (parts[0] === 'shared') return { layer: 'shared', module: null, root };
  if (parts[0] === 'modules' && parts[1]) return { layer: 'modules', module: parts[1], root };
  return null;
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
  const implementation = new Set(projectSourcePaths(scan));
  const candidates = scan.files.filter(file => file.type === 'file' && implementation.has(file.relative)
    && !baseline.has(file.relative) && !isArchitectureNonSourcePath(file.relative, declaration.scope.roots ?? ['src'])
    && !/(^|\/)(test|tests|__tests__)\/|\.(test|spec)\.[^/]+$/i.test(file.relative));
  const sourceFiles = candidates
    .filter(file => JS_TS_EXTENSIONS.includes(path.extname(file.relative).toLowerCase()) && boundary(file.relative, declaration))
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const layers = new Map(declaration.layers.map((layer) => [layer.id, layer]));
  const issues = [];
  const inspected = new Set(sourceFiles.map(file => file.relative));
  const unsupportedFiles = candidates.filter(file => !inspected.has(file.relative)).map(file => file.relative);
  for (const source of sourceFiles) {
    let content;
    try {
      content = readText(source.absolute);
    } catch {
      unsupportedFiles.push(source.relative);
      continue;
    }
    const references = extractTypeScriptReferences(content);
    if (references.unsupported) unsupportedFiles.push(source.relative);
    for (const reference of references.references) {
      const resolved = resolveTypeScriptReference({ source: source.relative, specifier: reference.specifier, files: fileSet });
      if (!resolved.supported) {
        unsupportedFiles.push(source.relative);
        continue;
      }
      const target = resolved.target;
      if (!target || allowlisted(declaration, source.relative, target)) continue;
      const sourceBoundary = boundary(source.relative, declaration);
      const targetBoundary = boundary(target, declaration);
      if (!targetBoundary) {
        if (target && implementation.has(target)) unsupportedFiles.push(source.relative);
        continue;
      }
      if (sourceBoundary.root !== targetBoundary.root) {
        issues.push({ source: source.relative, target, rule: 'cross-unit: application source must use an explicit shared contract instead of another unit implementation' });
        continue;
      }
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
    status: issues.length > 0 ? 'failed' : unsupportedFiles.length > 0 ? 'stated-only' : sourceFiles.length === 0 ? 'uncovered' : 'passed',
    issues,
    inspectedFiles: sourceFiles.map((file) => file.relative),
    coverage: { candidateFiles: candidates.length, inspectedFiles: sourceFiles.length, unsupportedFiles: new Set(unsupportedFiles).size },
    unsupportedFiles: [...new Set(unsupportedFiles)].sort((left, right) => left.localeCompare(right)),
  };
}

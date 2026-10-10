import path from 'node:path';
import { GENERATED_MARKER } from '../../constants.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative } from '../../shared/index.mjs';
import { extractTypeScriptReferences, resolveTypeScriptReference } from './typescript-imports.mjs';

const JS_TS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];

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

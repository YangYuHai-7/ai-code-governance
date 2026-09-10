import path from 'node:path';
import { GENERATED_MARKER } from '../../constants.mjs';
import { readText } from '../../adapters/filesystem/index.mjs';
import { isSafeRelative } from '../../shared/index.mjs';

const JS_TS_EXTENSIONS = ['.js', '.jsx', '.mjs', '.cjs', '.ts', '.tsx', '.mts', '.cts'];
const STATIC_MODULE = /^[ \t]*(?:import|export)\s+(?:(?:[\w*$ {},\r\n\t]+?)\s+from\s+)?(['"])([^'"\r\n]+)\1/gm;
const UNSUPPORTED_RELATIVE_MODULE = /\b(?:import|require)\s*\(\s*['"]\.{1,2}\//;

export function moduleGraphDeclaration(config) {
  if (config?.architecture?.status !== 'active' || config.architecture.verification?.dependencyDirection !== 'aicg-check-js-ts-module-graph') return null;
  return {
    schemaVersion: 1,
    generatedMarker: GENERATED_MARKER,
    status: 'active',
    language: 'js-ts',
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
  const sourceFiles = scan.files
    .filter((file) => file.type === 'file' && JS_TS_EXTENSIONS.includes(path.extname(file.relative).toLowerCase()) && boundary(file.relative))
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
    if (UNSUPPORTED_RELATIVE_MODULE.test(content)) unsupportedFiles.push(source.relative);
    STATIC_MODULE.lastIndex = 0;
    for (const match of content.matchAll(STATIC_MODULE)) {
      const target = resolveTarget(source.relative, match[2], fileSet);
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

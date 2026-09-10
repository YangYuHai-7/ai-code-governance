import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';

const TEST_ROOT = path.dirname(fileURLToPath(import.meta.url));
const SRC_ROOT = path.resolve(TEST_ROOT, '..', 'src');
const MODULES_ROOT = path.join(SRC_ROOT, 'modules');

function sourceFiles(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(absolute));
    else if (entry.isFile() && entry.name.endsWith('.mjs')) files.push(absolute);
  }
  return files.sort((left, right) => left.localeCompare(right));
}

const NODE_BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const BUILTIN_ALLOWLIST = {
  root: new Set(),
  catalogs: new Set(['node:path']),
  cli: new Set(['node:path', 'node:process', 'node:readline/promises']),
  kernel: new Set(['node:fs', 'node:path', 'node:url']),
  modules: new Set(['node:crypto', 'node:fs', 'node:os', 'node:path']),
  shared: new Set(['node:crypto']),
};
const ADAPTER_BUILTIN_ALLOWLIST = {
  agents: new Set(),
  filesystem: new Set(['node:crypto', 'node:fs', 'node:path']),
  process: new Set(['node:child_process']),
};

function relativeSource(file, sourceRoot = SRC_ROOT) {
  return path.relative(sourceRoot, file).split(path.sep).join('/');
}

function resolveLocalImport(source, specifier) {
  if (!specifier.startsWith('.')) return null;
  const candidate = path.resolve(path.dirname(source), specifier);
  for (const resolved of [candidate, `${candidate}.mjs`, path.join(candidate, 'index.mjs')]) {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return candidate;
}

function staticModuleStatements(content) {
  return content.matchAll(/\b(?:import|export)\s+(?:(?:[\w*$ {},\r\n\t]+?)\s+from\s+)?(['"])([^'"\r\n]+)\1\s*;?/g);
}

function importSpecifiers(content) {
  const specifiers = [];
  const dynamicImport = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of staticModuleStatements(content)) specifiers.push(match[2]);
  for (const match of content.matchAll(dynamicImport)) specifiers.push(match[1]);
  return specifiers;
}

function directBoundary(file, sourceRoot = SRC_ROOT) {
  const relative = relativeSource(file, sourceRoot);
  const [area, name] = relative.split('/');
  if (area === 'modules' && name) return { area, name };
  if (['adapters', 'cli', 'kernel', 'shared', 'catalogs'].includes(area)) return { area, name: null };
  return { area: 'root', name: null };
}

function transparentRootShimBoundary(file, sourceRoot = SRC_ROOT) {
  if (path.dirname(file) !== sourceRoot || !fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const targets = [];
  let remainder = content;
  for (const match of staticModuleStatements(content)) {
    if (!match[0].trimStart().startsWith('export ') || !/\sfrom\s/.test(match[0])) return null;
    const resolved = resolveLocalImport(file, match[2]);
    if (!resolved) return null;
    targets.push(directBoundary(resolved, sourceRoot));
    remainder = remainder.replace(match[0], '');
  }
  remainder = remainder.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '').replace(/[;\s]/g, '');
  if (targets.length === 0 || remainder.length > 0) return null;

  const identities = new Set(targets.map(({ area, name }) => `${area}:${name ?? ''}`));
  return identities.size === 1 ? targets[0] : null;
}

function isRootExportFacade(file, sourceRoot = SRC_ROOT) {
  if (path.dirname(file) !== sourceRoot || !fs.existsSync(file)) return false;
  const content = fs.readFileSync(file, 'utf8');
  let exports = 0;
  let remainder = content;
  for (const match of staticModuleStatements(content)) {
    if (!match[0].trimStart().startsWith('export ') || !/\sfrom\s/.test(match[0])) return false;
    if (!resolveLocalImport(file, match[2])) return false;
    exports += 1;
    remainder = remainder.replace(match[0], '');
  }
  remainder = remainder.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\r\n]*/g, '').replace(/[;\s]/g, '');
  return exports > 0 && remainder.length === 0;
}

function effectiveBoundary(file, sourceRoot = SRC_ROOT) {
  const direct = directBoundary(file, sourceRoot);
  return direct.area === 'root' ? transparentRootShimBoundary(file, sourceRoot) ?? direct : direct;
}

function boundaryViolations(sourceRoot = SRC_ROOT) {
  const violations = [];
  const modulesRoot = path.join(sourceRoot, 'modules');
  for (const source of sourceFiles(sourceRoot)) {
    const sourceBoundary = directBoundary(source, sourceRoot);
    const content = fs.readFileSync(source, 'utf8');
    for (const specifier of importSpecifiers(content)) {
      if (NODE_BUILTINS.has(specifier)) {
        const canonical = specifier.startsWith('node:') ? specifier : `node:${specifier}`;
        const adapterName = relativeSource(source, sourceRoot).split('/')[1];
        const allowedBuiltins = sourceBoundary.area === 'adapters'
          ? ADAPTER_BUILTIN_ALLOWLIST[adapterName] ?? new Set()
          : BUILTIN_ALLOWLIST[sourceBoundary.area] ?? new Set();
        if (!specifier.startsWith('node:')) violations.push(`${relativeSource(source, sourceRoot)} -> ${specifier}: Node built-ins must use the node: prefix`);
        if (!allowedBuiltins.has(canonical)) {
          violations.push(`${relativeSource(source, sourceRoot)} -> ${specifier}: ${sourceBoundary.area} does not allow this Node built-in`);
        }
        continue;
      }
      const target = resolveLocalImport(source, specifier);
      if (!target) continue;
      const targetBoundary = effectiveBoundary(target, sourceRoot);
      const dependency = `${relativeSource(source, sourceRoot)} -> ${specifier}`;

      if (path.normalize(target) === path.normalize(path.join(sourceRoot, 'utils.mjs'))) {
        violations.push(`${dependency}: internal code must use the owning adapter, kernel, or shared public entrypoint instead of utils.mjs`);
        continue;
      }

      if (['kernel', 'shared'].includes(sourceBoundary.area) && ['cli', 'modules'].includes(targetBoundary.area)) {
        violations.push(`${dependency}: ${sourceBoundary.area} must not depend on ${targetBoundary.area}`);
        continue;
      }
      if (sourceBoundary.area === 'adapters' && ['cli', 'modules'].includes(targetBoundary.area)) {
        violations.push(`${dependency}: adapters must not depend on ${targetBoundary.area}`);
        continue;
      }
      if (sourceBoundary.area !== 'modules') continue;
      if (targetBoundary.area === 'cli') {
        violations.push(`${dependency}: modules must not depend on cli`);
        continue;
      }
      if (targetBoundary.area === 'modules' && targetBoundary.name !== sourceBoundary.name) {
        const expected = path.join(modulesRoot, targetBoundary.name, 'index.mjs');
        if (path.normalize(target) !== path.normalize(expected)) {
          violations.push(`${dependency}: cross-module imports must use modules/${targetBoundary.name}/index.mjs`);
        }
      }
    }
  }
  for (const source of sourceFiles(sourceRoot).filter((file) => path.dirname(file) === sourceRoot)) {
    if (!isRootExportFacade(source, sourceRoot)) {
      violations.push(`${relativeSource(source, sourceRoot)}: root source files must be transparent single-boundary re-export facades`);
    }
  }
  return violations;
}

test('every migrated module and the catalog expose a public facade', () => {
  const missing = fs.readdirSync(MODULES_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(MODULES_ROOT, entry.name, 'index.mjs'))
    .filter((file) => !fs.existsSync(file))
    .map(relativeSource);
  if (!fs.existsSync(path.join(SRC_ROOT, 'catalogs', 'index.mjs'))) missing.push('catalogs/index.mjs');
  assert.deepEqual(missing, []);
});

test('source dependencies respect architecture boundaries', () => {
  assert.deepEqual(boundaryViolations(), []);
});

test('boundary scanner detects multiline cross-module imports and exports', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-architecture-multiline-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'modules', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(root, 'modules', 'beta'), { recursive: true });
  fs.writeFileSync(path.join(root, 'modules', 'alpha', 'index.mjs'), "export const alpha = true;\n");
  fs.writeFileSync(path.join(root, 'modules', 'beta', 'private.mjs'), "export const beta = true;\n");
  fs.writeFileSync(path.join(root, 'modules', 'beta', 'index.mjs'), "export { beta } from './private.mjs';\n");
  fs.writeFileSync(path.join(root, 'modules', 'alpha', 'consumer.mjs'), "import {\n  beta,\n} from '../beta/private.mjs';\nexport {\n  beta as exposedBeta,\n} from '../beta/private.mjs';\n");
  const violations = boundaryViolations(root);
  assert.equal(violations.filter((item) => item.includes('cross-module imports')).length, 2);
});

test('boundary scanner rejects root implementations and unapproved Node built-ins', (context) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-architecture-root-'));
  context.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.mkdirSync(path.join(root, 'modules', 'alpha'), { recursive: true });
  fs.mkdirSync(path.join(root, 'shared'), { recursive: true });
  fs.mkdirSync(path.join(root, 'adapters', 'agents'), { recursive: true });
  fs.writeFileSync(path.join(root, 'shared', 'index.mjs'), "export const helper = true;\n");
  fs.writeFileSync(path.join(root, 'utils.mjs'), "export { helper } from './shared/index.mjs';\n");
  fs.writeFileSync(path.join(root, 'modules', 'alpha', 'index.mjs'), "import http from 'node:http';\nimport { helper } from '../../utils.mjs';\nexport const alpha = http || helper;\n");
  fs.writeFileSync(path.join(root, 'adapters', 'agents', 'unsafe.mjs'), "import { spawnSync } from 'node:child_process';\nexport { spawnSync };\n");
  fs.writeFileSync(path.join(root, 'legacy.mjs'), "export function hiddenImplementation() { return true; }\n");
  const violations = boundaryViolations(root);
  assert.ok(violations.some((item) => item.includes('modules does not allow this Node built-in')));
  assert.ok(violations.some((item) => item.includes('adapters does not allow this Node built-in')));
  assert.ok(violations.some((item) => item.includes('instead of utils.mjs')));
  assert.ok(violations.some((item) => item.includes('legacy.mjs: root source files must be transparent')));
});

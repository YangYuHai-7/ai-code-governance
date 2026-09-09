import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
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

function relativeSource(file) {
  return path.relative(SRC_ROOT, file).split(path.sep).join('/');
}

function resolveLocalImport(source, specifier) {
  if (!specifier.startsWith('.')) return null;
  const candidate = path.resolve(path.dirname(source), specifier);
  for (const resolved of [candidate, `${candidate}.mjs`, path.join(candidate, 'index.mjs')]) {
    if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) return resolved;
  }
  return candidate;
}

function importSpecifiers(content) {
  const specifiers = [];
  const staticImport = /(?:^|\n)\s*(?:import|export)\s+(?:[^'";\n]*?\s+from\s+)?['"]([^'"]+)['"]/g;
  const dynamicImport = /\bimport\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const pattern of [staticImport, dynamicImport]) {
    for (const match of content.matchAll(pattern)) specifiers.push(match[1]);
  }
  return specifiers;
}

function directBoundary(file) {
  const relative = relativeSource(file);
  const [area, name] = relative.split('/');
  if (area === 'modules' && name) return { area, name };
  if (['adapters', 'cli', 'kernel', 'shared', 'catalogs'].includes(area)) return { area, name: null };
  return { area: 'root', name: null };
}

function transparentRootShimBoundary(file) {
  if (path.dirname(file) !== SRC_ROOT || !fs.existsSync(file)) return null;
  const content = fs.readFileSync(file, 'utf8');
  const meaningfulLines = content.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (meaningfulLines.length === 0) return null;

  const targets = [];
  for (const line of meaningfulLines) {
    const match = line.match(/^export\s+(?:\*|\{[^}]*\})\s+from\s+['"]([^'"]+)['"];?$/);
    if (!match) return null;
    const resolved = resolveLocalImport(file, match[1]);
    if (!resolved) return null;
    targets.push(directBoundary(resolved));
  }

  const identities = new Set(targets.map(({ area, name }) => `${area}:${name ?? ''}`));
  return identities.size === 1 ? targets[0] : null;
}

function effectiveBoundary(file) {
  const direct = directBoundary(file);
  return direct.area === 'root' ? transparentRootShimBoundary(file) ?? direct : direct;
}

function boundaryViolations() {
  const violations = [];
  for (const source of sourceFiles(SRC_ROOT)) {
    const sourceBoundary = directBoundary(source);
    const content = fs.readFileSync(source, 'utf8');
    for (const specifier of importSpecifiers(content)) {
      const target = resolveLocalImport(source, specifier);
      if (!target) continue;
      const targetBoundary = effectiveBoundary(target);
      const dependency = `${relativeSource(source)} -> ${specifier}`;

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
        const expected = path.join(MODULES_ROOT, targetBoundary.name, 'index.mjs');
        if (path.normalize(target) !== path.normalize(expected)) {
          violations.push(`${dependency}: cross-module imports must use modules/${targetBoundary.name}/index.mjs`);
        }
      }
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

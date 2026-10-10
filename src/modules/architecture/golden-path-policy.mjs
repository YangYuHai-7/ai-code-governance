import path from 'node:path';
import { readText } from '../../adapters/filesystem/index.mjs';
import { extractTypeScriptReferences, resolveTypeScriptReference } from './typescript-imports.mjs';
import { validateGoldenPathPack } from '../stack-packs/index.mjs';

const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.mts', '.cts']);
const DATABASE_PACKAGE = 'drizzle-orm';
const TRANSPORT_PACKAGE = 'fastify';

function issue(code, source, target = null) {
  return { code, source, target };
}

function fileSet(scan) {
  return scan.files.filter((file) => file.type === 'file' || file.type === 'link');
}

function moduleForPath(relative, pack) {
  const match = pack.architecture.modules
    .filter((entry) => entry.roots.some((root) => relative === root || relative.startsWith(`${root}/`)))
    .sort((left, right) => Math.max(...right.roots.map((root) => root.length)) - Math.max(...left.roots.map((root) => root.length)))[0];
  if (!match) return null;
  const root = match.roots.find((entry) => relative === entry || relative.startsWith(`${entry}/`));
  const remainder = relative.slice(root.length + 1);
  return {
    id: match.id,
    instance: match.id === 'web-feature' ? remainder.split('/')[0] ?? null : null,
    publicEntrypoints: match.publicEntrypoints,
  };
}

function isCompositionRoot(relative, pack) {
  return pack.architecture.compositionRoots.includes(relative);
}

function allowedDependency(source, target, pack) {
  if (isCompositionRoot(source, pack)) return true;
  const sourceModule = moduleForPath(source, pack);
  const targetModule = moduleForPath(target, pack);
  if (!sourceModule || !targetModule || sourceModule.id === targetModule.id) return true;
  const declaration = pack.architecture.modules.find((entry) => entry.id === sourceModule.id);
  return declaration?.allowedDependencies.includes(targetModule.id) ?? false;
}

function isPublicEntrypoint(relative, targetModule) {
  return targetModule.publicEntrypoints.includes(path.posix.basename(relative));
}

function cycleIssues(edges) {
  const visited = new Set();
  const visiting = new Set();
  const cycles = [];
  const visit = (source) => {
    if (visiting.has(source)) {
      cycles.push(source);
      return;
    }
    if (visited.has(source)) return;
    visited.add(source);
    visiting.add(source);
    for (const target of edges.get(source) ?? []) visit(target);
    visiting.delete(source);
  };
  for (const source of [...edges.keys()].sort((left, right) => left.localeCompare(right))) visit(source);
  return [...new Set(cycles)].sort((left, right) => left.localeCompare(right)).map((source) => issue('dependency-cycle', source));
}

function reviewSignals(relative, content) {
  const signals = [];
  if (content.split(/\r?\n/).length > 400) signals.push({ code: 'large-file-review', source: relative });
  if (/\b(?:Controller|FastifyRequest)\b/.test(content) && /\b(?:drizzle|transaction)\b/i.test(content)) signals.push({ code: 'mixed-role-review', source: relative });
  if ((content.match(/\b(?:class|function|const)\b/g) ?? []).length > 80) signals.push({ code: 'low-cohesion-candidate', source: relative });
  return signals;
}

/** Evaluate only the Pack-declared module topology; review signals are advisory. */
export function evaluateGoldenPathArchitecture(scan, pack) {
  const current = validateGoldenPathPack(pack);
  const files = fileSet(scan);
  const sourceFiles = files
    .filter((file) => file.type === 'file' && SOURCE_EXTENSIONS.has(path.posix.extname(file.relative).toLowerCase()))
    .filter((file) => isCompositionRoot(file.relative, current) || moduleForPath(file.relative, current))
    .sort((left, right) => left.relative.localeCompare(right.relative));
  const issues = [];
  const review = [];
  const unsupportedFiles = [];
  const edges = new Map(sourceFiles.map((file) => [file.relative, new Set()]));

  for (const file of sourceFiles) {
    let content;
    try {
      content = readText(file.absolute);
    } catch {
      unsupportedFiles.push(file.relative);
      continue;
    }
    review.push(...reviewSignals(file.relative, content));
    const sourceModule = moduleForPath(file.relative, current);
    if (sourceModule?.id === 'api-domain' && /\bprocess\.env\b/.test(content)) issues.push(issue('domain-environment-configuration', file.relative));
    if (!isCompositionRoot(file.relative, current) && /\bNestFactory\.create\b|\bfastify\s*\(/.test(content)) issues.push(issue('non-root-construction', file.relative));
    if (sourceModule?.id !== 'contracts' && /(?:\.contract\.[cm]?[jt]sx?$|\/contracts\/)/.test(file.relative)) issues.push(issue('misplaced-contract-ownership', file.relative));

    const extracted = extractTypeScriptReferences(content);
    if (extracted.unsupported) unsupportedFiles.push(file.relative);
    for (const reference of extracted.references) {
      const resolved = resolveTypeScriptReference({ source: file.relative, specifier: reference.specifier, files });
      if (!resolved.supported) {
        unsupportedFiles.push(file.relative);
        continue;
      }
      if (resolved.kind === 'external') {
        if (sourceModule?.id === 'api-domain' && current.compatibility.packages.some((entry) => entry.name === resolved.packageName)) {
          issues.push(issue('domain-framework-dependency', file.relative, resolved.packageName));
        } else if (sourceModule?.id !== 'api-transport' && resolved.packageName === TRANSPORT_PACKAGE) {
          issues.push(issue('fastify-object-leakage', file.relative, resolved.packageName));
        } else if (!['api-infrastructure', 'api-domain'].includes(sourceModule?.id) && resolved.packageName === DATABASE_PACKAGE) {
          issues.push(issue('direct-database-access', file.relative, resolved.packageName));
        }
        continue;
      }
      if (!resolved.target) continue;
      const targetModule = moduleForPath(resolved.target, current);
      if (targetModule) edges.get(file.relative)?.add(resolved.target);
      if (!allowedDependency(file.relative, resolved.target, current)) {
        issues.push(issue('forbidden-layer-dependency', file.relative, resolved.target));
        continue;
      }
      if (!sourceModule || !targetModule || isPublicEntrypoint(resolved.target, targetModule)) continue;
      if (sourceModule.id === 'web-feature' && targetModule.id === 'web-feature' && sourceModule.instance !== targetModule.instance) {
        issues.push(issue('cross-feature-private-import', file.relative, resolved.target));
      } else if (sourceModule.id !== targetModule.id) {
        issues.push(issue('bypassed-public-entrypoint', file.relative, resolved.target));
      }
    }
  }
  issues.push(...cycleIssues(edges));
  const deduplicatedIssues = [...new Map(issues.map((entry) => [`${entry.code}\0${entry.source}\0${entry.target ?? ''}`, entry])).values()]
    .sort((left, right) => `${left.code}\0${left.source}\0${left.target ?? ''}`.localeCompare(`${right.code}\0${right.source}\0${right.target ?? ''}`));
  const unsupported = [...new Set(unsupportedFiles)].sort((left, right) => left.localeCompare(right));
  return {
    status: deduplicatedIssues.length > 0 ? 'failed' : unsupported.length > 0 ? 'stated-only' : 'passed',
    issues: deduplicatedIssues,
    reviewSignals: review.sort((left, right) => `${left.code}\0${left.source}`.localeCompare(`${right.code}\0${right.source}`)),
    inspectedFiles: sourceFiles.map((file) => file.relative),
    unsupportedFiles: unsupported,
  };
}

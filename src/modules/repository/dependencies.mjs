import fs from 'node:fs';
import path from 'node:path';
import { assertNoLinkAncestor } from '../../adapters/filesystem/index.mjs';
import { literalStringArrays, withoutComments } from './dependency-syntax.mjs';

// Declaration parsers never execute build tools or resolve packages over the network.
function boundedText(root, file, limit) {
  assertNoLinkAncestor(root, file.relative);
  const fd = fs.openSync(file.absolute, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW ?? 0));
  try {
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.size > limit) return null;
    const bytes = Buffer.alloc(limit + 1);
    const length = fs.readSync(fd, bytes, 0, bytes.length, 0);
    return length > limit ? null : bytes.subarray(0, length).toString('utf8');
  } finally { fs.closeSync(fd); }
}

const MANIFESTS = /^(?:package\.json|package-lock\.json|npm-shrinkwrap\.json|composer\.json|[^/]+\.csproj|Package\.swift|Podfile|CMakeLists\.txt|pubspec\.yaml|pom\.xml|(?:build|settings)\.gradle(?:\.kts)?|gradle\.lockfile|go\.mod|go\.sum|Pipfile|manage\.py|pyproject\.toml|requirements[^/]*\.txt|poetry\.lock|uv\.lock)$/;
const tag = (text, name) => text.match(new RegExp(`<${name}\\b[^>]*>\\s*([^<]+?)\\s*</${name}>`))?.[1] ?? null;

export function dependencyFacts(root, files, limit) {
  const facts = [];
  const locks = [];
  for (const file of files) {
    const base = path.basename(file.relative);
    if (file.type !== 'file' || file.contentScannable === false || !MANIFESTS.test(base)) continue;
    try {
      const text = boundedText(root, file, limit);
      if (text === null) continue;
      const add = (ecosystem, name, declaredVersion, extra = {}) => {
        if (!name || typeof name !== 'string' || name.length > 512) return;
        facts.push({ ecosystem, name, declaredVersion: typeof declaredVersion === 'string' ? declaredVersion : null,
          resolvedVersion: null, sourcePath: file.relative, evidenceLevel: 'stated', ...extra });
      };
      const lock = (ecosystem, name, version) => {
        if (typeof name === 'string' && typeof version === 'string') locks.push({ ecosystem, name, version, sourcePath: file.relative });
      };
      if (base === 'package.json') {
        const manifest = JSON.parse(text);
        for (const section of ['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies']) {
          for (const [name, version] of Object.entries(manifest[section] ?? {})) if (typeof version === 'string') add('npm', name, version, { section });
        }
      } else if (base === 'composer.json') {
        const manifest = JSON.parse(text);
        for (const section of ['require', 'require-dev']) for (const [name, version] of Object.entries(manifest[section] ?? {})) {
          if (typeof version === 'string') add('composer', name, version, { section });
        }
      } else if (base.endsWith('.csproj')) {
        const xml = withoutComments(text, { xml: true });
        const attribute = (value, name) => value.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']+)["']`, 'i'))?.[1];
        for (const [, attributes] of xml.matchAll(/<Project\b([^>]*)>/g)) {
          for (const sdk of (attribute(attributes, 'Sdk') ?? '').split(';').filter(Boolean)) add('dotnet', sdk.split('/')[0], sdk.split('/')[1] ?? null, { section: 'sdk' });
        }
        for (const match of xml.matchAll(/<(PackageReference|FrameworkReference|Sdk)\b([^>]*)(?:\/>|>([\s\S]*?)<\/\1>)/g)) {
          add('dotnet', attribute(match[2], 'Include') ?? attribute(match[2], 'Name'), attribute(match[2], 'Version') ?? tag(match[3] ?? '', 'Version'), { section: match[1] });
        }
      } else if (base === 'Package.swift') {
        const source = withoutComments(text, { slash: true });
        for (const match of source.matchAll(/(?:^|\n)\s*import\s+(SwiftUI|UIKit)\b/g)) add('swift', match[1], null, { section: 'framework-import' });
        for (const match of source.matchAll(/\.linkedFramework\s*\(\s*"([^"\n]+)"/g)) add('swift', match[1], null, { section: 'linked-framework' });
      } else if (base === 'Podfile') {
        const source = withoutComments(text, { hash: true });
        for (const match of source.matchAll(/^\s*pod\s+["']([^"']+)["'](?:\s*,\s*["']([^"']+)["'])?/gm)) add('cocoapods', match[1], match[2] ?? null);
      } else if (base === 'CMakeLists.txt') {
        const source = withoutComments(text, { hash: true });
        for (const match of source.matchAll(/\bfind_package\s*\(\s*(Qt[56]?)(?:\s+(\d[\d.]*))?(?=\s|\))/g)) add('cmake', match[1], match[2] ?? null);
      } else if (base === 'pubspec.yaml') {
        const source = withoutComments(text, { hash: true });
        for (const [, body] of source.matchAll(/^(?:dependencies|dev_dependencies):\s*\n((?:[ \t]+[^\n]*\n|\s*\n)*)/gm)) {
          for (const match of body.matchAll(/^  ([\w-]+):\s*([^\n]*)/gm)) add('dart', match[1], match[2].trim() || null);
        }
      } else if (base === 'manage.py') {
        const source = withoutComments(text, { hash: true });
        if (/^\s*(?:from\s+django(?:\.[\w.]+)?\s+import|import\s+django\b)/m.test(source)) add('python', 'django', null, { section: 'framework-import' });
      } else if (['package-lock.json', 'npm-shrinkwrap.json'].includes(base)) {
        const manifest = JSON.parse(text);
        for (const [location, item] of Object.entries(manifest.packages ?? {})) {
          if (location.startsWith('node_modules/')) lock('npm', item.name ?? location.split('node_modules/').at(-1), item.version);
        }
        for (const [name, item] of Object.entries(manifest.dependencies ?? {})) lock('npm', name, item.version);
      } else if (base === 'pom.xml') {
        const xml = text.replace(/<!--[\s\S]*?-->/g, '');
        const properties = new Map([...((xml.match(/<properties>([\s\S]*?)<\/properties>/)?.[1] ?? '').matchAll(/<([\w.-]+)>\s*([^<]+)\s*<\/\1>/g))].map((m) => [m[1], m[2].trim()]));
        for (const [, body] of xml.matchAll(/<dependency\b[^>]*>([\s\S]*?)<\/dependency>/g)) {
          const group = tag(body, 'groupId'), artifact = tag(body, 'artifactId'), version = tag(body, 'version');
          if (group && artifact) add('maven', `${group}:${artifact}`, version, { resolvedVersion: properties.get(version?.match(/^\$\{([^}]+)\}$/)?.[1]) ?? null });
        }
      } else if (/^(?:build|settings)\.gradle/.test(base)) {
        const source = withoutComments(text, { slash: true });
        for (const match of source.matchAll(/\bid\s*(?:\(\s*)?["']([^"']+)["']\s*\)?(?:\s+version\s+["']([^"']+)["'])?/g)) add('gradle-plugin', match[1], match[2] ?? null);
        for (const match of source.matchAll(/\bapply\s+plugin:\s*["']([^"']+)["']/g)) add('gradle-plugin', match[1], null);
        for (const match of source.matchAll(/\b(?:implementation|api|compileOnly|runtimeOnly|testImplementation|classpath|compile|testCompile)\s*(?:\(\s*)?["']([^:"'\s]+):([^:"'\s]+):([^"'\s]+)["']/g)) add('gradle', `${match[1]}:${match[2]}`, match[3]);
        for (const match of source.matchAll(/\b(?:implementation|api|compile|testImplementation)\s+group:\s*["']([^"']+)["'],\s*name:\s*["']([^"']+)["'],\s*version:\s*["']([^"']+)["']/g)) add('gradle', `${match[1]}:${match[2]}`, match[3]);
      } else if (base === 'gradle.lockfile') {
        for (const match of text.matchAll(/^([^#\s:]+):([^:\s]+):([^=\s]+)=/gm)) lock('gradle', `${match[1]}:${match[2]}`, match[3]);
      } else if (base === 'go.mod') {
        const clean = text.replace(/\/\/[^\n]*/g, '');
        const declarations = [...clean.matchAll(/\brequire\s*\(([\s\S]*?)\)/g)].map((m) => m[1]).join('\n') + '\n' + [...clean.matchAll(/^\s*require\s+([^\n(]+)/gm)].map((m) => m[1]).join('\n');
        for (const match of declarations.matchAll(/^\s*(\S+)\s+(v\S+)/gm)) add('go', match[1], match[2]);
      } else if (base === 'go.sum') {
        // go.sum records downloaded checksums, including historical versions. It
        // does not prove module selection and cannot resolve a go.mod requirement.
        continue;
      } else if (['poetry.lock', 'uv.lock'].includes(base)) {
        for (const block of text.split(/^\[\[package\]\]\s*$/m).slice(1)) {
          lock('python', block.match(/^name\s*=\s*["']([^"']+)["']/m)?.[1], block.match(/^version\s*=\s*["']([^"']+)["']/m)?.[1]);
        }
      } else {
        const requirement = (value) => {
          const match = value.match(/^([A-Za-z0-9][A-Za-z0-9._-]*)(?:\[([^\]]+)\])?\s*([^;]*)(?:;\s*(.*))?$/);
          if (match) add('python', match[1].toLowerCase().replace(/[-_.]+/g, '-'), match[3].trim() || null, {
            ...(match[2] ? { extras: match[2].split(',').map((extra) => extra.trim()).sort() } : {}),
            ...(match[4] ? { environmentMarker: match[4].trim() } : {}),
          });
        };
        if (base.startsWith('requirements')) {
          for (const line of text.split(/\r?\n/)) if (line.trim() && !/^\s*[#-]/.test(line)) requirement(line.replace(/\s+#.*$/, '').trim());
        } else {
          const source = withoutComments(text, { hash: true });
          for (const [, section, body] of source.matchAll(/^\[([^\]\n]+)\]\s*\n([\s\S]*?)(?=^\[|$(?![\s\S]))/gm)) {
            if (section === 'project' || section === 'project.optional-dependencies') {
              for (const array of literalStringArrays(body)) if (section !== 'project' || array.key === 'dependencies') for (const value of array.values) requirement(value);
            } else if (/^tool\.poetry(?:\.group\.[^.]+)?\.dependencies$/.test(section) || (base === 'Pipfile' && ['packages', 'dev-packages'].includes(section))) {
              for (const [, name, version] of body.matchAll(/^([\w.-]+)\s*=\s*["']([^"']+)["']/gm)) if (name !== 'python') add('python', name, version);
            }
          }
        }
      }
    } catch {
      // Unsupported or unsafe manifests provide no certified dependency facts.
    }
  }
  for (const fact of facts) {
    const matches = locks.filter((lock) => lock.ecosystem === fact.ecosystem && lock.name === fact.name
      && path.dirname(lock.sourcePath) === path.dirname(fact.sourcePath));
    const versions = [...new Set(matches.map((lock) => lock.version))];
    if (versions.length === 1) Object.assign(fact, { resolvedVersion: versions[0], resolvedSourcePath: matches[0].sourcePath });
  }
  return facts.sort((a, b) => `${a.sourcePath}:${a.ecosystem}:${a.name}:${a.section ?? ''}`.localeCompare(`${b.sourcePath}:${b.ecosystem}:${b.name}:${b.section ?? ''}`));
}

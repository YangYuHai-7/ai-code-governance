#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const failures = [];

function fail(message) {
  failures.push(message);
}

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function markdownOutsideFences(text) {
  const kept = [];
  let fence = null;

  for (const line of text.split(/\r?\n/)) {
    const marker = line.match(/^\s*(`{3,}|~{3,})/);
    if (marker) {
      if (!fence) {
        fence = marker[1][0];
      } else if (marker[1][0] === fence) {
        fence = null;
      }
      continue;
    }
    if (!fence) kept.push(line);
  }

  return kept.join('\n');
}

function markdownFiles(directory) {
  const found = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) found.push(...markdownFiles(absolute));
    if (entry.isFile() && entry.name.endsWith('.md')) found.push(absolute);
  }
  return found;
}

function markdownLinkTargets(text) {
  const targets = [];
  let cursor = 0;

  while (cursor < text.length) {
    const marker = text.indexOf('](', cursor);
    if (marker < 0) break;
    const end = text.indexOf(')', marker + 2);
    if (end < 0) break;
    targets.push(text.slice(marker + 2, end));
    cursor = end + 1;
  }

  return targets;
}

function validateLocalLink(sourceFile, target) {
  if (/^(?:[a-z]+:|#)/i.test(target) || target.includes('<')) return;
  const withoutFragment = target.split('#', 1)[0];
  if (!withoutFragment) return;
  const decoded = decodeURIComponent(withoutFragment);
  const resolved = path.resolve(path.dirname(sourceFile), decoded);
  if (!fs.existsSync(resolved)) {
    throw new Error(`${path.relative(root, sourceFile)} -> ${target}`);
  }
}

function validateMarkdownLinks() {
  const files = [
    path.join(root, 'SKILL.md'),
    path.join(root, 'README.md'),
    ...markdownFiles(path.join(root, 'references')),
  ];
  for (const file of files) {
    const text = markdownOutsideFences(fs.readFileSync(file, 'utf8'));
    for (const target of markdownLinkTargets(text)) {
      try {
        validateLocalLink(file, target);
      } catch (error) {
        fail(`Broken local link: ${error.message}`);
      }
    }
  }
  return files.length;
}

function validateEntryPoint() {
  const skill = read('SKILL.md');
  const frontMatter = skill.match(/^---\n([\s\S]*?)\n---\n/);
  if (!frontMatter) {
    fail('SKILL.md is missing YAML front matter.');
    return;
  }
  if (frontMatter[1].includes('\t')) fail('SKILL.md front matter contains a tab.');
  if (!/^name:\s*ai-code-governance\s*$/m.test(frontMatter[1])) {
    fail('SKILL.md name must be ai-code-governance.');
  }

  const requiredTerms = [
    'macOS',
    'Windows',
    'Linux',
    'React',
    'Vue',
    'Angular',
    'Node.js',
    'Java',
    'Android',
    'iOS',
    'capability-pack-registry.json',
  ];
  for (const term of requiredTerms) {
    if (!skill.includes(term)) fail(`SKILL.md is missing required discovery term: ${term}`);
  }
}

function check(condition, message) {
  if (!condition) fail(message);
}

function validateRegistryHeader(registry) {
  check(registry.schema_version === 1, 'Registry schema_version must be 1.');
  check(registry.product_line === 'ai-code-governance', 'Registry product_line is invalid.');
  check(
    registry.os_targets?.join(',') === 'macos,windows,linux',
    'Registry os_targets must list macos, windows, linux.',
  );
  check(
    registry.current_os_evidence?.windows === 'designed-not-run',
    'Windows evidence must remain designed-not-run until Windows validation exists.',
  );
  check(
    registry.current_os_evidence?.linux === 'designed-not-run',
    'Linux evidence must remain designed-not-run until Linux validation exists.',
  );
}

function validatePack(pack, ids, evidence, lifecycles) {
  check(!ids.has(pack.id), `Duplicate capability pack id: ${pack.id}`);
  ids.add(pack.id);
  check(evidence.has(pack.evidence), `Invalid evidence for ${pack.id}: ${pack.evidence}`);
  check(lifecycles.has(pack.lifecycle), `Invalid lifecycle for ${pack.id}: ${pack.lifecycle}`);
  check(Array.isArray(pack.detect?.manifest_any), `${pack.id} lacks detect.manifest_any.`);
  check(Array.isArray(pack.detect?.dependency_any), `${pack.id} lacks detect.dependency_any.`);
  check(
    Array.isArray(pack.specialists) && pack.specialists.length > 0,
    `${pack.id} must name at least one specialist.`,
  );
  check(
    Array.isArray(pack.validation_sources) && pack.validation_sources.length > 0,
    `${pack.id} must name validation sources.`,
  );
}

function expectedPacks() {
  return {
    'v3.0': ['frontend-react', 'frontend-vue', 'frontend-angular', 'backend-node', 'backend-java'],
    'v3.1': ['frontend-svelte', 'backend-python', 'backend-go', 'backend-php'],
    v4: ['platform-dotnet', 'platform-android', 'platform-ios', 'platform-hybrid-mobile', 'platform-desktop', 'platform-c-cpp'],
  };
}

function validateExpectedPacks(registry, expected) {
  for (const [release, expectedIds] of Object.entries(expected)) {
    for (const id of expectedIds) {
      const pack = registry.packs.find((candidate) => candidate.id === id);
      check(Boolean(pack), `Missing ${release} capability pack: ${id}`);
      check(!pack || pack.release === release, `${id} must belong to ${release}, found ${pack?.release}.`);
    }
  }
}

function validateReleaseEvidence(registry, expected) {
  for (const id of expected['v3.0']) {
    const pack = registry.packs.find((candidate) => candidate.id === id);
    check(
      !pack || (pack.lifecycle === 'active' && pack.evidence === 'supported'),
      `${id} must be active/supported until certification evidence exists.`,
    );
  }
  for (const id of [...expected['v3.1'], ...expected.v4]) {
    const pack = registry.packs.find((candidate) => candidate.id === id);
    check(pack?.evidence !== 'certified', `${id} cannot be certified without release evidence.`);
  }
}

function validateRegistry(registry) {
  const evidence = new Set(registry.evidence_levels);
  const lifecycles = new Set(registry.lifecycle_states);
  const ids = new Set();
  const expected = expectedPacks();

  validateRegistryHeader(registry);
  for (const pack of registry.packs ?? []) validatePack(pack, ids, evidence, lifecycles);
  validateExpectedPacks(registry, expected);
  validateReleaseEvidence(registry, expected);
}

function runNegativeProbe(registry) {
  const before = failures.length;
  const broken = structuredClone(registry);
  broken.packs.push(structuredClone(broken.packs[0]));
  validateRegistry(broken);
  const duplicateCaught = failures.slice(before).some((message) => message.includes('Duplicate capability pack id'));
  failures.splice(before);

  let brokenLinkCaught = false;
  try {
    validateLocalLink(path.join(root, 'SKILL.md'), 'references/does-not-exist.md');
  } catch {
    brokenLinkCaught = true;
  }

  if (!duplicateCaught) fail('Negative probe did not catch a duplicate capability pack.');
  if (!brokenLinkCaught) fail('Negative probe did not catch a broken local link.');
  if (duplicateCaught && brokenLinkCaught) {
    console.log('negative_probe=pass duplicate_pack=caught broken_link=caught');
  }
}

validateEntryPoint();
const markdownCount = validateMarkdownLinks();

let registry;
try {
  registry = JSON.parse(read('assets/capability-pack-registry.json'));
  validateRegistry(registry);
} catch (error) {
  fail(`Capability registry is not valid JSON: ${error.message}`);
}

if (process.argv.includes('--negative-probe') && registry) runNegativeProbe(registry);

if (failures.length > 0) {
  for (const message of failures) console.error(`FAIL: ${message}`);
  process.exitCode = 1;
} else {
  console.log(`skill_validation=pass markdown_files=${markdownCount} capability_packs=${registry.packs.length}`);
  console.log('os_evidence=macos:skill-structure-verified,windows:designed-not-run,linux:designed-not-run');
}
#!/usr/bin/env node
/**
 * Maintainer tooling for the packaged public-Skill catalog.
 *
 * AICG itself stays offline: it reads the committed catalog snapshot and never clones,
 * installs or executes a third-party Skill. This script is the operator-side bridge:
 *
 *   node scripts/skill-catalog.mjs vendor   # fetch each pinned ref and cache its Skill folders
 *   node scripts/skill-catalog.mjs build    # regenerate assets/registries/public-skill-catalog.json
 *   node scripts/skill-catalog.mjs check     # offline validation; re-hashes when vendor/ exists
 *
 * `vendor/` is a local cache and stays out of the published package. The catalog records only
 * metadata (identity, capability mapping, digest, byte size, pinned verification date); it never
 * copies third-party instructions into a governed repository.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SOURCES_PATH = path.join(PACKAGE_ROOT, 'assets/registries/public-skill-sources.json');
const CATALOG_PATH = path.join(PACKAGE_ROOT, 'assets/registries/public-skill-catalog.json');
const VENDOR_ROOT = path.join(PACKAGE_ROOT, 'vendor/skills');

const ID = /^[a-z0-9][a-z0-9._-]{0,127}$/;
const SOURCE = /^(?:official|curated):[A-Za-z0-9._/-]{1,180}$/;
const SHA256 = /^[a-f0-9]{64}$/;
const MAX_CATALOG_ENTRIES = 256;

function fail(message) {
  throw new Error(message);
}

function readJson(file, label) {
  if (!fs.existsSync(file)) fail(`${label} is missing: ${path.relative(PACKAGE_ROOT, file)}`);
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    fail(`${label} is not valid JSON: ${error.message}`);
  }
}

function stableWrite(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`);
}

function idList(value, label) {
  if (!Array.isArray(value) || value.length === 0 || value.length > 32
    || value.some((item) => typeof item !== 'string' || !ID.test(item))) {
    fail(`${label} must be a non-empty bounded identifier list.`);
  }
  return [...new Set(value)].sort();
}

/** Load and validate the human-authored pin + capability mapping. */
export function loadSources() {
  const manifest = readJson(SOURCES_PATH, 'public skill sources');
  if (manifest.schema_version !== 1 || !manifest.policy || !Array.isArray(manifest.sources) || manifest.sources.length === 0) {
    fail('public skill sources manifest has an unsupported schema.');
  }
  const allowed = new Set(manifest.policy.allowed_licenses ?? []);
  const seenSource = new Set();
  const seenOwner = new Set();
  const sources = manifest.sources.map((source) => {
    if (typeof source.id !== 'string' || !ID.test(source.id) || seenSource.has(source.id)) fail(`invalid or duplicate source id: ${source.id}`);
    seenSource.add(source.id);
    if (typeof source.repository !== 'string' || !/^https:\/\/github\.com\/[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/.test(source.repository)) {
      fail(`source ${source.id} must name a GitHub repository URL.`);
    }
    if (typeof source.owner !== 'string' || !ID.test(source.owner) || typeof source.repo !== 'string' || !ID.test(source.repo)) {
      fail(`source ${source.id} must declare a safe owner and repo.`);
    }
    if (typeof source.ref !== 'string' || !/^[a-f0-9]{40}$/.test(source.ref)) fail(`source ${source.id} must pin a full 40-hex commit.`);
    if (typeof source.committedAt !== 'string' || Number.isNaN(Date.parse(source.committedAt))) fail(`source ${source.id} must record committedAt.`);
    if (allowed.size && !allowed.has(source.license)) fail(`source ${source.id} license ${source.license} is outside allowed_licenses.`);
    if (!Array.isArray(source.skills) || source.skills.length === 0) fail(`source ${source.id} declares no skills.`);
    const skills = source.skills.map((skill) => {
      if (typeof skill.id !== 'string' || !ID.test(skill.id)) fail(`source ${source.id} has an invalid skill id.`);
      if (typeof skill.path !== 'string' || !/^[A-Za-z0-9._/-]+$/.test(skill.path) || skill.path.includes('..')) fail(`skill ${skill.id} has an unsafe path.`);
      const capabilities = idList(skill.capabilities, `skill ${skill.id} capabilities`);
      const owner = skill.capabilityOwner;
      if (typeof owner !== 'string' || !capabilities.includes(owner)) fail(`skill ${skill.id} capabilityOwner must be one of its capabilities.`);
      if (seenOwner.has(owner)) fail(`capability owner ${owner} is declared twice; one capability keeps one owner.`);
      seenOwner.add(owner);
      const permissions = skill.permissions === undefined ? [] : idList(skill.permissions, `skill ${skill.id} permissions`);
      if (typeof skill.purpose !== 'string' || !skill.purpose.trim() || skill.purpose.length > 500) fail(`skill ${skill.id} needs a bounded purpose.`);
      return { id: skill.id, path: skill.path, capabilities, capabilityOwner: owner, permissions, purpose: skill.purpose };
    });
    return { ...source, skills };
  });
  return { ...manifest, sources };
}

function skillDirectory(source, skill) {
  return path.join(VENDOR_ROOT, source.owner, source.repo, skill.id);
}

/** Tolerant scalar frontmatter read: enough for identity, never an execution surface. */
function frontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) fail('SKILL.md is missing YAML frontmatter.');
  const values = {};
  for (const line of match[1].split(/\r?\n/)) {
    const header = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!header) continue;
    const [, key, raw] = header;
    const value = raw.trim();
    if (!value) { values[key] = ''; continue; }
    if (value.startsWith('"') || value.startsWith("'")) {
      try { values[key] = JSON.parse(value); } catch { values[key] = value.replace(/^['"]|['"]$/g, ''); }
    } else values[key] = value;
  }
  return values;
}

/** One catalog record in the exact adaptiveGovernance.curatedCatalog wire shape. */
export function buildRecord(source, skill) {
  const file = path.join(skillDirectory(source, skill), 'SKILL.md');
  if (!fs.existsSync(file)) fail(`vendored Skill is missing: ${path.relative(PACKAGE_ROOT, file)} (run: npm run catalog:vendor)`);
  const bytes = fs.readFileSync(file);
  const text = bytes.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(bytes)) fail(`${skill.id} SKILL.md is not valid UTF-8.`);
  const meta = frontmatter(text);
  if (meta.name !== skill.id) fail(`${skill.id} SKILL.md declares name ${meta.name ?? '(none)'}.`);
  if (typeof meta.description !== 'string' || !meta.description.trim() || meta.description.length > 500) {
    fail(`${skill.id} SKILL.md needs a bounded description.`);
  }
  const version = typeof meta.version === 'string' && meta.version.trim() && !/[\r\n\0]/.test(meta.version) ? meta.version.trim() : 'unverified';
  return {
    id: skill.id,
    source: `official:${source.owner}/${source.repo}/${skill.id}`,
    name: skill.id,
    version,
    capabilities: [...skill.capabilities],
    capabilityOwner: skill.capabilityOwner,
    permissions: [...skill.permissions],
    contentSha256: crypto.createHash('sha256').update(bytes).digest('hex'),
    contentBytes: bytes.length,
    verifiedAt: source.committedAt,
  };
}

/** Validate a catalog record without trusting the file that carried it. */
export function validateRecord(record, index) {
  const where = `catalog[${index}]`;
  if (!record || typeof record !== 'object' || Array.isArray(record)) fail(`${where} must be an object.`);
  if (typeof record.id !== 'string' || !ID.test(record.id)) fail(`${where}.id is invalid.`);
  if (typeof record.source !== 'string' || !SOURCE.test(record.source)) fail(`${where}.source is invalid.`);
  if (typeof record.name !== 'string' || !ID.test(record.name)) fail(`${where}.name is invalid.`);
  idList(record.capabilities, `${where}.capabilities`);
  if (!record.capabilities.includes(record.capabilityOwner)) fail(`${where}.capabilityOwner must be one of its capabilities.`);
  if (!Array.isArray(record.permissions) || record.permissions.some((item) => typeof item !== 'string' || !ID.test(item))) fail(`${where}.permissions is invalid.`);
  if (typeof record.contentSha256 !== 'string' || !SHA256.test(record.contentSha256)) fail(`${where}.contentSha256 must be 64 hex.`);
  if (!Number.isInteger(record.contentBytes) || record.contentBytes <= 0) fail(`${where}.contentBytes must be a positive integer.`);
  if (typeof record.verifiedAt !== 'string' || Number.isNaN(Date.parse(record.verifiedAt))) fail(`${where}.verifiedAt must be an ISO timestamp.`);
  if (typeof record.version !== 'string' || !record.version) fail(`${where}.version is required.`);
  return record;
}

export function buildCatalog() {
  const manifest = loadSources();
  const catalog = [];
  for (const source of manifest.sources) {
    for (const skill of source.skills) catalog.push(buildRecord(source, skill));
  }
  catalog.sort((a, b) => a.id.localeCompare(b.id));
  if (catalog.length > MAX_CATALOG_ENTRIES) fail(`catalog exceeds ${MAX_CATALOG_ENTRIES} entries.`);
  catalog.forEach(validateRecord);
  return {
    schema_version: 1,
    product_line: manifest.product_line,
    generated_by: 'scripts/skill-catalog.mjs',
    policy: manifest.policy,
    sources: manifest.sources.map(({ id, repository, ref, committedAt, license }) => ({ id, repository, ref, committedAt, license })),
    catalog,
  };
}

function git(args, cwd) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

function vendor() {
  const manifest = loadSources();
  fs.mkdirSync(VENDOR_ROOT, { recursive: true });
  const pinned = [];
  for (const source of manifest.sources) {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aicg-skill-vendor-'));
    try {
      git(['init', '-q'], tmp);
      git(['remote', 'add', 'origin', source.repository], tmp);
      git(['fetch', '-q', '--depth', '1', 'origin', source.ref], tmp);
      git(['checkout', '-q', '--detach', 'FETCH_HEAD'], tmp);
      const head = git(['rev-parse', 'HEAD'], tmp);
      if (head !== source.ref) fail(`${source.id} resolved to ${head} instead of the pinned ${source.ref}.`);
      for (const skill of source.skills) {
        const from = path.join(tmp, skill.path);
        if (!fs.existsSync(path.join(from, 'SKILL.md'))) fail(`${source.id}@${source.ref} does not contain ${skill.path}/SKILL.md.`);
        const to = skillDirectory(source, skill);
        fs.rmSync(to, { recursive: true, force: true });
        fs.cpSync(from, to, { recursive: true });
      }
      pinned.push(`${source.id}@${source.ref.slice(0, 12)} (${source.skills.length} skill${source.skills.length === 1 ? '' : 's'}, ${source.license})`);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  }
  console.log(`Vendored ${pinned.length} source(s) into vendor/skills:`);
  for (const line of pinned) console.log(`  - ${line}`);
  console.log('Next: node scripts/skill-catalog.mjs build');
}

function check() {
  const manifest = loadSources();
  const catalog = readJson(CATALOG_PATH, 'public skill catalog');
  if (catalog.schema_version !== 1 || !Array.isArray(catalog.catalog)) fail('public skill catalog has an unsupported schema.');
  if (catalog.catalog.length > MAX_CATALOG_ENTRIES) fail(`catalog exceeds ${MAX_CATALOG_ENTRIES} entries.`);
  catalog.catalog.forEach(validateRecord);
  const declared = new Map();
  const owners = new Set();
  for (const source of manifest.sources) {
    for (const skill of source.skills) {
      const key = `official:${source.owner}/${source.repo}/${skill.id}`;
      if (declared.has(key)) fail(`duplicate declared catalog source: ${key}`);
      declared.set(key, { source, skill });
      if (owners.has(skill.capabilityOwner)) fail(`capability owner ${skill.capabilityOwner} is declared twice.`);
      owners.add(skill.capabilityOwner);
    }
  }
  if (catalog.catalog.length !== declared.size) fail(`catalog has ${catalog.catalog.length} entries but ${declared.size} are declared.`);
  let vendored = 0;
  let structural = 0;
  for (const record of catalog.catalog) {
    const entry = declared.get(record.source);
    if (!entry) fail(`catalog entry ${record.id} is not declared in the sources manifest.`);
    if (record.verifiedAt !== entry.source.committedAt) fail(`${record.id} verifiedAt must equal the pinned committedAt.`);
    const file = path.join(skillDirectory(entry.source, entry.skill), 'SKILL.md');
    if (!fs.existsSync(file)) { structural += 1; continue; }
    const rebuilt = buildRecord(entry.source, entry.skill);
    for (const key of ['id', 'source', 'name', 'version', 'capabilityOwner', 'contentSha256', 'contentBytes', 'verifiedAt']) {
      if (rebuilt[key] !== record[key]) fail(`${record.id} is stale: ${key} differs from the vendored revision.`);
    }
    if (JSON.stringify(rebuilt.capabilities) !== JSON.stringify(record.capabilities)) fail(`${record.id} capabilities differ from the sources manifest.`);
    if (JSON.stringify(rebuilt.permissions) !== JSON.stringify(record.permissions)) fail(`${record.id} permissions differ from the sources manifest.`);
    vendored += 1;
  }
  console.log(`Catalog OK: ${catalog.catalog.length} record(s), ${vendored} re-hashed, ${structural} structural-only.`);
}

function main(argv) {
  const command = argv[2];
  if (command === 'vendor') return vendor();
  if (command === 'build') {
    const next = buildCatalog();
    stableWrite(CATALOG_PATH, next);
    console.log(`Wrote ${path.relative(PACKAGE_ROOT, CATALOG_PATH)} with ${next.catalog.length} record(s).`);
    return;
  }
  if (command === 'check') return check();
  console.error('Usage: node scripts/skill-catalog.mjs <vendor|build|check>');
  process.exitCode = 2;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main(process.argv);
  } catch (error) {
    console.error(`skill-catalog: ${error.message}`);
    process.exitCode = 1;
  }
}
